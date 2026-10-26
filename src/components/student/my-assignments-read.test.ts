import { describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { readMyAssignments } from "./my-assignments-read";

// #711 contract 6404612273: the list comes only from one RLS read; any bad row
// or failure gives no list at all. All names below are invented.
const TOKEN = "A".repeat(43);
const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const A1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const A2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ME = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const row = (over: Record<string, unknown> = {}) => ({
  user_id: ME,
  course_id: C1,
  course_name: "Čitanje izmišljenih izvora",
  assignment_id: A1,
  title: "Izmišljeni esej",
  due_at: new Date("2026-11-30T22:59:00Z"),
  acknowledged: true,
  ...over,
});

function actor(rows: unknown[] | Error) {
  const query = vi.fn(async () => {
    if (rows instanceof Error) throw rows;
    return { rows, rowCount: rows.length };
  });
  const withActor = vi.fn(async (_token: string, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
  return { withActor, query };
}

describe("readMyAssignments", () => {
  it("does not contact the DB without a well-formed session token", async () => {
    const { withActor } = actor([row()]);
    expect(await readMyAssignments(undefined, withActor)).toEqual({ kind: "signedOut" });
    expect(await readMyAssignments("!".repeat(43), withActor)).toEqual({ kind: "signedOut" });
    expect(withActor).not.toHaveBeenCalled();
  });

  it("reads a session the database no longer accepts as signed out", async () => {
    const none = { user_id: null, course_id: null, course_name: null, assignment_id: null, title: null, due_at: null, acknowledged: false };
    expect(await readMyAssignments(TOKEN, actor([none]).withActor)).toEqual({ kind: "signedOut" });
  });

  it("groups and orders courses by name and assignments by due time, in one read-only query", async () => {
    const { withActor, query } = actor([
      row({ course_id: C2, course_name: "Arhivi", assignment_id: A3, title: "Treći", acknowledged: false }),
      row({ assignment_id: A2, title: "Kasniji", due_at: new Date("2026-12-15T10:00:00Z") }),
      row(),
      row({ course_id: C2, course_name: "Arhivi", assignment_id: null, title: null, due_at: null, acknowledged: null }),
    ]);
    const read = await readMyAssignments(TOKEN, withActor);
    expect(read).toEqual({
      kind: "ready",
      courses: [
        { id: C2, name: "Arhivi", assignments: [{ id: A3, title: "Treći", dueAt: "2026-11-30T22:59:00.000Z", noticeFirst: true }] },
        { id: C1, name: "Čitanje izmišljenih izvora", assignments: [
          { id: A1, title: "Izmišljeni esej", dueAt: "2026-11-30T22:59:00.000Z", noticeFirst: false },
          { id: A2, title: "Kasniji", dueAt: "2026-12-15T10:00:00.000Z", noticeFirst: false },
        ] },
      ],
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0] as unknown as [string];
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|open_student_work)\b/i);
    expect(sql).toContain("app.current_user_id() AS user_id");
    expect(sql).toContain("m.user_id = me.user_id");
    expect(sql).toContain("m.role = 'student'");
    expect(sql).toContain("m.member_to IS NULL");
    expect(sql).toContain("v.version_no = a.current_version");
    expect(sql).toContain("n.student_id = me.user_id");
  });

  it("keeps a course without assignments and gives an empty list without memberships", async () => {
    expect(await readMyAssignments(TOKEN, actor([row({ assignment_id: null })]).withActor))
      .toEqual({ kind: "ready", courses: [{ id: C1, name: "Čitanje izmišljenih izvora", assignments: [] }] });
    const alone = { user_id: ME, course_id: null, course_name: null, assignment_id: null, title: null, due_at: null, acknowledged: false };
    expect(await readMyAssignments(TOKEN, actor([alone]).withActor)).toEqual({ kind: "ready", courses: [] });
  });

  it("gives no list at all for any unexpected row or a failed read", async () => {
    const bad = [
      row({ course_id: "not-a-uuid" }),
      row({ course_name: "" }),
      row({ assignment_id: "x" }),
      row({ title: null }),
      row({ due_at: new Date(Number.NaN) }),
      row({ due_at: "2026-11-30" }),
      row({ acknowledged: null }),
    ];
    for (const r of bad) {
      expect(await readMyAssignments(TOKEN, actor([row({ assignment_id: A2 }), r]).withActor), JSON.stringify(r))
        .toEqual({ kind: "unavailable" });
    }
    expect(await readMyAssignments(TOKEN, actor([row(), row()]).withActor)).toEqual({ kind: "unavailable" });
    expect(await readMyAssignments(TOKEN, actor([row(), row({ assignment_id: A2, course_name: "Drugo ime" })]).withActor))
      .toEqual({ kind: "unavailable" });
    expect(await readMyAssignments(TOKEN, actor([]).withActor)).toEqual({ kind: "unavailable" });
    expect(await readMyAssignments(TOKEN, actor([row(), row({ assignment_id: A2, user_id: C2 })]).withActor)).toEqual({ kind: "unavailable" });
    expect(await readMyAssignments(TOKEN, actor(new Error("made-up failure")).withActor)).toEqual({ kind: "unavailable" });
  });
});
