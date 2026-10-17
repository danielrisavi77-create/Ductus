import {
  checkMutationRequest,
  readBodyWithLimit,
} from "@/server/http/mutation-request";
import type { WithActor } from "@/server/db/with-actor";

const MAX_REQUEST_BYTES = 90_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUL = String.fromCodePoint(0);
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/;
const WORK_TYPES = new Set([
  "short_paper",
  "essay",
  "seminar_paper",
  "bachelor_thesis",
  "master_thesis",
  "specialist_thesis",
  "doctoral_thesis",
]);
const AI_POLICIES = new Set(["prohibited", "partially_allowed", "encouraged"]);
const AI_PURPOSES = new Set([
  "formatting",
  "proofreading",
  "literature_search",
  "transcription",
  "translation",
]);

interface AssignmentInput {
  title: string;
  instructions: string;
  workType: string;
  opensAt: string;
  dueAt: string;
  aiPolicy: string;
  aiPurposes: string[];
  evidenceProfile: string;
  importAllowed: boolean;
}

type JsonObject = Record<string, unknown>;

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function refusal(status: number, error: string): Response {
  return json({ error }, status);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_INSTANT.exec(value);
  if (!match || Number(match[1]) < 1) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  calendarDate.setUTCHours(0, 0, 0, 0);
  return (
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day &&
    Number.isFinite(Date.parse(value))
  );
}

function parseInput(value: unknown): AssignmentInput | null {
  if (!isObject(value)) return null;
  const keys = [
    "title",
    "instructions",
    "workType",
    "opensAt",
    "dueAt",
    "aiPolicy",
    "aiPurposes",
    "evidenceProfile",
    "importAllowed",
  ];
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) return null;
  if (
    typeof value.title !== "string" ||
    typeof value.instructions !== "string" ||
    typeof value.workType !== "string" ||
    !validInstant(value.opensAt) ||
    !validInstant(value.dueAt) ||
    typeof value.aiPolicy !== "string" ||
    !Array.isArray(value.aiPurposes) ||
    !value.aiPurposes.every((purpose) => typeof purpose === "string") ||
    typeof value.evidenceProfile !== "string" ||
    typeof value.importAllowed !== "boolean"
  ) {
    return null;
  }
  const aiPurposes = value.aiPurposes as string[];
  if (
    Array.from(value.title).length === 0 ||
    Array.from(value.title).length > 200 ||
    value.title.includes(NUL) ||
    Array.from(value.instructions).length > 20_000 ||
    value.instructions.includes(NUL) ||
    !WORK_TYPES.has(value.workType) ||
    !AI_POLICIES.has(value.aiPolicy) ||
    !["basic", "extended"].includes(value.evidenceProfile) ||
    aiPurposes.length > 5 ||
    new Set(aiPurposes).size !== aiPurposes.length ||
    aiPurposes.some((purpose) => !AI_PURPOSES.has(purpose)) ||
    (value.aiPolicy === "prohibited" && aiPurposes.length !== 0)
  ) {
    return null;
  }
  return {
    title: value.title,
    instructions: value.instructions,
    workType: value.workType,
    opensAt: value.opensAt,
    dueAt: value.dueAt,
    aiPolicy: value.aiPolicy,
    aiPurposes,
    evidenceProfile: value.evidenceProfile,
    importAllowed: value.importAllowed,
  };
}

function pgCode(error: unknown): string | undefined {
  if (!isObject(error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

/** Authenticated, origin-checked creation with a database-enforced retry key. */
export async function createAssignmentResponse(
  request: Request,
  token: string | null,
  withActor: WithActor,
  expectedOrigin: string,
  courseId: string,
): Promise<Response> {
  const requestCheck = checkMutationRequest(request, expectedOrigin);
  if (!requestCheck.ok) return refusal(requestCheck.status, requestCheck.reason);
  if (!UUID.test(courseId)) return refusal(400, "invalid_course_id");

  const requestId = request.headers.get("idempotency-key");
  if (requestId === null || !UUID.test(requestId)) return refusal(400, "invalid_idempotency_key");
  const contentType = request.headers.get("content-type");
  if (!contentType || !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(contentType)) {
    return refusal(415, "unsupported_media_type");
  }

  const body = await readBodyWithLimit(request, MAX_REQUEST_BYTES, 10_000);
  if (!body.ok) return refusal(body.status, body.reason);
  let decoded: string;
  let input: AssignmentInput | null;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(body.bytes);
    input = parseInput(JSON.parse(decoded));
  } catch {
    return refusal(400, "invalid_json");
  }
  if (!input) return refusal(422, "invalid_input");

  try {
    const result = await withActor(token, (tx) =>
      tx.query<{ id: string }>(
        `SELECT institution.create_assignment(
          $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::timestamptz, $7::timestamptz,
          $8::text, $9::text[], $10::text, $11::boolean
        ) AS id`,
        [
          courseId,
          requestId,
          input.title,
          input.instructions,
          input.workType,
          input.opensAt,
          input.dueAt,
          input.aiPolicy,
          input.aiPurposes,
          input.evidenceProfile,
          input.importAllowed,
        ],
      ),
    );
    const id = result.rows[0]?.id;
    if (!id || !UUID.test(id)) throw new Error("assignment RPC returned an invalid identifier");
    return json({ id }, 201);
  } catch (error) {
    const code = pgCode(error);
    if (code === "ZD401") return refusal(401, "unauthenticated");
    if (code === "ZD403") return refusal(403, "forbidden");
    if (code === "ZD409") return refusal(409, "idempotency_conflict");
    if (code === "ZD422") return refusal(422, "invalid_input");
    console.error("assignment creation failed", code ?? "unknown");
    return refusal(503, "assignment_unavailable");
  }
}
