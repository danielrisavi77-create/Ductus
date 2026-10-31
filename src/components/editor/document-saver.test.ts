// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { FetchLike } from "@/client/evidence-ingest";
import type { CanonicalDocument } from "@/domain/document";
import { tiptapToCanonical } from "@/editor/interop";
import { LocalDocumentSaver } from "@/lib/journal/local-document-saver";
import { DOC, journalKit, json } from "@/lib/sync/evidence-test-kit";

import { createDocumentSaver, evidenceNotice, snapshotSpeaks, writingClosed } from "./document-saver";
import { EvidenceSession } from "./evidence-session";

/**
 * F-8 3d-2c2 unit test 8 (contract #476 c.6391714810 §6, W6): the sheet
 * without an assignment never reaches `/api/evidence/*`. Journals on
 * fake-indexeddb; every id and text is invented.
 */

const { open: openJournal, cleanup } = journalKit("d");
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

const TEXT: CanonicalDocument = (() => {
  const canonical = tiptapToCanonical({
    type: "doc",
    content: [{ type: "paragraph", attrs: { nodeId: "bbbbbbbb-0000-4000-8000-00000000000b" }, content: [{ type: "text", text: "Izmišljeni uvod" }] }],
  });
  if (!canonical.ok) throw new Error("test document is not canonical");
  return canonical.doc;
})();

const online = { navigator: { onLine: true }, addEventListener: () => {}, removeEventListener: () => {} };

describe("3d-2c2 unit 8: which saver writes the sheet", () => {
  it("without an assignment the local saver writes and nothing goes to /api/evidence/*", async () => {
    const global = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", global);
    const given = vi.fn<FetchLike>();
    const { saver, evidence } = createDocumentSaver({
      journal: openJournal(), documentId: DOC, current: () => true, assignmentId: null, fetchImpl: given, source: online,
    });
    expect(evidence).toBeNull();
    expect(saver).toBeInstanceOf(LocalDocumentSaver);
    await saver.load();
    saver.edit();
    await saver.propose(TEXT);
    await saver.settled();
    expect(saver.snapshot().state).toBe("LOCAL_DURABLE");
    expect(given).not.toHaveBeenCalled();
    expect(global).not.toHaveBeenCalled();
  });

  it("F-154: with an assignment, no evidence request leaves once current() is false", async () => {
    const given = vi.fn<FetchLike>(async () => json(404, { status: "not_found" }));
    const { saver } = createDocumentSaver({
      journal: openJournal(), documentId: DOC, current: () => false, assignmentId: "a-izmisljeni", fetchImpl: given, source: online,
    });
    expect((await saver.load()).kind).toBe("unavailable");
    expect(given).not.toHaveBeenCalled();
  });

  it("F-154: the sheet of /rad gives the saver its sign-in check (wiring, read from the source)", () => {
    const source = readFileSync(join(process.cwd(), "src/components/editor/LocalDocument.tsx"), "utf8");
    const calls = source.match(/createDocumentSaver\(\{[^}]*\}\)/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("current: () => !ended()");
  });

  it("an empty assignment id counts as none", () => {
    const { evidence } = createDocumentSaver({ journal: openJournal(), documentId: DOC, current: () => true, assignmentId: "", source: online });
    expect(evidence).toBeNull();
  });

  it("with an assignment the evidence session opens the work through the given fetch", async () => {
    const given = vi.fn<FetchLike>(async () => json(404, { status: "not_found" }));
    const { saver, evidence } = createDocumentSaver({
      journal: openJournal(), documentId: DOC, current: () => true, assignmentId: "a-izmisljeni", fetchImpl: given, source: online,
    });
    expect(evidence).toBeInstanceOf(EvidenceSession);
    expect(saver).toBe(evidence);
    expect((await saver.load()).kind).toBe("unavailable");
    expect(given.mock.calls.map(([url]) => url)).toEqual(["/api/evidence/open"]);
  });

  it("the evidence notice: conflict for the sticky states, refused only for a final refusal", () => {
    const base = { failure: null, capacity: "ok" as const, closedBy: null };
    expect(evidenceNotice(null)).toBeNull();
    expect(evidenceNotice({ ...base, state: "CONFLICT" })).toBe("conflict");
    expect(evidenceNotice({ ...base, state: "RECOVERY_REQUIRED" })).toBe("conflict");
    expect(evidenceNotice({ ...base, state: "ERROR", refused: true })).toBe("refused");
    expect(evidenceNotice({ ...base, state: "ERROR", refused: false })).toBeNull();
    expect(evidenceNotice({ ...base, state: "LOCAL_DURABLE", closedBy: "submission" })).toBeNull();
  });

  it("the local saver's own snapshot never gives an evidence notice (e2e local-editor stored ids)", () => {
    // Its RECOVERY_REQUIRED is an unreadable local record; the recovery text stays.
    const local = { failure: "corrupt" as const, capacity: "ok" as const };
    expect(evidenceNotice({ ...local, state: "RECOVERY_REQUIRED" })).toBeNull();
    expect(evidenceNotice({ ...local, state: "CONFLICT" })).toBeNull();
    const { saver } = createDocumentSaver({ journal: openJournal(), documentId: DOC, current: () => true, assignmentId: null, source: online });
    expect(evidenceNotice({ ...saver.snapshot(), state: "RECOVERY_REQUIRED" })).toBeNull();
  });

  // Review #811 (c.6418056374, 1): after a reload in CONFLICT the sheet says
  // the server's work differs, not that the local record is unreadable.
  it("a sticky evidence load speaks for the sheet; any other recovery does not", () => {
    expect(snapshotSpeaks("ready", false)).toBe(true);
    expect(snapshotSpeaks("recovery", true)).toBe(true);
    expect(snapshotSpeaks("recovery", false)).toBe(false);
    for (const phase of ["loading", "blocked", "unavailable", "signed-out"]) {
      expect(snapshotSpeaks(phase, true)).toBe(false);
    }
  });

  it("writing closes on a submission and on the sticky states only", () => {
    const base = { failure: null, capacity: "ok" as const };
    expect(writingClosed({ ...base, state: "LOCAL_DURABLE", closedBy: "submission" })).toBe(true);
    expect(writingClosed({ ...base, state: "CONFLICT" })).toBe(true);
    expect(writingClosed({ ...base, state: "RECOVERY_REQUIRED" })).toBe(true);
    for (const state of ["EDITING", "SAVING_LOCAL", "LOCAL_DURABLE", "SYNCING", "SYNCED", "ERROR"] as const) {
      expect(writingClosed({ ...base, state, closedBy: null })).toBe(false);
    }
  });
});
