import { describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { assignmentParam, readWorkContext } from "./work-context-read";

// #476 contract 6280487079: the top bar of /rad names the course and the
// assignment only from an RLS read; every other outcome shows nothing. All
// names below are invented.
const TOKEN = "A".repeat(43);
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const notice = {
  user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "student",
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
    const { withActor, query } = actor([notice], [{ name: "Kolegij" }]);
    expect(await readWorkContext(TOKEN, null, withActor)).toEqual(NONE);
    expect(await readWorkContext(undefined, ID, withActor)).toEqual(NONE);
    expect(await readWorkContext("!".repeat(43), ID, withActor)).toEqual(NONE);
    expect(query).not.toHaveBeenCalled();
  });

  it("maps the course name and the current version for a student of the course", async () => {
    const { withActor, query } = actor([notice], [{ name: "Izmišljeni kolegij" }]);
    const read = await readWorkContext(TOKEN, ID, withActor);
    expect(read.kind).toBe("ready");
    if (read.kind !== "ready") return;
    expect(read.course).toBe("Izmišljeni kolegij");
    expect(read.notice).toMatchObject({ assignmentId: ID, versionNo: 1, title: notice.title });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("institution.course c"), [ID]);
    for (const [sql] of query.mock.calls as unknown as [string][]) {
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    }
  });

  it("shows nothing without access, after the session ended, or when a read fails", async () => {
    // RLS hides the assignment: the notice read finds no role.
    expect(await readWorkContext(TOKEN, ID, actor([{ ...notice, role: null }]).withActor)).toEqual(NONE);
    // A teacher of the course is not the student this page is for.
    expect(await readWorkContext(TOKEN, ID, actor([{ ...notice, role: "teacher" }]).withActor)).toEqual(NONE);
    // The session closed: no current user.
    expect(await readWorkContext(TOKEN, ID, actor([{ ...notice, user_id: null }]).withActor)).toEqual(NONE);
    // The course row is hidden by RLS.
    expect(await readWorkContext(TOKEN, ID, actor([notice], []).withActor)).toEqual(NONE);
    // Either query fails.
    expect(await readWorkContext(TOKEN, ID, actor().withActor)).toEqual(NONE);
    expect(await readWorkContext(TOKEN, ID, actor([notice]).withActor)).toEqual(NONE);
  });

  // PRODUCT §5 rule 6 (review 6289920934, Codex 4322145605): the notice is the
  // first screen of every assignment, also of a new version of it.
  it("sends a student who has not acknowledged the current version to the notice, reading nothing more", async () => {
    const { withActor, query } = actor([{ ...notice, acknowledged_at: null }], [{ name: "Izmišljeni kolegij" }]);
    expect(await readWorkContext(TOKEN, ID, withActor)).toEqual({ kind: "noticeFirst" });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
