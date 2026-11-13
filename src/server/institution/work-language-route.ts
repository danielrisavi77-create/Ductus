import { parseWorkLanguage, type WorkLanguage } from "@/domain/assignment/work-language";
import { isDocumentId } from "@/domain/collaboration";
import type { WithActor } from "@/server/db/with-actor";
import { readJsonMutation, respond } from "./mutation-route";
import {
  setAssignmentWorkLanguage, setWorkLanguage, setWorkLanguageForWork, type WorkLanguageRefusal,
} from "./work-language";

export const MAX_WORK_LANGUAGE_BODY_BYTES = 128;
const MAX_VERSION = 2_147_483_647;

export interface WorkLanguageRouteDeps {
  withActor: WithActor;
  expectedOrigin: string;
  sessionToken?: string;
}

const REFUSAL: Record<WorkLanguageRefusal, [number, string]> = {
  unauthorized: [401, "unauthorized"],
  forbidden: [403, "forbidden"],
  conflict: [409, "conflict"],
  invalidInput: [422, "invalid_input"],
  unavailable: [503, "unavailable"],
};
const refuse = (kind: WorkLanguageRefusal) => respond(REFUSAL[kind][0], { error: REFUSAL[kind][1] });
const invalidInput = () => respond(422, { error: "invalid_input" });

/** A plain object whose own keys are exactly `keys`, in any order; anything else is null. */
function closedBody(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) return null;
  return value as Record<string, unknown>;
}

// DAN-386 (M2.10-P02b, contract on #1091): a teacher of the assignment sets
// the language in which its works are written, against the version they saw.
// The assignment comes only from the path, the caller only from the session.
// The existing SECURITY DEFINER RPC decides who may (ZD403 alike for another
// teacher's, another institution's or a missing assignment) and, under a row
// lock, refuses a stale version or a work already asked to be submitted
// (ZD409, both "conflict"): of two requests with the same version, one writes.
export async function handleAssignmentWorkLanguageRequest(
  request: Request, assignmentId: unknown, deps: WorkLanguageRouteDeps,
): Promise<Response> {
  const input = await readJsonMutation(request, [assignmentId], deps, MAX_WORK_LANGUAGE_BODY_BYTES);
  if (!input.ok) return input.response;
  const body = closedBody(input.value, ["expectedVersion", "language"]);
  const expectedVersion = body?.expectedVersion;
  const language = parseWorkLanguage(body?.language);
  if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1
    || (expectedVersion as number) > MAX_VERSION || language === null) {
    return invalidInput();
  }
  const result = await setAssignmentWorkLanguage(
    input.sessionToken, deps.withActor, assignmentId as string, expectedVersion as number, language,
  );
  return result.kind === "ok" ? respond(200, { version: result.version }) : refuse(result.kind);
}

/** The body of a work's exception: exactly {language}, a work language or null; undefined when it is not. */
function exceptionLanguage(value: unknown): WorkLanguage | null | undefined {
  const body = closedBody(value, ["language"]);
  if (!body) return undefined;
  if (body.language === null) return null;
  return parseWorkLanguage(body.language) ?? undefined;
}

// One work's exception from the language of its assignment; null removes it.
// The assignment and the student come only from the path. The RPC refuses a
// student who is not in the assignment exactly as another teacher's work
// (ZD403) and answers the language the work has afterwards.
export async function handleWorkLanguageRequest(
  request: Request, assignmentId: unknown, studentId: unknown, deps: WorkLanguageRouteDeps,
): Promise<Response> {
  const input = await readJsonMutation(request, [assignmentId, studentId], deps, MAX_WORK_LANGUAGE_BODY_BYTES);
  if (!input.ok) return input.response;
  const language = exceptionLanguage(input.value);
  if (language === undefined) return invalidInput();
  const result = await setWorkLanguage(
    input.sessionToken, deps.withActor, assignmentId as string, studentId as string, language,
  );
  return result.kind === "ok" ? respond(200, { language: result.language }) : refuse(result.kind);
}

// DAN-386 (#1986, QA c.6861733018): the same change keyed by the work's
// document id, as the page for one work links it, so the page never holds the
// student's id. The server names the student from the document for a teacher
// of the assignment; someone else's or a missing work is refused as forbidden.
// "." and ".." are refused: a browser would resolve them as path steps.
export async function handleWorkLanguageByDocumentRequest(
  request: Request, assignmentId: unknown, documentId: unknown, deps: WorkLanguageRouteDeps,
): Promise<Response> {
  const input = await readJsonMutation(request, [assignmentId], deps, MAX_WORK_LANGUAGE_BODY_BYTES);
  if (!input.ok) return input.response;
  if (!isDocumentId(documentId) || documentId === "." || documentId === "..") return invalidInput();
  const language = exceptionLanguage(input.value);
  if (language === undefined) return invalidInput();
  const result = await setWorkLanguageForWork(
    input.sessionToken, deps.withActor, assignmentId as string, documentId, language,
  );
  return result.kind === "ok" ? respond(200, { language: result.language }) : refuse(result.kind);
}
