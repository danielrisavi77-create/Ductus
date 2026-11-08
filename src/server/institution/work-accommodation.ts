import type { WithActor } from "@/server/db/with-actor";

/**
 * DAN-380 (M2.9-P01; contract on #1091, c.6722796115): thin calls to the
 * accommodation mark RPCs (D-50). The mark is a yes or no and nothing else:
 * no kind, reason or note goes in or out, and no log line here carries the
 * value. The database decides who may and when (the student of the work for
 * themselves, nothing after their submission request); here only the shape
 * of the input is checked and the ZD codes are named.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WorkAccommodationRefusal = "unauthorized" | "forbidden" | "conflict" | "invalidInput" | "unavailable";
export type WorkAccommodationRead = { kind: "ok"; marked: boolean } | { kind: "notFound" | "unavailable" };
export type WorkAccommodationWrite = { kind: "ok"; marked: boolean } | { kind: WorkAccommodationRefusal };

function refusalOf(error: unknown, what: string): { kind: WorkAccommodationRefusal } {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "ZD401") return { kind: "unauthorized" };
  if (code === "ZD403") return { kind: "forbidden" };
  if (code === "ZD409") return { kind: "conflict" };
  if (code === "ZD422") return { kind: "invalidInput" };
  console.error("work accommodation call failed", what, typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : "unknown");
  return { kind: "unavailable" };
}

/** Whether one work is marked, for its student or a teacher of the work; notFound for anyone else. */
export async function readWorkAccommodation(
  token: string | null, withActor: WithActor, assignmentId: string, studentId: string,
): Promise<WorkAccommodationRead> {
  if (!UUID.test(assignmentId) || !UUID.test(studentId)) return { kind: "notFound" };
  try {
    const value = await withActor(token, async (tx) => (await tx.query<{ marked: unknown }>(
      "SELECT institution.work_accommodation($1, $2) AS marked", [assignmentId, studentId])).rows[0]?.marked);
    if (value === null) return { kind: "notFound" };
    if (typeof value !== "boolean") throw new Error("invalid work accommodation");
    return { kind: "ok", marked: value };
  } catch (error) {
    // A refused read looks like a missing work: nothing tells the caller which.
    return refusalOf(error, "read").kind === "unavailable" ? { kind: "unavailable" } : { kind: "notFound" };
  }
}

/** The caller marks or unmarks their own work; answers whether it is marked afterwards. */
export async function setWorkAccommodation(
  token: string | null, withActor: WithActor, assignmentId: string, marked: boolean,
): Promise<WorkAccommodationWrite> {
  if (!UUID.test(assignmentId)) return { kind: "forbidden" };
  if (typeof marked !== "boolean") return { kind: "invalidInput" };
  try {
    const value = await withActor(token, async (tx) => (await tx.query<{ marked: unknown }>(
      "SELECT institution.set_work_accommodation($1, $2) AS marked", [assignmentId, marked])).rows[0]?.marked);
    if (value !== marked) throw new Error("invalid work accommodation");
    return { kind: "ok", marked: value };
  } catch (error) {
    return refusalOf(error, "change");
  }
}
