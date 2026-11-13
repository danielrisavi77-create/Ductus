import { describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { readWorkLanguageException } from "./work-language-exception-read";

// Invented assignment, work and student only. Contract: #1836 c.6858305983, class 4.
const TOKEN = "A".repeat(43);
const ID = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const DOC = "izmisljeni-rad-1";
const STUDENT = "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC";
const ME = { user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
const row = {
  student_id: STUDENT,
  language: "en",
  assignment_language: "hr",
  exception: "en",
  title: "Izmišljeni seminar",
};

/** The first query answers the session check, the second the work. */
function actor(rows: unknown[] | Error, me: unknown = ME) {
  const query = vi.fn(async (sql: string) => {
    if (rows instanceof Error) throw rows;
    const out = sql.includes("app.current_user_id()") && !sql.includes("assignment_works") ? (me ? [me] : []) : rows;
    return { rows: out, rowCount: out.length };
  });
  const withActor = vi.fn(async (_token: string, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
  return { withActor, query };
}
const read = (r: unknown[] | Error, me: unknown = ME) => readWorkLanguageException(TOKEN, ID, DOC, actor(r, me).withActor);

describe("DAN-386 one work's language exception read (P02d)", () => {
  it("finds the work's student by document id and reads the languages in one statement", async () => {
    const { withActor, query } = actor([row]);
    expect(await readWorkLanguageException(TOKEN, ID, DOC, withActor)).toEqual({
      kind: "available", assignmentId: ID.toLowerCase(), documentId: DOC,
      title: "Izmišljeni seminar", assignmentLanguage: "hr", exception: "en",
    });
    // The student id stays on the server (#1986, QA c.6861733018).
    expect(JSON.stringify(await readWorkLanguageException(TOKEN, ID, DOC, actor([row]).withActor)).toLowerCase())
      .not.toContain(STUDENT.toLowerCase());
    expect(query).toHaveBeenCalledTimes(2);
    const [sql, params] = query.mock.calls[1] as unknown as [string, unknown[]];
    expect(sql).toContain("app.assignment_works($1::uuid)");
    expect(sql).toContain("x.document_id = $2");
    expect(sql).toContain("institution.work_language($1::uuid, w.student_id)");
    expect(sql).toContain("institution.work_language_override");
    expect(params).toEqual([ID.toLowerCase(), DOC]);
  });

  it("reads a work without an exception as the assignment's language", async () => {
    expect(await read([{ ...row, language: "hr", exception: null }]))
      .toMatchObject({ kind: "available", assignmentLanguage: "hr", exception: null });
  });

  it.each([
    ["no token", undefined, ID, DOC, "signedOut"],
    ["a malformed token", "short", ID, DOC, "signedOut"],
    ["an assignment id that is not a UUID", TOKEN, "1; DROP", DOC, "notFound"],
    ["an empty document id", TOKEN, ID, "", "notFound"],
    ["a padded document id", TOKEN, ID, " doc", "notFound"],
    ["a document id with a tab", TOKEN, ID, "a\tb", "notFound"],
    ["an overlong document id", TOKEN, ID, "d".repeat(257), "notFound"],
  ])("does not contact the database with %s", async (_name, token, a, d, kind) => {
    const { withActor, query } = actor([row]);
    expect(await readWorkLanguageException(token, a, d, withActor)).toEqual({ kind });
    expect(query).not.toHaveBeenCalled();
  });

  it("reads a closed session apart and then asks assignment_works() nothing", async () => {
    for (const me of [null, { user_id: null }]) {
      const { withActor, query } = actor([row], me);
      expect(await readWorkLanguageException(TOKEN, ID, DOC, withActor)).toEqual({ kind: "signedOut" });
      expect(query).toHaveBeenCalledTimes(1);
    }
  });

  it("reads a work it cannot find, or anyone but a teacher of the work, as not found", async () => {
    expect(await read([])).toEqual({ kind: "notFound" });
    // work_language() is null for anyone but the student and a teacher of the work.
    expect(await read([{ ...row, language: null, assignment_language: null, exception: null, title: null }]))
      .toEqual({ kind: "notFound" });
  });

  it.each([
    ["two works for one document id", [row, row]],
    ["a student id that is not a UUID", [{ ...row, student_id: "../x" }]],
    ["a student id that is not text", [{ ...row, student_id: 7 }]],
    ["an upper-case assignment language", [{ ...row, assignment_language: "HR" }]],
    ["an empty assignment language", [{ ...row, assignment_language: "" }]],
    ["an unknown exception", [{ ...row, exception: "de" }]],
    ["a padded exception", [{ ...row, exception: " en" }]],
    ["a numeric exception", [{ ...row, exception: 1 }]],
    ["an unknown work language", [{ ...row, language: "de" }]],
    ["a work language the exception does not explain", [{ ...row, language: "hr" }]],
    ["no exception, but a language other than the assignment's", [{ ...row, exception: null, language: "en" }]],
    ["a title that is not text", [{ ...row, title: null }]],
  ])("is unavailable on %s, never a guess", async (_name, rows) => {
    expect(await read(rows)).toEqual({ kind: "unavailable" });
  });

  it("is unavailable on a failed read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await read(new Error("down"))).toEqual({ kind: "unavailable" });
    expect(error).toHaveBeenCalledWith("work language exception read failed");
    error.mockRestore();
  });
});
