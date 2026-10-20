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
        kind: "ready", course: row.course_name, notice: expected.view,
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
      notice: { versionNo: 1, title: "Izmišljeni zadatak v1" },
    });
    expect(currentVersion).toBe(2);
    expect(query).toHaveBeenCalledTimes(1);
    // A publication after the statement snapshot is seen by the next read;
    // the previous acknowledgment must not authorize the new version.
    expect(await readWorkContext(TOKEN, ID, withActor)).toEqual({ kind: "noticeFirst" });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("shows nothing without access, after the session ended, or when a read fails", async () => {
    // RLS hides the assignment: the notice read finds no role.
    expect(await readWorkContext(TOKEN, ID, actor([{ ...notice, role: null }]).withActor)).toEqual(NONE);
    // A teacher of the course is not the student this page is for.
    expect(await readWorkContext(TOKEN, ID, actor([{ ...notice, role: "teacher" }]).withActor)).toEqual(NONE);
    expect(await readWorkContext(TOKEN, ID, actor([{ ...notice, role: "admin" }]).withActor)).toEqual(NONE);
    // The session closed: no current user.
    expect(await readWorkContext(TOKEN, ID, actor([{ ...notice, user_id: null }]).withActor)).toEqual(NONE);
    // The course row is hidden by RLS.
    expect(await readWorkContext(TOKEN, ID, actor([{ ...notice, course_name: null }]).withActor)).toEqual(NONE);
    expect(await readWorkContext(TOKEN, ID, actor([{ ...notice, version_no: null, acknowledged_at: null }]).withActor)).toEqual(NONE);
    expect(await readWorkContext(TOKEN, ID, actor([]).withActor)).toEqual(NONE);
    // The single query or its enclosing transaction fails.
    expect(await readWorkContext(TOKEN, ID, actor().withActor)).toEqual(NONE);
    const failedTransaction = vi.fn(async () => { throw new Error("made-up transaction failure"); }) as WithActor;
    expect(await readWorkContext(TOKEN, ID, failedTransaction)).toEqual(NONE);
  });

  // PRODUCT §5 rule 6 (review 6289920934, Codex 4322145605): the notice is the
  // first screen of every assignment, also of a new version of it.
  it("sends a student who has not acknowledged the current version to the notice in one read", async () => {
    const { withActor, query } = actor([{ ...notice, acknowledged_at: null }]);
    expect(await readWorkContext(TOKEN, ID, withActor)).toEqual({ kind: "noticeFirst" });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
