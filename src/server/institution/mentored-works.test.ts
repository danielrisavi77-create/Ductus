import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import {
  handleMentoredWorkRequest,
  handleMentoredWorksRequest,
  mentoredWorkOf,
  mentoredWorksOf,
  readMentoredWork,
  readMentoredWorks,
} from "./mentored-works";

// Invented ids and names only (DAN-477, contract on #1091, c.6566072183).
const TOKEN = "T".repeat(43);
const CANARY = "kanarinac-mentorstvo-7a2e";
const MS1 = "00000000-0000-4000-8000-0000000000d1";
const MS2 = "00000000-0000-4000-8000-0000000000d2";
const ZM1 = "00000000-0000-4000-8000-0000000000b1";
const ACTOR = { user_id: "00000000-0000-4000-8000-000000000101", institution_id: "00000000-0000-4000-8000-0000000000a1" };

type Row = Record<string, unknown>;
const row = (over: Row = {}): Row => ({
  mentorship_id: MS1, assignment_id: ZM1, title: "Izmišljeni rad", work_type: "master_thesis",
  document_id: "doc-1", given_name: "Iskra", family_name: "Izmišljenić", submitted: false, ...over,
});

function database(answer: { rows?: Row[]; code?: string; actor?: Row | null }) {
  const calls: { text: string; values: unknown[] | undefined; token: string | null | undefined }[] = [];
  const withActor = vi.fn(async (token: string | null | undefined, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values, token });
        if (answer.code) throw Object.assign(new Error(`do not leak ${CANARY}`), { code: answer.code });
        if (text.includes("app.current_actor()") && !text.includes("mentorship")) {
          const actor = answer.actor === undefined ? ACTOR : answer.actor;
          return { rows: actor === null ? [] : [actor], rowCount: actor === null ? 0 : 1 };
        }
        return { rows: answer.rows ?? [], rowCount: answer.rows?.length ?? 0 };
      },
    } as unknown as ActorTransaction),
  ) as unknown as WithActor;
  return { withActor, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("DAN-477 mentored works: the parser", () => {
  it("names the state from the work and the submission", () => {
    expect(mentoredWorkOf(row({ document_id: null }))?.workState).toBe("not_started");
    expect(mentoredWorkOf(row())?.workState).toBe("in_progress");
    expect(mentoredWorkOf(row({ submitted: true }))?.workState).toBe("submitted");
    expect(mentoredWorkOf(row({ given_name: null, family_name: null }))?.student).toBeNull();
    expect(mentoredWorkOf(row())).toEqual({
      mentorshipId: MS1, assignmentId: ZM1, documentId: "doc-1", student: { givenName: "Iskra", familyName: "Izmišljenić" },
      title: "Izmišljeni rad", workType: "master_thesis", workState: "in_progress",
    });
  });

  it.each([
    ["a mentorship id that is no uuid", { mentorship_id: "abc" }],
    ["an upper-case assignment id", { assignment_id: ZM1.toUpperCase() }],
    ["an empty title", { title: "" }],
    ["a course work type", { work_type: "essay" }],
    ["half a name", { family_name: null }],
    ["an over-long name", { given_name: "a".repeat(256) }],
    ["a document id with a control character", { document_id: "doc\n1" }],
    ["no submission row", { submitted: null }],
    ["a submission without a work", { document_id: null, submitted: true }],
  ])("refuses %s", (_, over) => {
    expect(mentoredWorkOf(row(over))).toBeNull();
  });

  it("refuses a list that repeats a mentorship rather than guessing which work is it", () => {
    expect(mentoredWorksOf([row(), row({ document_id: "doc-2" })])).toBeNull();
    expect(mentoredWorksOf([row(), row({ mentorship_id: MS2 })])).toHaveLength(2);
  });
});

describe("DAN-477 mentored works: the reads", () => {
  it("asks for the actor, then once for all mentorships with the session only", async () => {
    const db = database({ rows: [row()] });
    expect(await readMentoredWorks(TOKEN, db.withActor)).toEqual({ kind: "ok", works: [mentoredWorkOf(row())] });
    expect(db.withActor).toHaveBeenCalledTimes(1);
    expect(db.calls).toHaveLength(2);
    expect(db.calls[1]).toMatchObject({ values: [null], token: TOKEN });
    expect(db.calls[1]!.text).toContain("institution.actor_mentorship_role(m.id) = 'teacher'");
  });

  it("a session the database does not know is unauthorized, even with no mentorship to raise on", async () => {
    expect(await readMentoredWorks(TOKEN, database({ actor: null }).withActor)).toEqual({ kind: "unauthorized" });
    expect(await readMentoredWorks(TOKEN, database({ actor: { user_id: null, institution_id: null } }).withActor))
      .toEqual({ kind: "unauthorized" });
    expect(await readMentoredWork(TOKEN, database({ actor: null }).withActor, MS1)).toEqual({ kind: "unauthorized" });
  });

  it.each([undefined, "", "kratko", `${TOKEN}x`])("a malformed session (%s) is unauthorized without asking", async (token) => {
    const db = database({ rows: [row()] });
    expect(await readMentoredWorks(token, db.withActor)).toEqual({ kind: "unauthorized" });
    expect(await readMentoredWork(token, db.withActor, MS1)).toEqual({ kind: "unauthorized" });
    expect(db.calls).toEqual([]);
  });

  it.each(["", "abc", MS1.toUpperCase(), `${MS1}x`, `' OR true --`])("a malformed id (%s) is not_found without asking", async (id) => {
    const db = database({ rows: [row()] });
    expect(await readMentoredWork(TOKEN, db.withActor, id)).toEqual({ kind: "not_found" });
    expect(db.calls).toEqual([]);
  });

  it("the detail is the one row for that id, nothing is not_found, and anything else is unavailable", async () => {
    const one = database({ rows: [row()] });
    expect(await readMentoredWork(TOKEN, one.withActor, MS1)).toEqual({ kind: "ok", work: mentoredWorkOf(row()) });
    expect(one.calls[1]).toMatchObject({ values: [MS1] });
    expect(await readMentoredWork(TOKEN, database({ rows: [] }).withActor, MS1)).toEqual({ kind: "not_found" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readMentoredWork(TOKEN, database({ rows: [row({ mentorship_id: MS2 })] }).withActor, MS1))
      .toEqual({ kind: "unavailable" });
    expect(await readMentoredWork(TOKEN, database({ rows: [row(), row({ mentorship_id: MS2 })] }).withActor, MS1))
      .toEqual({ kind: "unavailable" });
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining(CANARY), expect.anything());
  });

  it("a malformed row answers for the whole list, and a failure leaks nothing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readMentoredWorks(TOKEN, database({ rows: [row(), row({ mentorship_id: MS2, title: "" })] }).withActor))
      .toEqual({ kind: "unavailable" });
    expect(await readMentoredWorks(TOKEN, database({ code: "ZD401" }).withActor)).toEqual({ kind: "unauthorized" });
    expect(await readMentoredWorks(TOKEN, database({ code: "57014" }).withActor)).toEqual({ kind: "unavailable" });
    expect(await readMentoredWorks(TOKEN, database({ code: "nije kod" }).withActor)).toEqual({ kind: "unavailable" });
    expect(error.mock.calls).toEqual([
      ["mentored works read failed", "row_malformed"],
      ["mentored works read failed", "57014"],
      ["mentored works read failed", "unknown"],
    ]);
  });
});

describe("DAN-477 mentored works: the routes", () => {
  const get = (path: string, headers: Record<string, string> = {}, method = "GET") =>
    new Request(`https://mentored.example${path}`, { method, headers });

  it("answers the list and the detail with no-store", async () => {
    const db = database({ rows: [row()] });
    const listed = await handleMentoredWorksRequest(get("/api/teacher/mentorships"), { withActor: db.withActor, sessionToken: TOKEN });
    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toBe("no-store");
    expect(await listed.json()).toEqual({ works: [mentoredWorkOf(row())] });
    const one = await handleMentoredWorkRequest(get(`/api/teacher/mentorships/${MS1}`), { withActor: db.withActor, sessionToken: TOKEN }, MS1);
    expect(await one.json()).toEqual({ work: mentoredWorkOf(row()) });
  });

  it("gives a malformed id and an id with no row the same 404", async () => {
    const deps = { withActor: database({ rows: [] }).withActor, sessionToken: TOKEN };
    const a = await handleMentoredWorkRequest(get("/api/teacher/mentorships/abc"), deps, "abc");
    const b = await handleMentoredWorkRequest(get(`/api/teacher/mentorships/${MS2}`), deps, MS2);
    for (const response of [a, b]) {
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(await a.text()).toBe(await b.text());
  });

  it("refuses another method, a cross-site read and a missing session before asking", async () => {
    const db = database({ rows: [row()] });
    const deps = { withActor: db.withActor, sessionToken: TOKEN };
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      expect((await handleMentoredWorksRequest(get("/x", {}, method), deps)).status).toBe(405);
      expect((await handleMentoredWorkRequest(get("/x", {}, method), deps, MS1)).status).toBe(405);
    }
    for (const site of ["cross-site", "same-site", "none"]) {
      expect((await handleMentoredWorksRequest(get("/x", { "sec-fetch-site": site }), deps)).status).toBe(403);
      expect((await handleMentoredWorkRequest(get("/x", { "sec-fetch-site": site }), deps, MS1)).status).toBe(403);
    }
    expect((await handleMentoredWorksRequest(get("/x"), { withActor: db.withActor })).status).toBe(401);
    expect(db.calls).toEqual([]);
    expect((await handleMentoredWorksRequest(get("/x", { "sec-fetch-site": "same-origin" }), deps)).status).toBe(200);
  });
});
