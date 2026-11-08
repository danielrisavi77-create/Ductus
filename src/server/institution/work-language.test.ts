import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";
import { readWorkLanguage, setAssignmentWorkLanguage, setWorkLanguage } from "./work-language";

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

describe("work language RPC calls", () => {
  it("reads the language of a work and passes only the session, assignment and student", async () => {
    const { query, withActor } = port(rows({ language: "en" }));
    expect(await readWorkLanguage(TOKEN, withActor, ASSIGNMENT, STUDENT)).toEqual({ kind: "ok", language: "en" });
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenCalledExactlyOnceWith("SELECT institution.work_language($1, $2) AS language", [ASSIGNMENT, STUDENT]);
  });

  it("reads a work the caller may not see as missing, and a broken answer as unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const result of [rows({ language: null }), fails("ZD401"), fails("ZD403")]) {
      expect(await readWorkLanguage(TOKEN, port(result).withActor, ASSIGNMENT, STUDENT)).toEqual({ kind: "notFound" });
    }
    for (const result of [rows(null), rows({ language: "de" }), rows({ language: "HR" }), fails("57014")]) {
      expect(await readWorkLanguage(TOKEN, port(result).withActor, ASSIGNMENT, STUDENT)).toEqual({ kind: "unavailable" });
    }
    const { withActor } = port(rows({ language: "hr" }));
    expect(await readWorkLanguage(TOKEN, withActor, "not-a-uuid", STUDENT)).toEqual({ kind: "notFound" });
    expect(withActor).not.toHaveBeenCalled();
  });

  it("sets or removes the exception of a work and answers the language it has afterwards", async () => {
    for (const language of ["hr", "en", null] as const) {
      const { query, withActor } = port(rows({ language: language ?? "hr" }));
      expect(await setWorkLanguage(TOKEN, withActor, ASSIGNMENT, STUDENT, language))
        .toEqual({ kind: "ok", language: language ?? "hr" });
      expect(query).toHaveBeenCalledExactlyOnceWith(
        "SELECT institution.set_work_language($1, $2, $3) AS language", [ASSIGNMENT, STUDENT, language]);
    }
  });

  it("sets the assignment language against the expected version and answers the current one", async () => {
    const { query, withActor } = port(rows({ version: 3 }));
    expect(await setAssignmentWorkLanguage(TOKEN, withActor, ASSIGNMENT, 2, "en")).toEqual({ kind: "ok", version: 3 });
    expect(query).toHaveBeenCalledExactlyOnceWith(
      "SELECT institution.set_assignment_work_language($1, $2, $3) AS version", [ASSIGNMENT, 2, "en"]);
  });

  it("names the ZD codes of both writes and logs only the code of anything else", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cases = [["ZD401", "unauthorized"], ["ZD403", "forbidden"], ["ZD409", "conflict"], ["ZD422", "invalidInput"],
      ["40001", "unavailable"], ["secret detail", "unavailable"]] as const;
    for (const [code, kind] of cases) {
      expect(await setWorkLanguage(TOKEN, port(fails(code)).withActor, ASSIGNMENT, STUDENT, "en")).toEqual({ kind });
      expect(await setAssignmentWorkLanguage(TOKEN, port(fails(code)).withActor, ASSIGNMENT, 2, "en")).toEqual({ kind });
    }
    expect(error.mock.calls.flat().join(" ")).not.toContain("secret");
    expect(error.mock.calls.flat()).toContain("40001");
    for (const result of [rows(null), rows({ version: "3" }), rows({ version: 1 })]) {
      expect(await setAssignmentWorkLanguage(TOKEN, port(result).withActor, ASSIGNMENT, 2, "en")).toEqual({ kind: "unavailable" });
    }
    for (const result of [rows(null), rows({ language: "de" })]) {
      expect(await setWorkLanguage(TOKEN, port(result).withActor, ASSIGNMENT, STUDENT, "en")).toEqual({ kind: "unavailable" });
    }
  });

  it("refuses a malformed input before the database", async () => {
    const { withActor } = port(rows({ version: 3 }));
    const unchecked = (value: string) => value as "hr";
    expect(await setWorkLanguage(TOKEN, withActor, ASSIGNMENT, STUDENT, unchecked("HR"))).toEqual({ kind: "invalidInput" });
    expect(await setWorkLanguage(TOKEN, withActor, ASSIGNMENT, "x", "hr")).toEqual({ kind: "forbidden" });
    expect(await setAssignmentWorkLanguage(TOKEN, withActor, ASSIGNMENT, 0, "hr")).toEqual({ kind: "invalidInput" });
    expect(await setAssignmentWorkLanguage(TOKEN, withActor, ASSIGNMENT, 1.5, "hr")).toEqual({ kind: "invalidInput" });
    expect(await setAssignmentWorkLanguage(TOKEN, withActor, ASSIGNMENT, 2, unchecked(""))).toEqual({ kind: "invalidInput" });
    expect(await setAssignmentWorkLanguage(TOKEN, withActor, "x", 2, "hr")).toEqual({ kind: "forbidden" });
    expect(withActor).not.toHaveBeenCalled();
  });
});
