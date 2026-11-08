import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { readNotice } from "./assignment-notice-read";
import { assignmentParam, readWorkContext } from "./work-context-read";

// #476 contract 6280487079: the top bar of /rad names the course and the
// assignment only from an RLS read; every other outcome shows nothing. All
// names below are invented.
const TOKEN = "A".repeat(43);
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const notice = {
  user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "student",
  course_name: "Izmišljeni kolegij",
  version_no: 1,
  title: "Izmišljeni zadatak o knjižnicama",
  instructions: "Upute za izmišljeni zadatak.",
  work_type: "essay",
  evidence_profile: "basic",
  opens_at: new Date("2026-11-02T08:00:00Z"),
  due_at: new Date("2026-11-30T22:59:00Z"),
  ai_policy: "prohibited",
  ai_purposes: [],
  word_min: null,
  word_max: null,
  acknowledged_at: new Date("2026-11-03T09:00:00Z"),
};
const NONE = { kind: "none" };

/** One answer per query, in order; a thrown value fails that query. */
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

describe("/rad work context read", () => {
  it("takes the id only as one well-formed UUID", () => {
    expect(assignmentParam(ID)).toBe(ID);
    expect(assignmentParam(ID.toUpperCase())).toBe(ID.toUpperCase());
    for (const raw of [undefined, "", "1; DROP", `${ID} `, `${ID}x`, "../zadatak", [ID], [ID, ID]]) {
      expect(assignmentParam(raw), String(raw)).toBeNull();
    }
  });

  it("does not contact the DB without an id or a session", async () => {
    const { withActor, query } = actor([notice]);
    expect(await readWorkContext(TOKEN, null, withActor)).toEqual(NONE);
    expect(await readWorkContext(undefined, ID, withActor)).toEqual(NONE);
    expect(await readWorkContext("!".repeat(43), ID, withActor)).toEqual(NONE);
    expect(await readWorkContext(TOKEN, "not-a-uuid", withActor)).toEqual(NONE);
    expect(withActor).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("maps the course name and the current version for a student of the course", async () => {
    const { withActor, query } = actor([notice]);
    const read = await readWorkContext(TOKEN, ID, withActor);
    expect(read.kind).toBe("ready");
    if (read.kind !== "ready") return;
    expect(read.course).toBe("Izmišljeni kolegij");
    expect(read.wordRange).toBeNull();
    expect(read.notice).toMatchObject({ assignmentId: ID, versionNo: 1, title: notice.title });
    expect(withActor).toHaveBeenCalledExactlyOnceWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("institution.course c"), [ID]);
    for (const [sql] of query.mock.calls as unknown as [string][]) {
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
      expect(sql).toContain("v.version_no = a.current_version");
      expect(sql).toContain("n.version_no = a.current_version");
      expect(sql).toContain("n.student_id = me.user_id");
    }
  });

  it("keeps the notice mapping for allowed AI purposes, work types and evidence profiles", async () => {
    for (const ai_policy of ["prohibited", "partially_allowed"]) {
      const row = {
        ...notice, ai_policy, ai_purposes: ["translation", "explanation", "proofreading"],
        work_type: "doctoral_thesis", evidence_profile: "extended",
      };
      const expected = await readNotice(TOKEN, ID, actor([row]).withActor);
      expect(expected.kind).toBe("available");
      if (expected.kind !== "available") throw new Error("invalid invented notice");
      expect(await readWorkContext(TOKEN, ID, actor([row]).withActor)).toEqual({
        kind: "ready", course: row.course_name, notice: expected.view, wordRange: null, workLanguage: null,
      });
    }
  });

  it("keeps one statement snapshot when a new version is published during the read", async () => {
    // Model READ COMMITTED: each SQL statement captures its own snapshot.
    // Publication commits after the first snapshot, before its result reaches
    // the caller. No timer, transaction count or second-query-only trigger.
    let currentVersion = 1;
    const query = vi.fn(async (sql: string) => {
      const version = currentVersion;
      const course = `Izmišljeni kolegij v${version}`;
      const versionRow = {
        ...notice, version_no: version, title: `Izmišljeni zadatak v${version}`,
        word_min: version === 1 ? 100 : 200,
        word_max: version === 1 ? 150 : 250,
        acknowledged_at: version === 1 ? notice.acknowledged_at : null,
      };
      const readsNotice = sql.includes("institution.assignment_version");
      const readsCourse = sql.includes("institution.course c");
      const row = readsNotice
        ? { ...versionRow, ...(readsCourse ? { course_name: course } : {}) }
        : { name: course };
      // Atomic publication plus a course rename makes a mixed snapshot visible.
      currentVersion = 2;
      return { rows: [row], rowCount: 1 };
    });
    const withActor = vi.fn(async (_token: string, fn: (tx: ActorTransaction) => Promise<unknown>) =>
      fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;

    expect(await readWorkContext(TOKEN, ID, withActor)).toMatchObject({
      kind: "ready", course: "Izmišljeni kolegij v1",
      wordRange: { min: 100, max: 150 },
      notice: { versionNo: 1, title: "Izmišljeni zadatak v1" },
    });
    expect(currentVersion).toBe(2);
    expect(query).toHaveBeenCalledTimes(1);
    // A publication after the statement snapshot is seen by the next read;
    // the previous acknowledgment must not authorize the new version.
    expect(await readWorkContext(TOKEN, ID, withActor)).toEqual({ kind: "noticeFirst" });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("returns only the acknowledged current v2 limits from the same SQL statement", async () => {
    const row = { ...notice, version_no: 2, title: "Izmišljeni zadatak v2", word_min: 2000, word_max: 2500 };
    const { withActor, query } = actor([row]);
    expect(await readWorkContext(TOKEN, ID, withActor)).toMatchObject({
      kind: "ready", wordRange: { min: 2000, max: 2500 },
      notice: { versionNo: 2, title: row.title, wordMin: 2000, wordMax: 2500 },
    });
    expect(query).toHaveBeenCalledTimes(1);
    const sql = (query.mock.calls as unknown as [string][])[0]![0];
    expect(sql).toContain("v.word_min, v.word_max");
    expect(sql).toContain("v.version_no = a.current_version");
    expect(sql).toContain("n.version_no = a.current_version");
  });

  it.each([
    [null, null, null],
    [1, null, { min: 1, max: null }],
    [null, 1000000, { min: null, max: 1000000 }],
    [1000000, 1000000, { min: 1000000, max: 1000000 }],
  ])("preserves legal limits %s/%s from the current version", async (min, max, expected) => {
    const read = await readWorkContext(TOKEN, ID, actor([{ ...notice, word_min: min, word_max: max }]).withActor);
    expect(read.kind).toBe("ready");
    if (read.kind === "ready") {
      expect(read.wordRange).toEqual(expected);
      expect(read.notice).toMatchObject({ wordMin: min, wordMax: max });
    }
  });

  it("shows nothing without access, after the session ended, or when a read fails", async () => {
    const ranged = { ...notice, word_min: 2000, word_max: 2500 };
    // RLS hides the assignment: the notice read finds no role.
    expect(await readWorkContext(TOKEN, ID, actor([{ ...ranged, role: null }]).withActor)).toEqual(NONE);
    // A teacher of the course is not the student this page is for.
    expect(await readWorkContext(TOKEN, ID, actor([{ ...ranged, role: "teacher" }]).withActor)).toEqual(NONE);
    expect(await readWorkContext(TOKEN, ID, actor([{ ...ranged, role: "admin" }]).withActor)).toEqual(NONE);
    // The session closed: no current user.
    expect(await readWorkContext(TOKEN, ID, actor([{ ...ranged, user_id: null }]).withActor)).toEqual(NONE);
    // The course row is hidden by RLS.
    expect(await readWorkContext(TOKEN, ID, actor([{ ...ranged, course_name: null }]).withActor)).toEqual(NONE);
    expect(await readWorkContext(TOKEN, ID, actor([{ ...ranged, version_no: null, acknowledged_at: null }]).withActor)).toEqual(NONE);
    expect(await readWorkContext(TOKEN, ID, actor([]).withActor)).toEqual(NONE);
    // The single query or its enclosing transaction fails.
    expect(await readWorkContext(TOKEN, ID, actor().withActor)).toEqual(NONE);
    const failedTransaction = vi.fn(async () => { throw new Error("made-up transaction failure"); }) as WithActor;
    expect(await readWorkContext(TOKEN, ID, failedTransaction)).toEqual(NONE);
  });

  // PRODUCT §5 rule 6 (review 6289920934, Codex 4322145605): the notice is the
  // first screen of every assignment, also of a new version of it.
  it("sends a student who has not acknowledged the current version to the notice in one read", async () => {
    const { withActor, query } = actor([{ ...notice, word_min: 2000, word_max: 2500, acknowledged_at: null }]);
    expect(await readWorkContext(TOKEN, ID, withActor)).toEqual({ kind: "noticeFirst" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  // M2.10-P02 (DAN-386): the language of the work, read in the same statement.
  // Input classes of the column: each language of the closed set, NULL, a
  // language outside it, another case, surrounding blanks, empty, and values
  // of another type. Only the first class gives a language; nothing is trimmed,
  // folded or guessed.
  it.each([
    ["hr", "hr"],
    ["en", "en"],
    ["NULL", null],
    ["absent column", undefined],
    ["outside the set", "de"],
    ["another case", "HR"],
    ["another case", "En"],
    ["leading blank", " hr"],
    ["trailing blank", "en "],
    ["empty", ""],
    ["number", 1],
    ["object", { language: "hr" }],
    ["array", ["hr"]],
  ])("work language, %s: %j", async (_class, value) => {
    const read = await readWorkContext(TOKEN, ID, actor([{ ...notice, work_language: value }]).withActor);
    expect(read.kind).toBe("ready");
    if (read.kind !== "ready") return;
    expect(read.workLanguage).toBe(value === "hr" || value === "en" ? value : null);
  });

  it("gives no work language for any string outside the closed set", async () => {
    await fc.assert(fc.asyncProperty(
      fc.string().filter((value) => value !== "hr" && value !== "en"),
      async (value) => {
        const read = await readWorkContext(TOKEN, ID, actor([{ ...notice, work_language: value }]).withActor);
        return read.kind === "ready" && read.workLanguage === null;
      },
    ));
  });

  it("reads the work language in the one statement of the notice, never as part of the notice", async () => {
    const { withActor, query } = actor([{ ...notice, work_language: "en" }]);
    const read = await readWorkContext(TOKEN, ID, withActor);
    expect(read).toMatchObject({ kind: "ready", workLanguage: "en" });
    expect(query).toHaveBeenCalledTimes(1);
    const sql = (query.mock.calls as unknown as [string][])[0]![0];
    expect(sql).toContain("institution.work_language(a.id, me.user_id) AS work_language");
    // The acknowledged notice and its fingerprint stay as they were.
    if (read.kind === "ready") expect(read.notice).not.toHaveProperty("workLanguage");
  });

  // Istodobnost: a teacher sets another language while the page reads. The
  // statement snapshot gives one language; the change is seen on the next read.
  it("keeps the language of the statement snapshot when it changes during the read", async () => {
    let language = "hr";
    const query = vi.fn(async () => {
      const row = { ...notice, work_language: language };
      language = "en";
      return { rows: [row], rowCount: 1 };
    });
    const withActor = vi.fn(async (_token: string, fn: (tx: ActorTransaction) => Promise<unknown>) =>
      fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
    expect(await readWorkContext(TOKEN, ID, withActor)).toMatchObject({ kind: "ready", workLanguage: "hr" });
    expect(await readWorkContext(TOKEN, ID, withActor)).toMatchObject({ kind: "ready", workLanguage: "en" });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not let a work language open the workspace before the notice is acknowledged", async () => {
    const read = await readWorkContext(TOKEN, ID, actor([{ ...notice, work_language: "en", acknowledged_at: null }]).withActor);
    expect(read).toEqual({ kind: "noticeFirst" });
    expect(await readWorkContext(TOKEN, ID, actor([{ ...notice, work_language: "en", role: "teacher" }]).withActor)).toEqual(NONE);
  });
});
