import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { readAssignmentWorks, readAssignmentWorksMany, worksOf } from "./assignment-works";

// Invented ids only.
const TOKEN = "T".repeat(43);
const CANARY = "kanarinac-radovi-3c9d";
const Z1 = "00000000-0000-4000-8000-0000000000a1";
const ANA = "00000000-0000-4000-8000-000000000104";
const DORA = "00000000-0000-4000-8000-000000000105";

type Row = Record<string, unknown>;

function database(answer: { rows?: Row[]; code?: string }) {
  const calls: { text: string; values: unknown[] | undefined; token: string | null | undefined }[] = [];
  const withActor = vi.fn(async (token: string | null | undefined, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values, token });
        if (answer.code) throw Object.assign(new Error(`do not leak ${CANARY}`), { code: answer.code });
        return { rows: answer.rows ?? [], rowCount: answer.rows?.length ?? 0 };
      },
    } as unknown as ActorTransaction),
  ) as unknown as WithActor;
  return { withActor, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("B2: the works of an assignment for its teacher", () => {
  it("asks the database with the session and the assignment only, and returns its rows in its order", async () => {
    const db = database({ rows: [{ student_id: ANA, document_id: "doc-a" }, { student_id: DORA, document_id: "doc-d" }] });
    expect(await readAssignmentWorks(TOKEN, Z1, db.withActor)).toEqual({
      kind: "ok",
      works: [{ studentId: ANA, documentId: "doc-a" }, { studentId: DORA, documentId: "doc-d" }],
    });
    expect(db.calls).toEqual([{
      text: "SELECT student_id::text, document_id FROM app.assignment_works($1::uuid)", values: [Z1], token: TOKEN,
    }]);
  });

  it("an empty answer is an empty list: the database gives no other caller anything", async () => {
    expect(await readAssignmentWorks(TOKEN, Z1, database({ rows: [] }).withActor)).toEqual({ kind: "ok", works: [] });
  });

  it.each([undefined, "", "T".repeat(42), `${"T".repeat(42)}!`])("no well-formed session cookie (%s) asks nothing", async (token) => {
    const db = database({ rows: [] });
    expect(await readAssignmentWorks(token, Z1, db.withActor)).toEqual({ kind: "unauthorized" });
    expect(db.calls).toEqual([]);
  });

  it.each([null, "", "nije-uuid", `${Z1}x`, `'${Z1}'`])("a malformed assignment (%s) is the same empty list, without asking", async (id) => {
    const db = database({ rows: [{ student_id: ANA, document_id: "doc-a" }] });
    expect(await readAssignmentWorks(TOKEN, id, db.withActor)).toEqual({ kind: "ok", works: [] });
    expect(db.calls).toEqual([]);
  });

  it("an upper-case assignment id is still that assignment", async () => {
    const db = database({ rows: [] });
    await readAssignmentWorks(TOKEN, Z1.toUpperCase(), db.withActor);
    expect(db.calls[0]?.values).toEqual([Z1.toUpperCase()]);
  });

  it("a session the database does not accept is unauthorized", async () => {
    expect(await readAssignmentWorks(TOKEN, Z1, database({ code: "ZD401" }).withActor)).toEqual({ kind: "unauthorized" });
  });

  it("any other failure is unavailable and logs only the SQLSTATE", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readAssignmentWorks(TOKEN, Z1, database({ code: "57P01" }).withActor)).toEqual({ kind: "unavailable" });
    expect(await readAssignmentWorks(TOKEN, Z1, database({ code: `x ${CANARY}` }).withActor)).toEqual({ kind: "unavailable" });
    expect(log.mock.calls).toEqual([["assignment works read failed", "57P01"], ["assignment works read failed", "unknown"]]);
    expect(JSON.stringify(log.mock.calls)).not.toContain(CANARY);
  });

  it.each([
    ["a student id that is not a uuid", { student_id: "ana", document_id: "doc-a" }],
    ["a missing document id", { student_id: ANA, document_id: null }],
    ["an empty document id", { student_id: ANA, document_id: "" }],
    ["a document id with a control character", { student_id: ANA, document_id: "doc\na" }],
    ["a document id with outer blanks", { student_id: ANA, document_id: " doc-a" }],
    ["a document id over 256 characters", { student_id: ANA, document_id: "d".repeat(257) }],
  ])("a row with %s makes the whole answer unavailable", async (_name, row) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(worksOf([row])).toBeNull();
    expect(await readAssignmentWorks(TOKEN, Z1, database({ rows: [{ student_id: DORA, document_id: "doc-d" }, row] }).withActor))
      .toEqual({ kind: "unavailable" });
  });

  it("a document id of 256 characters is accepted", () => {
    expect(worksOf([{ student_id: ANA, document_id: "d".repeat(256) }])).toEqual([{ studentId: ANA, documentId: "d".repeat(256) }]);
  });
});

describe("F-142: the works of many assignments in one read", () => {
  const Z2 = "00000000-0000-4000-8000-0000000000a2";
  const Z3 = "00000000-0000-4000-8000-0000000000a3";

  it("asks once, in one transaction, with every well-formed id once, and groups the rows by assignment", async () => {
    const db = database({ rows: [
      { assignment_id: Z1, student_id: ANA, document_id: "doc-a" },
      { assignment_id: Z1, student_id: DORA, document_id: "doc-d" },
      { assignment_id: Z3, student_id: ANA, document_id: "doc-a3" },
    ] });
    const answer = await readAssignmentWorksMany(TOKEN, [Z1, Z2, Z1.toUpperCase(), "z-1", Z3], db.withActor);
    expect(answer.kind).toBe("ok");
    expect(answer.kind === "ok" ? Object.fromEntries(answer.works) : null).toEqual({
      [Z1]: [{ studentId: ANA, documentId: "doc-a" }, { studentId: DORA, documentId: "doc-d" }],
      [Z2]: [],
      [Z3]: [{ studentId: ANA, documentId: "doc-a3" }],
    });
    expect(db.withActor).toHaveBeenCalledTimes(1);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toMatchObject({ values: [[Z1, Z2, Z3]], token: TOKEN });
    expect(db.calls[0]!.text).toMatch(/CROSS JOIN LATERAL app\.assignment_works\(a\.id\)/);
  });

  it("does not touch the database without a session or without an assignment", async () => {
    const db = database({ rows: [] });
    expect(await readAssignmentWorksMany(undefined, [Z1], db.withActor)).toEqual({ kind: "unauthorized" });
    expect(await readAssignmentWorksMany("kratko", [Z1], db.withActor)).toEqual({ kind: "unauthorized" });
    const none = await readAssignmentWorksMany(TOKEN, ["z-1"], db.withActor);
    expect(none.kind === "ok" ? none.works.size : -1).toBe(0);
    expect(db.calls).toEqual([]);
  });

  it("answers for the whole page on a refusal, a failure or a row it cannot vouch for, and logs no detail", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readAssignmentWorksMany(TOKEN, [Z1], database({ code: "ZD401" }).withActor)).toEqual({ kind: "unauthorized" });
    expect(await readAssignmentWorksMany(TOKEN, [Z1], database({ code: `x ${CANARY}` }).withActor)).toEqual({ kind: "unavailable" });
    for (const row of [
      { assignment_id: Z2, student_id: ANA, document_id: "doc-a" },
      { assignment_id: Z1, student_id: "ana", document_id: "doc-a" },
      { assignment_id: Z1, student_id: ANA, document_id: " doc" },
    ]) {
      expect(await readAssignmentWorksMany(TOKEN, [Z1], database({ rows: [row] }).withActor)).toEqual({ kind: "unavailable" });
    }
    expect(JSON.stringify(error.mock.calls)).not.toMatch(new RegExp(`${CANARY}|doc-a|${ANA}`));
  });

  // DAN-332 PR 4: the page now takes its works from the submissions read (R1), which
  // carries each work with the state of its submission; F-142 still holds there.
  it("the teacher's home page reads the works once, never once per assignment", () => {
    const page = readFileSync(new URL("../../../app/nastavnik/page.tsx", import.meta.url), "utf8");
    expect(page.match(/readAssignmentSubmissionsMany\(/g)).toHaveLength(1);
    expect(page).not.toMatch(/readAssignmentWorks(Many)?\(|readAssignmentSubmissions\(/);
  });
});