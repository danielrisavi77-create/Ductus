// DAN-386 (M2.10-P02c, contract on #1836 c.6791532518): a teacher sets the
// language the works of an assignment are written in, against the version
// they read. The route and the RPC decide who may and refuse a stale version
// or a language locked by a submission request (409, both "conflict"); a
// refused or unconfirmed save is never resent from here.
import { parseWorkLanguage, type WorkLanguage } from "@/domain/assignment/work-language";
import { isDocumentId } from "@/domain/collaboration";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_VERSION = 2_147_483_647;

export type WorkLanguageSave =
  | { kind: "saved"; version: number }
  | { kind: "conflict" | "forbidden" | "unauthorized" | "invalid" | "unavailable" };

export async function saveAssignmentWorkLanguage(
  assignmentId: string, expectedVersion: number, language: WorkLanguage, send: typeof fetch = fetch,
): Promise<WorkLanguageSave> {
  if (!UUID.test(assignmentId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1
    || expectedVersion >= MAX_VERSION || parseWorkLanguage(language) === null) {
    return { kind: "invalid" };
  }
  try {
    const response = await send(`/api/institution/assignments/${assignmentId.toLowerCase()}/work-language`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      body: JSON.stringify({ expectedVersion, language }),
    });
    if (response.status === 401) return { kind: "unauthorized" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 409) return { kind: "conflict" };
    if ([400, 413, 415, 422].includes(response.status)) return { kind: "invalid" };
    if (response.status !== 200) return { kind: "unavailable" };
    const data: unknown = await response.json();
    const next = expectedVersion + 1;
    if (!data || typeof data !== "object" || Array.isArray(data) || !Object.hasOwn(data, "version")
      || (data as { version: unknown }).version !== next) {
      return { kind: "unavailable" };
    }
    return { kind: "saved", version: next };
  } catch {
    return { kind: "unavailable" };
  }
}

export type WorkLanguageExceptionSave =
  | { kind: "saved"; language: WorkLanguage }
  | { kind: "conflict" | "forbidden" | "unauthorized" | "invalid" | "unavailable" };

// DAN-386 (M2.10-P02d, contract on #1836 c.6858305983): one work's exception
// from the language of its assignment; null removes it. The route answers the
// language the work has afterwards: the one sent, or after a removal the
// assignment's. Anything else is unconfirmed and never shown as saved.
export async function saveWorkLanguageException(
  assignmentId: string, studentId: string, language: WorkLanguage | null, send: typeof fetch = fetch,
): Promise<WorkLanguageExceptionSave> {
  if (!UUID.test(assignmentId) || !UUID.test(studentId)
    || (language !== null && parseWorkLanguage(language) === null)) {
    return { kind: "invalid" };
  }
  try {
    const response = await send(
      `/api/institution/assignments/${assignmentId.toLowerCase()}/students/${studentId.toLowerCase()}/work-language`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        body: JSON.stringify({ language }),
      });
    if (response.status === 401) return { kind: "unauthorized" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 409) return { kind: "conflict" };
    if ([400, 413, 415, 422].includes(response.status)) return { kind: "invalid" };
    if (response.status !== 200) return { kind: "unavailable" };
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)
      || Object.keys(data).length !== 1 || !Object.hasOwn(data, "language")) {
      return { kind: "unavailable" };
    }
    const answered = parseWorkLanguage((data as { language: unknown }).language);
    if (answered === null || (language !== null && answered !== language)) return { kind: "unavailable" };
    return { kind: "saved", language: answered };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * DAN-386 (M2.10-P02d): the page for one work's language, keyed by the
 * assignment and the work's document id, never the student's id; null for
 * ids the page could not read anyway.
 */
export function workLanguageExceptionHref(assignmentId: unknown, documentId: unknown): string | null {
  if (typeof assignmentId !== "string" || !UUID.test(assignmentId) || !isDocumentId(documentId)) return null;
  return `/nastavnik/zadatak/${assignmentId.toLowerCase()}/rad/${encodeURIComponent(documentId)}/jezik`;
}
