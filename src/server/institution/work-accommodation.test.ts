import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";
import { readWorkAccommodation, setWorkAccommodation } from "./work-accommodation";

const ASSIGNMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STUDENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN = "A".repeat(43);

function port(result: Promise<unknown>) {
  const query = vi.fn().mockReturnValue(result);
  const withActor = vi.fn(async (_token: unknown, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as ActorTransaction)) as unknown as WithActor;
  return { query, withActor };
}
const rows = (row: Record<string, unknown> | null) => Promise.resolve({ rows: row === null ? [] : [row] });
const fails = (code: string) => Promise.reject(Object.assign(new Error("database error"), { code }));

afterEach(() => { vi.restoreAllMocks(); });

describe("work accommodation RPC calls", () => {
  it("reads whether a work is marked and passes only the session, assignment and student", async () => {
    for (const marked of [true, false]) {
      const { query, withActor } = port(rows({ marked }));
      expect(await readWorkAccommodation(TOKEN, withActor, ASSIGNMENT, STUDENT)).toEqual({ kind: "ok", marked });
      expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
      expect(query).toHaveBeenCalledExactlyOnceWith(
        "SELECT institution.work_accommodation($1, $2) AS marked", [ASSIGNMENT, STUDENT]);
    }
  });

  it("reads a work the caller may not see as missing, and a broken answer as unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const result of [rows({ marked: null }), fails("ZD401"), fails("ZD403")]) {
      expect(await readWorkAccommodation(TOKEN, port(result).withActor, ASSIGNMENT, STUDENT)).toEqual({ kind: "notFound" });
    }
    for (const result of [rows(null), rows({ marked: "t" }), rows({ marked: 1 }), fails("57014")]) {
      expect(await readWorkAccommodation(TOKEN, port(result).withActor, ASSIGNMENT, STUDENT)).toEqual({ kind: "unavailable" });
    }
    const { withActor } = port(rows({ marked: true }));
    expect(await readWorkAccommodation(TOKEN, withActor, "not-a-uuid", STUDENT)).toEqual({ kind: "notFound" });
    expect(await readWorkAccommodation(TOKEN, withActor, ASSIGNMENT, "not-a-uuid")).toEqual({ kind: "notFound" });
    expect(withActor).not.toHaveBeenCalled();
  });

  it("marks or unmarks the caller's own work and answers the state afterwards", async () => {
    for (const marked of [true, false]) {
      const { query, withActor } = port(rows({ marked }));
      expect(await setWorkAccommodation(TOKEN, withActor, ASSIGNMENT, marked)).toEqual({ kind: "ok", marked });
      expect(query).toHaveBeenCalledExactlyOnceWith(
        "SELECT institution.set_work_accommodation($1, $2) AS marked", [ASSIGNMENT, marked]);
    }
  });

  it("names the ZD codes of the write and logs neither the value nor the error text", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cases = [["ZD401", "unauthorized"], ["ZD403", "forbidden"], ["ZD409", "conflict"], ["ZD422", "invalidInput"],
      ["40001", "unavailable"], ["secret detail", "unavailable"]] as const;
    for (const [code, kind] of cases) {
      expect(await setWorkAccommodation(TOKEN, port(fails(code)).withActor, ASSIGNMENT, true)).toEqual({ kind });
    }
    for (const result of [rows(null), rows({ marked: false }), rows({ marked: "t" })]) {
      expect(await setWorkAccommodation(TOKEN, port(result).withActor, ASSIGNMENT, true)).toEqual({ kind: "unavailable" });
    }
    const logged = error.mock.calls.flat().map(String);
    expect(logged.join(" ")).not.toContain("secret");
    expect(logged).toContain("40001");
    expect(logged.some((part) => /true|false|accommodation (?!call)/.test(part))).toBe(false);
  });

  it("refuses a malformed input before the database", async () => {
    const { withActor } = port(rows({ marked: true }));
    expect(await setWorkAccommodation(TOKEN, withActor, "not-a-uuid", true)).toEqual({ kind: "forbidden" });
    expect(await setWorkAccommodation(TOKEN, withActor, ASSIGNMENT, "true" as unknown as boolean))
      .toEqual({ kind: "invalidInput" });
    expect(await setWorkAccommodation(TOKEN, withActor, ASSIGNMENT, null as unknown as boolean))
      .toEqual({ kind: "invalidInput" });
    expect(withActor).not.toHaveBeenCalled();
  });
});
