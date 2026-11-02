import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { readAssignmentStudentNames } from "./assignment-names";

// Invented ids and names only (DAN-344 R-2, contract on #923).
const TOKEN = "T".repeat(43);
const Z1 = "00000000-0000-4000-8000-0000000000a1";
const ANA = "00000000-0000-4000-8000-000000000104";
const BORIS = "00000000-0000-4000-8000-000000000106";

type Row = Record<string, unknown>;

function database(answer: { rows?: Row[]; code?: string }) {
  const calls: { text: string; values: unknown[] | undefined; token: string | null | undefined }[] = [];
  const withActor = vi.fn(async (token: string | null | undefined, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values, token });
        if (answer.code) throw Object.assign(new Error("failed"), { code: answer.code });
        return { rows: answer.rows ?? [], rowCount: answer.rows?.length ?? 0 };
      },
    } as unknown as ActorTransaction),
  ) as unknown as WithActor;
  return { withActor, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("R-2 assignment names: the students of an assignment for its teacher, without any work", () => {
  it("asks app.teacher_assignment_names once with the assignment only, and answers the pairs", async () => {
    const db = database({ rows: [
      { student_id: ANA, given_name: "Iskra", family_name: "Prva" },
      { student_id: BORIS, given_name: null, family_name: null },
    ] });
    expect(await readAssignmentStudentNames(TOKEN, db.withActor, Z1)).toEqual({ kind: "ok", students: [
      { studentId: ANA, givenName: "Iskra", familyName: "Prva" },
      { studentId: BORIS, givenName: null, familyName: null },
    ] });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toMatchObject({ values: [Z1], token: TOKEN });
    expect(db.calls[0]!.text).toMatch(/FROM app\.teacher_assignment_names\(\$1::uuid\)$/);
    // Never the fast path, which opens works and logs them.
    expect(db.calls[0]!.text).not.toMatch(/fast_path|student_names|document|body|revision/);
  });

  it("a malformed assignment is an empty list without asking; no session asks nothing", async () => {
    const db = database({ rows: [] });
    expect(await readAssignmentStudentNames(TOKEN, db.withActor, "z-1")).toEqual({ kind: "ok", students: [] });
    expect(await readAssignmentStudentNames(undefined, db.withActor, Z1)).toEqual({ kind: "unauthorized" });
    expect(db.calls).toEqual([]);
  });

  it("ZD401 is unauthorized; any other failure or a malformed row is unavailable under its own label", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readAssignmentStudentNames(TOKEN, database({ code: "ZD401" }).withActor, Z1)).toEqual({ kind: "unauthorized" });
    expect(await readAssignmentStudentNames(TOKEN, database({ code: "57P01" }).withActor, Z1)).toEqual({ kind: "unavailable" });
    const half = { student_id: ANA, given_name: "Iskra", family_name: null };
    expect(await readAssignmentStudentNames(TOKEN, database({ rows: [half] }).withActor, Z1)).toEqual({ kind: "unavailable" });
    expect(log.mock.calls).toEqual([["assignment names read failed", "57P01"], ["assignment names read failed", "row_malformed"]]);
  });
});
