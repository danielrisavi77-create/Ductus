import { parseWorkLanguage, type WorkLanguage } from "@/domain/assignment/work-language";
import type { WithActor } from "@/server/db/with-actor";

/**
 * DAN-386 (M2.10-P01; contract on #1091, c.6720558678): thin calls to the
 * work language RPCs. The database decides who may and when (teacher or
 * mentor of the work, nothing after a submission request); here only the
 * shape of the input is checked and the ZD codes are named.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WorkLanguageRefusal = "unauthorized" | "forbidden" | "conflict" | "invalidInput" | "unavailable";
export type WorkLanguageRead = { kind: "ok"; language: WorkLanguage } | { kind: "notFound" | "unavailable" };
export type WorkLanguageWrite = { kind: "ok"; language: WorkLanguage } | { kind: WorkLanguageRefusal };
export type AssignmentLanguageWrite = { kind: "ok"; version: number } | { kind: WorkLanguageRefusal };

function refusalOf(error: unknown, what: string): { kind: WorkLanguageRefusal } {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "ZD401") return { kind: "unauthorized" };
  if (code === "ZD403") return { kind: "forbidden" };
  if (code === "ZD409") return { kind: "conflict" };
  if (code === "ZD422") return { kind: "invalidInput" };
  console.error("work language call failed", what, typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : "unknown");
  return { kind: "unavailable" };
}

/** The language of one work for its student or a teacher of the work; notFound for anyone else. */
export async function readWorkLanguage(
  token: string | null, withActor: WithActor, assignmentId: string, studentId: string,
): Promise<WorkLanguageRead> {
  if (!UUID.test(assignmentId) || !UUID.test(studentId)) return { kind: "notFound" };
  try {
    const value = await withActor(token, async (tx) => (await tx.query<{ language: unknown }>(
      "SELECT institution.work_language($1, $2) AS language", [assignmentId, studentId])).rows[0]?.language);
    if (value === null) return { kind: "notFound" };
    const language = parseWorkLanguage(value);
    if (language === null) throw new Error("invalid work language");
    return { kind: "ok", language };
  } catch (error) {
    // A refused read looks like a missing work: nothing tells the caller which.
    return refusalOf(error, "work language read").kind === "unavailable" ? { kind: "unavailable" } : { kind: "notFound" };
  }
}

/** Sets the language of one work, or with null removes its exception; answers the language it has afterwards. */
export async function setWorkLanguage(
  token: string | null, withActor: WithActor, assignmentId: string, studentId: string, language: WorkLanguage | null,
): Promise<WorkLanguageWrite> {
  if (!UUID.test(assignmentId) || !UUID.test(studentId)) return { kind: "forbidden" };
  if (language !== null && parseWorkLanguage(language) === null) return { kind: "invalidInput" };
  try {
    const value = await withActor(token, async (tx) => (await tx.query<{ language: unknown }>(
      "SELECT institution.set_work_language($1, $2, $3) AS language", [assignmentId, studentId, language])).rows[0]?.language);
    const after = parseWorkLanguage(value);
    if (after === null) throw new Error("invalid work language");
    return { kind: "ok", language: after };
  } catch (error) {
    return refusalOf(error, "work language change");
  }
}

/** Sets the language of the assignment against the version the teacher saw; answers the current version. */
export async function setAssignmentWorkLanguage(
  token: string | null, withActor: WithActor, assignmentId: string, expectedVersion: number, language: WorkLanguage,
): Promise<AssignmentLanguageWrite> {
  if (!UUID.test(assignmentId)) return { kind: "forbidden" };
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || parseWorkLanguage(language) === null) {
    return { kind: "invalidInput" };
  }
  try {
    const value = await withActor(token, async (tx) => (await tx.query<{ version: unknown }>(
      "SELECT institution.set_assignment_work_language($1, $2, $3) AS version",
      [assignmentId, expectedVersion, language])).rows[0]?.version);
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < expectedVersion) {
      throw new Error("invalid assignment version");
    }
    return { kind: "ok", version: value };
  } catch (error) {
    return refusalOf(error, "assignment work language change");
  }
}
