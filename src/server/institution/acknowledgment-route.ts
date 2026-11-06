import type { NextRequest } from "next/server";

import { NOTICE_TEMPLATE_VERSION } from "@/domain/notice/fingerprint";
import { expectedOrigin } from "@/server/auth/config";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import type { WithActor } from "@/server/db/with-actor";
import { checkMutationRequest, readBodyWithLimit } from "@/server/http/mutation-request";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAX_BODY_BYTES = 1024;

type Deps = { withActor: WithActor; expectedOrigin: string | null; sessionToken?: string };

function respond(status: number, body: Record<string, string>): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

type Input = { versionNo: number; fingerprint: string };

// DAN-306 #1502 B3: the fingerprint of the notice the browser showed, as
// noticeFingerprint() writes it. Nothing is normalised: another spelling of
// the same digest is refused, not repaired.
const FINGERPRINT = /^[0-9a-f]{64}$/;

function validInput(value: unknown): value is Input {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 2 && Object.hasOwn(input, "versionNo") && Object.hasOwn(input, "fingerprint") &&
    Number.isInteger(input.versionNo) && (input.versionNo as number) >= 1 && (input.versionNo as number) <= 2_147_483_647 &&
    typeof input.fingerprint === "string" && FINGERPRINT.test(input.fingerprint);
}

// JSON.parse keeps the last of two equal keys, so {"fingerprint":A,
// "fingerprint":B} would be read as B while a proxy or log reads A. A valid
// body has two keys, two plain string keys and one string value: exactly six
// quotes and no escape, so neither a repeat nor an escaped spelling of a key
// (fingerpr\u0069nt) gets through.
function singleKeys(text: string): boolean {
  return !text.includes("\\") && text.split('"').length === 7;
}

// Thrown inside the transaction so that withActor rolls the acknowledgment
// back: the stored notice is not the one the browser showed.
class NoticeChanged extends Error {}

const ACKNOWLEDGE_SQL = "SELECT institution.acknowledge_notice($1::uuid, $2::integer, $3::integer) AS acknowledged_at";
// The student's own row only: the policy limits it too, the predicate keeps
// the read from depending on that alone.
const STORED_FINGERPRINT_SQL = `SELECT notice_fingerprint FROM institution.notice_acknowledgment
  WHERE assignment_id = $1::uuid AND version_no = $2::integer AND student_id = app.current_user_id()`;
const CURRENT_VERSION_SQL = "SELECT current_version FROM institution.assignment WHERE id = $1::uuid";

/**
 * ZD409 comes both for a version that is no longer current and for a stored
 * acknowledgment of another text. Only the first is a version conflict; the
 * second says the notice changed. An unreadable version keeps "conflict".
 */
async function conflictKind(withActor: WithActor, sessionToken: string, assignmentId: string, versionNo: number): Promise<string> {
  try {
    const result = await withActor(sessionToken, (tx) =>
      tx.query<{ current_version: unknown }>(CURRENT_VERSION_SQL, [assignmentId]));
    return result.rows[0]?.current_version === versionNo ? "notice_changed" : "conflict";
  } catch {
    return "conflict";
  }
}

/** The RPC derives the student and institution from the cookie-backed actor. */
export async function handleAcknowledgment(request: Request, assignmentId: string, deps: Deps): Promise<Response> {
  if (deps.expectedOrigin === null) return respond(503, { error: "unavailable" });
  let allowed;
  try {
    allowed = checkMutationRequest(request, deps.expectedOrigin);
  } catch {
    return respond(503, { error: "unavailable" });
  }
  if (!allowed.ok) return respond(allowed.status, { error: allowed.reason });
  if (!UUID.test(assignmentId)) return respond(400, { error: "invalid_assignment_id" });
  const sessionToken = deps.sessionToken;
  if (!sessionToken || !TOKEN.test(sessionToken)) return respond(401, { error: "unauthorized" });
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(request.headers.get("content-type") ?? "")) {
    return respond(415, { error: "unsupported_media_type" });
  }

  const body = await readBodyWithLimit(request, MAX_BODY_BYTES, 5_000);
  if (!body.ok) return respond(body.status, { error: body.reason });
  let input: unknown;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body.bytes);
    input = JSON.parse(text);
  } catch {
    return respond(400, { error: "invalid_json" });
  }
  if (!singleKeys(text) || !validInput(input)) return respond(422, { error: "invalid_input" });
  const { versionNo, fingerprint } = input;

  try {
    const at = await deps.withActor(sessionToken, async (tx) => {
      const result = await tx.query<{ acknowledged_at: Date }>(ACKNOWLEDGE_SQL, [assignmentId, versionNo, NOTICE_TEMPLATE_VERSION]);
      const stored = await tx.query<{ notice_fingerprint: string | null }>(STORED_FINGERPRINT_SQL, [assignmentId, versionNo]);
      // #1502 B2/E3: another fingerprint, or none on a row from before
      // fingerprints, is not the text the student saw.
      if (stored.rows.length !== 1 || stored.rows[0]!.notice_fingerprint !== fingerprint) throw new NoticeChanged();
      return result.rows[0]?.acknowledged_at;
    });
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) return respond(503, { error: "unavailable" });
    return respond(200, { acknowledgedAt: at.toISOString() });
  } catch (error) {
    if (error instanceof NoticeChanged) return respond(409, { error: "notice_changed" });
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ZD401") return respond(401, { error: "unauthorized" });
    if (code === "ZD403") return respond(403, { error: "forbidden" });
    if (code === "ZD409") return respond(409, { error: await conflictKind(deps.withActor, sessionToken, assignmentId, versionNo) });
    return respond(503, { error: "unavailable" });
  }
}

export function createAcknowledgmentPostHandler(
  dependencies: { withActor?: WithActor; getRedirectUri?: () => string | undefined } = {},
): (request: NextRequest, context: { params: Promise<{ assignmentId: string }> }) => Promise<Response> {
  const actor = dependencies.withActor ?? withActor;
  const getRedirectUri = dependencies.getRedirectUri ?? (() => process.env.OIDC_REDIRECT_URI);
  return async (request, context) => {
    // Misconfiguration fails closed: a null origin answers 503.
    const origin = expectedOrigin({ NODE_ENV: process.env.NODE_ENV, OIDC_REDIRECT_URI: getRedirectUri() });
    const { assignmentId } = await context.params;
    return handleAcknowledgment(request, assignmentId, {
      withActor: actor,
      expectedOrigin: origin,
      sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
    });
  };
}
