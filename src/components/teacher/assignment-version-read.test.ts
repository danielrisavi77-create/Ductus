import { describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { readCurrentVersion } from "./assignment-version-read";

// Invented assignment only.
const TOKEN = "A".repeat(43);
const ID = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const row = {
  user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "teacher",
  mentorship: false,
  version_no: 2,
  title: "Izmišljeni seminar",
  instructions: "Upute.",
  work_type: "seminar_paper",
  evidence_profile: "basic",
  import_allowed: false,
  opens_at: new Date("2026-11-02T08:00:00Z"),
  due_at: new Date("2026-11-30T22:59:00Z"),
  ai_policy: "partially_allowed",
  ai_purposes: ["proofreading", "formatting"],
  word_min: null,
  word_max: 2500,
};

function actor(rows: unknown[] | Error) {
  const query = vi.fn(async () => {
    if (rows instanceof Error) throw rows;
    return { rows, rowCount: rows.length };
  });
  const withActor = vi.fn(async (_token: string, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
  return { withActor, query };
}

describe("DAN-310 current version read", () => {
  it("does not contact the DB without a session or with a malformed id (T031)", async () => {
    const { withActor, query } = actor([row]);
    expect(await readCurrentVersion(undefined, ID, withActor)).toEqual({ kind: "signedOut" });
    expect(await readCurrentVersion(TOKEN, "1; DROP", withActor)).toEqual({ kind: "notFound" });
    expect(query).not.toHaveBeenCalled();
  });

  it("gives a teacher the version in force, purposes in the order of the article", async () => {
    const read = await readCurrentVersion(TOKEN, ID, actor([row]).withActor);
    expect(read).toEqual({
      kind: "available",
      current: {
        assignmentId: ID.toLowerCase(), versionNo: 2, title: "Izmišljeni seminar", instructions: "Upute.",
        workType: "seminar_paper", evidenceProfile: "basic", importAllowed: false,
        opensAt: "2026-11-02T08:00:00.000Z", dueAt: "2026-11-30T22:59:00.000Z",
        aiPolicy: "partially_allowed", aiPurposes: ["formatting", "proofreading"], wordMin: null, wordMax: 2500,
      },
    });
  });

  it("reads a student's, a mentorship's, someone else's and a missing assignment alike (T031)", async () => {
    for (const other of [{ role: "student" }, { mentorship: true }, { role: null, mentorship: null, version_no: null }]) {
      expect(await readCurrentVersion(TOKEN, ID, actor([{ ...row, ...other }]).withActor)).toEqual({ kind: "notFound" });
    }
    expect(await readCurrentVersion(TOKEN, ID, actor([{ ...row, user_id: null }]).withActor)).toEqual({ kind: "signedOut" });
  });

  it("is unavailable on a failed read or a purpose outside the closed list", async () => {
    expect(await readCurrentVersion(TOKEN, ID, actor(new Error("down")).withActor)).toEqual({ kind: "unavailable" });
    expect(await readCurrentVersion(TOKEN, ID, actor([{ ...row, ai_purposes: ["other"] }]).withActor))
      .toEqual({ kind: "unavailable" });
  });
});
