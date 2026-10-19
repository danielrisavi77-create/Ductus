import { describe, expect, it, vi } from "vitest";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { courseHref, pickOpenAssignment, readOpenAssignment } from "./open-assignment";

const TOKEN = "A".repeat(43);
const COURSE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ME = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const NOW = new Date("2026-11-02T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

function actor(rows: unknown[] | Error) {
  const query = vi.fn(async () => {
    if (rows instanceof Error) throw rows;
    return { rows, rowCount: rows.length };
  });
  const withActor = vi.fn(async (_token: string, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
  return { withActor, query };
}

const row = (id: string | null, opens: Date | null, due: Date | null, role: string | null = "student") =>
  ({ user_id: ME, role, now: NOW, id, opens_at: opens, due_at: due });

describe("FE-D4 open assignment after enrollment", () => {
  it("picks the nearest due date among assignments not yet past it", () => {
    expect(pickOpenAssignment([
      { id: A1, opensAt: day(-10), dueAt: day(-1) },
      { id: A2, opensAt: day(-2), dueAt: day(20) },
      { id: "x", opensAt: day(3), dueAt: day(9) },
    ], NOW)).toBe("x");
  });

  it("sends nowhere when every assignment is past its due date or there is none", () => {
    expect(pickOpenAssignment([], NOW)).toBeNull();
    expect(pickOpenAssignment([{ id: A1, opensAt: day(-5), dueAt: NOW }], NOW)).toBeNull();
  });

  it("does not depend on row order when due dates tie", () => {
    const a = { id: A2, opensAt: day(-1), dueAt: day(5) };
    const b = { id: A1, opensAt: day(-1), dueAt: day(5) };
    const c = { id: "z", opensAt: day(-3), dueAt: day(5) };
    expect(pickOpenAssignment([a, b, c], NOW)).toBe("z");
    expect(pickOpenAssignment([a, b], NOW)).toBe(A1);
    expect(pickOpenAssignment([b, a], NOW)).toBe(A1);
  });

  it("keeps the course id inside one path segment", () => {
    expect(courseHref(COURSE)).toBe(`/upis/kolegij/${COURSE}`);
    expect(courseHref("../api/x?y")).toBe("/upis/kolegij/..%2Fapi%2Fx%3Fy");
  });

  it("does not contact the DB without a valid session or a well-formed course id", async () => {
    const { withActor, query } = actor([row(A1, day(-1), day(5))]);
    for (const token of [undefined, "", "!".repeat(43)]) {
      expect(await readOpenAssignment(token, COURSE, withActor)).toEqual({ kind: "signedOut" });
    }
    expect(await readOpenAssignment(TOKEN, "1; DROP", withActor)).toEqual({ kind: "notFound" });
    expect(query).not.toHaveBeenCalled();
  });

  it("sends a student of the course to the open assignment, by the course id as a parameter", async () => {
    const { withActor, query } = actor([row(A1, day(-1), day(-0.5)), row(A2, day(-1), day(5))]);
    expect(await readOpenAssignment(TOKEN, COURSE, withActor)).toEqual({ kind: "assignment", assignmentId: A2 });
    expect(query).toHaveBeenCalledWith(expect.any(String), [COURSE]);
  });

  it("tells a course without an open assignment apart from one the account cannot see", async () => {
    expect(await readOpenAssignment(TOKEN, COURSE, actor([row(null, null, null)]).withActor)).toEqual({ kind: "none" });
    for (const role of [null, "teacher"]) {
      expect(await readOpenAssignment(TOKEN, COURSE, actor([row(A1, day(-1), day(5), role)]).withActor))
        .toEqual({ kind: "notFound" });
    }
  });

  it("treats a closed session and a DB failure as such, never as an assignment", async () => {
    expect(await readOpenAssignment(TOKEN, COURSE, actor([{ ...row(A1, day(-1), day(5)), user_id: null }]).withActor))
      .toEqual({ kind: "signedOut" });
    expect(await readOpenAssignment(TOKEN, COURSE, actor([]).withActor)).toEqual({ kind: "signedOut" });
    expect(await readOpenAssignment(TOKEN, COURSE, actor(new Error("down")).withActor)).toEqual({ kind: "unavailable" });
  });

  it("has a message for every state of the page and no forbidden term in the enrollment text", () => {
    expect(Object.keys(t.student.enroll.course).sort()).toEqual(["another", "none", "notFound", "retry", "unavailable"]);
    const texts = [t.student.enroll.heading, t.student.enroll.opening, t.student.enroll.submit,
      ...Object.values(t.student.enroll.errors), ...Object.values(t.student.enroll.course)];
    for (const text of texts) expect({ text, found: findForbiddenTerms(text) }).toEqual({ text, found: [] });
  });
});
