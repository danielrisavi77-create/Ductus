import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { readWorkAccommodationsMany } from "./work-accommodations-read";

// Invented ids only.
const A1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const S1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const S2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const TOKEN = "A".repeat(43);

function port(result: Promise<unknown>) {
  const query = vi.fn().mockReturnValue(result);
  const withActor = vi.fn(async (_token: unknown, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as ActorTransaction)) as unknown as WithActor;
  return { query, withActor };
}
const rows = (...list: Record<string, unknown>[]) => Promise.resolve({ rows: list, rowCount: list.length });
const fails = (code: string) => Promise.reject(Object.assign(new Error("database error"), { code }));
const row = (assignment_id: string, student_id: string, marked: unknown) => ({ assignment_id, student_id, marked });
const PAIRS = [{ assignmentId: A1, studentId: S1 }, { assignmentId: A1, studentId: S2 }, { assignmentId: A2, studentId: S1 }];

afterEach(() => { vi.restoreAllMocks(); });

describe("readWorkAccommodationsMany", () => {
  it("asks once, in one statement, for every pair, and passes only the session and the ids", async () => {
    const { query, withActor } = port(rows(row(A1, S1, true), row(A1, S2, false), row(A2, S1, null)));
    const read = await readWorkAccommodationsMany(TOKEN, PAIRS, withActor);
    expect(read).toEqual({ kind: "ok", marked: { [A1]: [S1], [A2]: [] } });
    expect(withActor).toHaveBeenCalledExactlyOnceWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenCalledOnce();
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("institution.work_accommodation(");
    expect(values).toEqual([[A1, A1, A2], [S1, S2, S1]]);
  });

  // Input classes of the contract (#1091 c.6725196643), one row each.
  it.each([
    ["true marks the work", [row(A1, S1, true)], { kind: "ok", marked: { [A1]: [S1] } }],
    ["false marks nothing", [row(A1, S1, false)], { kind: "ok", marked: { [A1]: [] } }],
    ["null (the reader no longer answers for the work) marks nothing", [row(A1, S1, null)], { kind: "ok", marked: { [A1]: [] } }],
    ["a missing row is not \"no mark\"", [], { kind: "unavailable" }],
    ["a string is not a mark", [row(A1, S1, "true")], { kind: "unavailable" }],
    ["a number is not a mark", [row(A1, S1, 1)], { kind: "unavailable" }],
    ["a pair that was not asked for", [row(A2, S2, true)], { kind: "unavailable" }],
    ["the same pair twice", [row(A1, S1, false), row(A1, S1, true)], { kind: "unavailable" }],
    ["an id that is not a string", [{ assignment_id: 1, student_id: S1, marked: true }], { kind: "unavailable" }],
  ])("%s", async (_name, answer, expected) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { withActor } = port(rows(...answer));
    expect(await readWorkAccommodationsMany(TOKEN, [{ assignmentId: A1, studentId: S1 }], withActor)).toEqual(expected);
  });

  it("answers a failed read as unavailable and logs only the SQLSTATE, never a value", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const code of ["ZD401", "ZD403", "57014", "not a code"]) {
      expect(await readWorkAccommodationsMany(TOKEN, PAIRS, port(fails(code)).withActor)).toEqual({ kind: "unavailable" });
    }
    const logged = error.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("ZD401");
    expect(logged).toContain("unknown");
    expect(logged).not.toContain("not a code");
    for (const id of [A1, A2, S1, S2, TOKEN]) expect(logged).not.toContain(id);
  });

  it("does not ask without a session, without a pair, or for a malformed id", async () => {
    const { withActor } = port(rows(row(A1, S1, true)));
    expect(await readWorkAccommodationsMany(undefined, PAIRS, withActor)).toEqual({ kind: "unavailable" });
    expect(await readWorkAccommodationsMany("short", PAIRS, withActor)).toEqual({ kind: "unavailable" });
    expect(await readWorkAccommodationsMany(TOKEN, [], withActor)).toEqual({ kind: "ok", marked: {} });
    expect(await readWorkAccommodationsMany(TOKEN, [{ assignmentId: "x", studentId: S1 }, { assignmentId: A1, studentId: "'; --" }], withActor))
      .toEqual({ kind: "ok", marked: {} });
    expect(withActor).not.toHaveBeenCalled();
  });

  it("asks for a pair once however often it is given, in lower case", async () => {
    const { query, withActor } = port(rows(row(A1, S1, true)));
    const read = await readWorkAccommodationsMany(TOKEN,
      [{ assignmentId: A1.toUpperCase(), studentId: S1 }, { assignmentId: A1, studentId: S1.toUpperCase() }], withActor);
    expect(read).toEqual({ kind: "ok", marked: { [A1]: [S1] } });
    expect((query.mock.calls[0] as [string, unknown[]])[1]).toEqual([[A1], [S1]]);
  });
});
