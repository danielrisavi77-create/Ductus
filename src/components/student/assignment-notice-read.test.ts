import { describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { readNotice } from "./assignment-notice-read";

const TOKEN = "A".repeat(43);
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const row = {
  role: "student",
  version_no: 2,
  title: "Izborni sustavi u Europi",
  instructions: "Usporedi dva izmišljena izborna sustava.",
  work_type: "seminar_paper",
  opens_at: new Date("2026-11-02T08:00:00Z"),
  due_at: new Date("2026-11-30T22:59:00Z"),
  ai_policy: "partially_allowed",
  ai_purposes: ["translation", "explanation", "proofreading"],
  acknowledged_at: null,
};

function actor(rows: unknown[]) {
  const query = vi.fn(async () => ({ rows, rowCount: rows.length }));
  const withActor = vi.fn(async (_token: string, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
  return { withActor, query };
}

describe("F-7 notice read", () => {
  it("does not contact the DB without a valid session or a well-formed id", async () => {
    const { withActor, query } = actor([row]);
    for (const token of [undefined, "", "!".repeat(43)]) {
      expect(await readNotice(token, ID, withActor)).toEqual({ kind: "signedOut" });
    }
    expect(await readNotice(TOKEN, "1; DROP", withActor)).toEqual({ kind: "notFound" });
    expect(query).not.toHaveBeenCalled();
  });

  it("maps the current version for a student of the course, in čl. 8 order", async () => {
    const { withActor, query } = actor([row]);
    expect(await readNotice(TOKEN, ID, withActor)).toEqual({
      kind: "available",
      view: {
        assignmentId: ID,
        versionNo: 2,
        title: row.title,
        instructions: row.instructions,
        workType: "seminar_paper",
        opensAt: "2026-11-02T08:00:00.000Z",
        dueAt: "2026-11-30T22:59:00.000Z",
        aiPurposes: ["proofreading", "translation"],
        acknowledgedAt: null,
      },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("a.current_version"), [ID]);
    expect((query.mock.calls[0] as unknown as [string])[0]).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it("shows no allowed purposes when use is prohibited, and keeps a prior acknowledgment", async () => {
    const at = new Date("2026-11-03T10:00:00Z");
    const { withActor } = actor([{ ...row, ai_policy: "prohibited", acknowledged_at: at }]);
    const read = await readNotice(TOKEN, ID, withActor);
    expect(read.kind === "available" && read.view).toMatchObject({ aiPurposes: [], acknowledgedAt: at.toISOString() });
  });

  it("shows no notice to a teacher, an outsider or for a missing assignment", async () => {
    for (const rows of [[{ ...row, role: "teacher" }], [{ ...row, role: null }], []]) {
      expect(await readNotice(TOKEN, ID, actor(rows).withActor)).toEqual({ kind: "notFound" });
    }
  });

  it("hides a database failure behind a neutral state", async () => {
    const outage = vi.fn(async () => { throw new Error("raw SQL must not leak"); }) as unknown as WithActor;
    expect(await readNotice(TOKEN, ID, outage)).toEqual({ kind: "unavailable" });
  });
});
