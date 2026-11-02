import { describe, expect, it, vi } from "vitest";

import {
  checkVersion,
  draftOf,
  localMinute,
  publishVersion,
  widensWords,
  type CurrentVersion,
  type VersionBody,
} from "./assignment-version";

// Invented assignment only.
const ID = "00000000-0000-4000-8000-0000000000a1";
const CURRENT: CurrentVersion = {
  assignmentId: ID,
  versionNo: 3,
  title: "Izmišljeni esej",
  instructions: "Upute za izmišljeni zadatak.",
  workType: "short_paper",
  evidenceProfile: "extended",
  importAllowed: true,
  opensAt: "2026-11-01T08:00:30.000Z",
  dueAt: "2026-11-30T22:59:00.000Z",
  aiPolicy: "encouraged",
  aiPurposes: ["formatting", "proofreading"],
  wordMin: 1000,
  wordMax: 2000,
};

describe("DAN-310 new version: what is sent", () => {
  it("publishes nothing when nothing changed, and keeps the stored instants to the second (T032)", () => {
    expect(checkVersion(CURRENT, draftOf(CURRENT))).toEqual({ kind: "unchanged" });
    expect(checkVersion(CURRENT, { ...draftOf(CURRENT), title: "  Izmišljeni esej  " })).toEqual({ kind: "unchanged" });
  });

  it("carries what the form has no field for, and names each change (T025, T026)", () => {
    const draft = { ...draftOf(CURRENT), title: "Novi naslov", dueAt: "2026-12-05T12:00", wordMin: "800", wordMax: "" };
    const check = checkVersion(CURRENT, draft);
    expect(check.kind).toBe("ready");
    if (check.kind !== "ready") return;
    expect(check.body).toEqual<VersionBody>({
      expectedVersion: 3,
      title: "Novi naslov",
      instructions: CURRENT.instructions,
      workType: "short_paper",
      opensAt: CURRENT.opensAt,
      dueAt: new Date("2026-12-05T12:00").toISOString(),
      aiPolicy: "encouraged",
      aiPurposes: ["formatting", "proofreading"],
      evidenceProfile: "extended",
      importAllowed: true,
      wordMin: 800,
      wordMax: null,
    });
    expect(check.changes).toEqual(["title", "dueAt", "wordRange"]);
  });

  it("never sends a purpose the version in force does not allow; none left prohibits use (T028)", () => {
    const added = checkVersion(CURRENT, { ...draftOf(CURRENT), aiPurposes: ["formatting", "translation"] });
    expect(added.kind === "ready" && added.body.aiPurposes).toEqual(["formatting"]);
    const none = checkVersion(CURRENT, { ...draftOf(CURRENT), aiPurposes: [] });
    expect(none.kind === "ready" && [none.body.aiPolicy, none.body.aiPurposes, none.changes]).toEqual(
      ["prohibited", [], ["aiPurposes"]]);
  });

  it("refuses a tighter word range before any request (T028)", () => {
    for (const [wordMin, wordMax] of [["1200", "2000"], ["1000", "1500"]] as const) {
      expect(checkVersion(CURRENT, { ...draftOf(CURRENT), wordMin, wordMax })).toEqual({ kind: "widening" });
    }
    const open = { ...CURRENT, wordMin: null, wordMax: null };
    expect(checkVersion(open, { ...draftOf(open), wordMin: "10" })).toEqual({ kind: "widening" });
    expect(widensWords(CURRENT, null, null)).toBe(false);
    expect(widensWords(CURRENT, 500, 3000)).toBe(false);
  });

  it("refuses an empty title, a deadline before opening and a broken range", () => {
    const draft = draftOf(CURRENT);
    for (const bad of [{ title: " " }, { dueAt: "2026-10-01T10:00" }, { opensAt: "x" }, { wordMin: "5", wordMax: "4" }]) {
      expect(checkVersion(CURRENT, { ...draft, ...bad })).toEqual({ kind: "invalid" });
    }
  });

  it("writes instants as datetime-local text on this clock", () => {
    expect(localMinute("bad")).toBe("");
    expect(new Date(localMinute(CURRENT.dueAt)).toISOString()).toBe(CURRENT.dueAt);
  });
});

describe("DAN-310 new version: the reply", () => {
  const body = (checkVersion(CURRENT, { ...draftOf(CURRENT), title: "Drugi" }) as { body: VersionBody }).body;
  const reply = (status: number, data: unknown = {}) =>
    vi.fn(async () => new Response(JSON.stringify(data), { status })) as unknown as typeof fetch;

  it("posts to the version route with the expected version", async () => {
    const send = reply(201, { assignmentId: ID, versionNo: 4 });
    expect(await publishVersion(ID, body, send)).toEqual({ kind: "published", versionNo: 4 });
    const [url, init] = (send as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe(`/api/institution/assignments/${ID}/versions`);
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error" });
    expect(JSON.parse(init.body as string)).toMatchObject({ expectedVersion: 3, title: "Drugi" });
  });

  it("reads 409 as a newer version, and never trusts another success shape (T029)", async () => {
    expect(await publishVersion(ID, body, reply(409, { error: "version_conflict" }))).toEqual({ kind: "conflict" });
    expect(await publishVersion(ID, body, reply(201, { versionNo: 9 }))).toEqual({ kind: "unavailable" });
    expect(await publishVersion(ID, body, reply(401))).toEqual({ kind: "unauthorized" });
    expect(await publishVersion(ID, body, reply(403))).toEqual({ kind: "forbidden" });
    expect(await publishVersion(ID, body, reply(422))).toEqual({ kind: "invalid" });
    expect(await publishVersion(ID, body, reply(503))).toEqual({ kind: "unavailable" });
    const down = vi.fn(async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    expect(await publishVersion(ID, body, down)).toEqual({ kind: "unavailable" });
    expect(await publishVersion("../x", body, down)).toEqual({ kind: "invalid" });
    expect(down).toHaveBeenCalledTimes(1);
  });
});
