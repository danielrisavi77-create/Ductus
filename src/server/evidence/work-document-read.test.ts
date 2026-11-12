import { describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { OWN_WORK_DOCUMENT_SQL, readOwnWorkDocument, readWorkDocument, WORK_DOCUMENT_SQL } from "./work-document-read";

// #711 step B1: which document /rad?zadatak=<id> writes into. The SQL itself
// runs against the database in tests/integration/work-document-read; this
// pins the mapping and that nothing but one read reaches the database.
const TOKEN = "A".repeat(43);
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOCUMENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const row = {
  user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "student",
  version_no: 2,
  open: true,
  acknowledged: true,
  document_id: DOCUMENT,
};
const NONE = { kind: "none" };

function actor(...answers: unknown[][]) {
  const query = vi.fn(async () => {
    const rows = answers.shift();
    if (!rows) throw new Error("made-up failure");
    return { rows, rowCount: rows.length };
  });
  const withActor = vi.fn(async (_token: string, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
  return { withActor, query };
}

describe("document of an assignment for the session (#711 B1)", () => {
  it("gives the own work's document only to an active student who may write now", async () => {
    const { withActor, query } = actor([row]);
    expect(await readWorkDocument(TOKEN, ID, withActor)).toEqual({ kind: "document", documentId: DOCUMENT });
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(WORK_DOCUMENT_SQL, [ID]);
  });

  it("says the work is not opened yet when the student may write but has no work", async () => {
    for (const documentId of [null, ""]) {
      const { withActor } = actor([{ ...row, document_id: documentId }]);
      expect(await readWorkDocument(TOKEN, ID, withActor)).toEqual({ kind: "notOpened" });
    }
  });

  it("names no document before the current version is acknowledged or the assignment opens", async () => {
    for (const change of [{ acknowledged: false }, { acknowledged: null }, { open: false }, { open: null }]) {
      const { withActor } = actor([{ ...row, ...change }]);
      expect(await readWorkDocument(TOKEN, ID, withActor), JSON.stringify(change)).toEqual({ kind: "notAccepting" });
    }
  });

  it("gives one answer to anyone who is not an active student, with no id", async () => {
    const others = [
      { ...row, user_id: null },
      { ...row, role: "teacher" },
      { ...row, role: null },
      { ...row, version_no: null },
    ];
    for (const other of others) {
      const { withActor } = actor([other]);
      expect(await readWorkDocument(TOKEN, ID, withActor), JSON.stringify(other)).toEqual(NONE);
    }
    const { withActor } = actor([]);
    expect(await readWorkDocument(TOKEN, ID, withActor)).toEqual(NONE);
  });

  it("answers none on a failed read", async () => {
    const { withActor } = actor();
    expect(await readWorkDocument(TOKEN, ID, withActor)).toEqual(NONE);
  });

  it("does not reach the database without a well-formed token and assignment id", async () => {
    const { withActor } = actor([row]);
    for (const [token, id] of [
      [undefined, ID], ["", ID], ["short", ID], [`${TOKEN}=`, ID],
      [TOKEN, null], [TOKEN, ""], [TOKEN, "1; DROP"], [TOKEN, `${ID}x`],
    ] as const) {
      expect(await readWorkDocument(token, id, withActor), `${token} ${id}`).toEqual(NONE);
    }
    expect(withActor).not.toHaveBeenCalled();
  });

  it("only reads: one SELECT, identity from the session, no write", () => {
    expect(WORK_DOCUMENT_SQL).toMatch(/^WITH me AS \(/);
    expect(WORK_DOCUMENT_SQL).toContain("app.current_user_id()");
    expect(WORK_DOCUMENT_SQL).toContain("app.current_institution_id()");
    expect(WORK_DOCUMENT_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|open_student_work|FOR (SHARE|UPDATE))\b/i);
    expect(WORK_DOCUMENT_SQL).not.toContain(";");
  });
});

// DAN-294 (review FAIL c.6820050088): the own work apart from the right to write.
describe("the session's own work for an assignment, apart from the right to write (DAN-294)", () => {
  it("names the own document from ownership alone, one read", async () => {
    const { withActor, query } = actor([{ document_id: DOCUMENT }]);
    expect(await readOwnWorkDocument(TOKEN, ID, withActor)).toEqual({ kind: "document", documentId: DOCUMENT });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(OWN_WORK_DOCUMENT_SQL, [ID]);
  });

  it.each([
    ["no own row", []], ["a null id", [{ document_id: null }]], ["an empty id", [{ document_id: "" }]],
  ])("answers none for %s and for a failed read", async (_name, rows) => {
    expect(await readOwnWorkDocument(TOKEN, ID, actor(rows).withActor)).toEqual(NONE);
    expect(await readOwnWorkDocument(TOKEN, ID, actor().withActor)).toEqual(NONE);
  });

  it("does not reach the database without a well-formed token and assignment id", async () => {
    const { withActor } = actor([{ document_id: DOCUMENT }]);
    for (const [token, id] of [[undefined, ID], ["short", ID], [TOKEN, null], [TOKEN, "1; DROP"]] as const) {
      expect(await readOwnWorkDocument(token, id, withActor)).toEqual(NONE);
    }
    expect(withActor).not.toHaveBeenCalled();
  });

  it("only reads own rows: no membership, notice or write condition, no write", () => {
    expect(OWN_WORK_DOCUMENT_SQL).toContain("p.principal_id = app.current_user_id()");
    expect(OWN_WORK_DOCUMENT_SQL).toContain("p.institution_id = app.current_institution_id()");
    expect(OWN_WORK_DOCUMENT_SQL).not.toMatch(/actor_assignment_role|notice_acknowledgment|course_member|opens_at/);
    expect(OWN_WORK_DOCUMENT_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|open_student_work|FOR (SHARE|UPDATE))\b/i);
    expect(OWN_WORK_DOCUMENT_SQL).not.toContain(";");
  });
});
