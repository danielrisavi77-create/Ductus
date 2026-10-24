import { describe, expect, it, vi } from "vitest";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { AI_PURPOSES, assignmentBody, createAssignment, type AssignmentDraft } from "./assignment-create";

const COURSE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const draft: AssignmentDraft = {
  title: " Izborni sustavi u Europi ",
  instructions: "Usporedi dva izmišljena izborna sustava.",
  workType: "seminar_paper",
  opensAt: "2026-11-02T09:00",
  dueAt: "2026-11-30T23:59",
  aiPurposes: ["translation", "literature_search"],
  wordMin: "",
  wordMax: "",
};

describe("F-6 assignment body", () => {
  it("sends the complete contract including empty optional limits", () => {
    const body = assignmentBody(draft, "encouraged")!;
    expect(Object.keys(body).sort()).toEqual([
      "aiPolicy", "aiPurposes", "dueAt", "evidenceProfile", "importAllowed", "instructions", "opensAt", "title", "wordMax", "wordMin", "workType",
    ]);
    expect(body).toMatchObject({
      title: "Izborni sustavi u Europi",
      workType: "seminar_paper",
      aiPolicy: "partially_allowed",
      aiPurposes: ["literature_search", "translation"],
      evidenceProfile: "basic",
      importAllowed: false,
      wordMin: null,
      wordMax: null,
    });
    expect(body.opensAt).toBe(new Date("2026-11-02T09:00").toISOString());
  });

  it("prohibits use when nothing is checked or the course prohibits it (D-52)", () => {
    expect(assignmentBody({ ...draft, aiPurposes: [] }, "encouraged")).toMatchObject({ aiPolicy: "prohibited", aiPurposes: [] });
    expect(assignmentBody(draft, "prohibited")).toMatchObject({ aiPolicy: "prohibited", aiPurposes: [] });
  });

  it("drops purposes outside the closed čl. 8 list", () => {
    const forged = { ...draft, aiPurposes: ["explanation", "proofreading"] } as unknown as AssignmentDraft;
    expect(assignmentBody(forged, "partially_allowed")?.aiPurposes).toEqual(["proofreading"]);
  });

  it.each([
    ["1", "", 1, null],
    ["", "1000000", null, 1_000_000],
    ["2000", "2000", 2000, 2000],
    ["2000", "2500", 2000, 2500],
  ])("accepts valid limits %s / %s", (min, max, expectedMin, expectedMax) => {
    expect(assignmentBody({ ...draft, wordMin: min, wordMax: max }, "encouraged"))
      .toMatchObject({ wordMin: expectedMin, wordMax: expectedMax });
  });

  it.each(["0", "-1", "1.5", "12xyz", "NaN", "Infinity", "1e3", "1000001"])(
    "rejects malformed or out-of-range limit %s", (value) => {
      expect(assignmentBody({ ...draft, wordMin: value }, "encouraged")).toBeNull();
      expect(assignmentBody({ ...draft, wordMax: value }, "encouraged")).toBeNull();
    },
  );

  it("rejects reversed limits", () => {
    expect(assignmentBody({ ...draft, wordMin: "2501", wordMax: "2500" }, "encouraged")).toBeNull();
  });

  it.each([
    [{ title: "   " }],
    [{ title: "A".repeat(201) }],
    [{ opensAt: "" }],
    [{ dueAt: "2026-11-02T09:00" }],
    [{ dueAt: "2026-11-01T09:00" }],
    [{ opensAt: "2026-11-02T09:00:30" }],
    [{ workType: "doctoral_thesis" }],
  ])("refuses a draft the server would refuse: %o", (change) => {
    expect(assignmentBody({ ...draft, ...change } as AssignmentDraft, "encouraged")).toBeNull();
  });
});

describe("F-6 assignment transport contract", () => {
  const body = assignmentBody(draft, "encouraged")!;

  it("posts the body with the retry key to the course's assignment route", async () => {
    const send = vi.fn(async () => Response.json({ id: ID }, { status: 201 })) as unknown as typeof fetch;
    expect(await createAssignment(COURSE, body, KEY, send)).toEqual({ kind: "available", id: ID });
    const [path, options] = (send as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(path).toBe(`/api/institution/courses/${COURSE}/assignments`);
    expect(options).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: { "content-type": "application/json", "idempotency-key": KEY },
    });
    expect(JSON.parse(options.body as string)).toEqual(body);
  });

  it("calls nothing with a malformed course id or retry key", async () => {
    const send = vi.fn();
    expect(await createAssignment("x", body, KEY, send as unknown as typeof fetch)).toEqual({ kind: "invalid" });
    expect(await createAssignment(COURSE, body, "x", send as unknown as typeof fetch)).toEqual({ kind: "invalid" });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [409, "conflict"],
    [400, "invalid"],
    [422, "invalid"],
    [200, "unavailable"],
    [503, "unavailable"],
  ] as const)("keeps HTTP %i as the local %s state", async (status, kind) => {
    const send = vi.fn(async () => Response.json({ id: ID, error: "raw diagnostics" }, { status }));
    expect(await createAssignment(COURSE, body, KEY, send as unknown as typeof fetch)).toEqual({ kind });
  });

  it("never claims publication on a malformed reply or a transport failure", async () => {
    const bad = vi.fn(async () => Response.json({ id: "nope" }, { status: 201 }));
    expect(await createAssignment(COURSE, body, KEY, bad as unknown as typeof fetch)).toEqual({ kind: "unavailable" });
    const offline = vi.fn(async () => { throw new Error("offline"); });
    expect(await createAssignment(COURSE, body, KEY, offline as unknown as typeof fetch)).toEqual({ kind: "unavailable" });
  });
});

describe("čl. 8 catalogue", () => {
  it("labels exactly the database purposes, in the order of the article, and names its source", () => {
    expect(Object.keys(t.teacher.tools.purposes).sort()).toEqual([...AI_PURPOSES].sort());
    expect(AI_PURPOSES).toEqual(["formatting", "proofreading", "literature_search", "transcription", "translation"]);
    expect(t.teacher.tools.source).toContain("21. 5. 2026., članak 8.");
    expect(Object.keys(t.teacher.tools.alwaysBanned)).toHaveLength(10);
  });
});
