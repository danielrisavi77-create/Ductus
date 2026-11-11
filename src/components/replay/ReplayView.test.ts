import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { findForbiddenTermsInMarkup } from "../../../scripts/forbidden-terms/terms";
import { createBrowserReplayStepsV1 } from "@/adapters/evidence/edit-steps-v1-replay-steps";
import { buildReplayPlayer, type ReplayRecord } from "@/domain/projection/replay-player";
import {
  BLOCK_A as A,
  BLOCK_D as D,
  buildRecord,
  jcsOf,
  recordSchema as schema,
  serverReplayer as server,
  sha,
  startNode as start,
  type BuiltRecord,
  type RecordEdit,
} from "@/domain/projection/replay-record.fixture";
import type { JcsJsonValue } from "@/domain/forensics/jcs";
import { messagesHr } from "@/lib/i18n/messages.hr";

import ReplayView, { ReplayPlayerView } from "./ReplayView";
import { fill } from "./replay-view";

/**
 * DAN-537 (rb 261): the replay view over a real player built from a synthetic
 * record (invented ids, filler text). The record is never read here: the
 * request is a stand-in that stays pending, so only the first render shows.
 */

vi.mock("@/client/replay", async (original) => ({
  ...(await original<typeof import("@/client/replay")>()),
  loadReplay: vi.fn(() => new Promise(() => {})),
}));

const t = messagesHr.replay;
const steps = createBrowserReplayStepsV1();
const recordOf = (r: BuiltRecord, over: Partial<ReplayRecord> = {}): ReplayRecord =>
  ({ startDocument: jcsOf(start), segments: r.segments, head: r.head, resumeDocuments: {}, ...over });

async function playerOf(r: BuiltRecord, over: Partial<ReplayRecord> = {}) {
  const player = await buildReplayPlayer(recordOf(r, over), steps);
  if (!player.ok) throw new Error(player.reason);
  return player;
}

// Synthetic only: a document a later segment starts from, after a break.
const elsewhere = server.load({
  schemaVersion: 1,
  nodes: [{ type: "paragraph", id: A, children: [{ type: "text", text: "Drugi tekst.", marks: [] }] }, { type: "paragraph", id: D, children: [] }],
} as JcsJsonValue);

const typeAt = (pos: number, value: string, source?: "paste"): RecordEdit =>
  ({ source, edit: (tr) => { tr.insert(pos, schema.text(value)); } });

const record = () => buildRecord(start, [
  { at: "10:00", until: "10:02", events: [typeAt(17, "X"), typeAt(1, "Novo ", "paste")] },
  { at: "12:00", events: [{ edit: (tr) => tr.delete(32, 33) }] },
]);

const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("ReplayPlayerView (DAN-537)", () => {
  it("shows the last change of the record, its source, the gap and the paragraph's history", async () => {
    const player = await playerOf(record());
    const markup = renderToStaticMarkup(h(ReplayPlayerView, { player }));
    const shown = text(markup);

    expect(shown).toContain("Promjena 3 od 3");
    expect(shown).toContain("Promjena 3: obrisan 1 znak u odlomku 2.");
    // The record starts after the work began: said once on the sheet and listed with a way to it.
    expect(shown).toContain(t.gapStartsLater);
    expect(shown).toContain("Idi na promjenu 1");
    // The history of the paragraph the shown change touched.
    expect(shown).toContain("Povijest odlomka 2");
    expect(shown).toContain("Sadašnja (promjena 3)");
    // The source of the shown change, and a native slider over every position.
    expect(shown).toContain("utipkano");
    expect(markup).toMatch(/<input[^>]*type="range"[^>]*min="0"[^>]*max="3"/);
    expect(markup).toContain('aria-valuetext="Promjena 3 od 3"');
    // The next change does not exist yet; the previous one does.
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Sljedeća promjena/);
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>Prethodna promjena/);
    // The touched paragraph is marked, the others are not.
    expect(markup.match(/data-node-id="[^"]+" class="[^"]*touched/g)?.length).toBe(1);
  });

  it("names the paste as a source not observed, and nothing about time", async () => {
    const player = await playerOf(buildRecord(start, [{ at: "09:41", events: [typeAt(1, "Umetak ", "paste")] }]));
    const markup = renderToStaticMarkup(h(ReplayPlayerView, { player }));
    const shown = text(markup);
    expect(shown).toContain(t.sources.paste);
    expect(shown).toContain("Promjena 1: umetnuto 7 znakova u odlomku 1.");
    // D-143, D-239: the record's times never reach the page.
    expect(shown).not.toMatch(/09:41|2026|\d:\d/);
    expect(findForbiddenTermsInMarkup(shown, shown)).toEqual([]);
  });

  it("says where the record stopped and replays nothing after it", async () => {
    // The second segment starts from a document the record holds no checkpoint for.
    const r = buildRecord(start, [
      { at: "10:00", events: [typeAt(17, "X")] },
      { at: "10:05", from: elsewhere, events: [typeAt(13, "!")] },
    ]);
    const player = await playerOf(r);
    const shown = text(renderToStaticMarkup(h(ReplayPlayerView, { player })));
    expect(player.total).toBe(1);
    expect(shown).toContain("Promjena 1 od 1");
    expect(shown).toContain(fill(t.gapStopped, { a: 1 }));
    expect(shown).toContain(t.gapStoppedNote);
    expect(shown).not.toContain("Promjena 2");
  });

  it("shows a resumed break at its place and goes on after it", async () => {
    const r = buildRecord(start, [
      { at: "10:00", events: [typeAt(17, "X")] },
      { at: "10:05", from: elsewhere, events: [typeAt(13, "!")] },
    ]);
    const player = await playerOf(r, { resumeDocuments: { [sha(jcsOf(elsewhere))]: jcsOf(elsewhere) } });
    const shown = text(renderToStaticMarkup(h(ReplayPlayerView, { player })));
    expect(shown).toContain("Promjena 2 od 2");
    expect(shown).toContain(fill(t.gapBetween, { a: 1, b: 2 }));
    expect(shown).toContain("Idi na promjenu 2");
  });

  it("keeps repeated spaces of the replayed text, in the markup and on the page", async () => {
    const player = await playerOf(buildRecord(start, [{ at: "10:00", events: [typeAt(1, "Dva  razmaka ")] }]));
    const markup = renderToStaticMarkup(h(ReplayPlayerView, { player }));
    expect(markup).toContain("Dva  razmaka");
    // Without pre-wrap the browser folds the two spaces into one and the change is not seen.
    const css = readFileSync(path.resolve("src/components/replay/ReplayView.module.css"), "utf8");
    expect(css).toMatch(/\.text,\s*\.table td\s*\{[^}]*white-space:\s*pre-wrap/);
  });

  it("keeps the block ids of the replayed text, so the marked paragraph is the changed one", async () => {
    const player = await playerOf(buildRecord(start, [{ at: "10:00", events: [typeAt(17, "X")] }]));
    const markup = renderToStaticMarkup(h(ReplayPlayerView, { player }));
    expect(markup).toContain(`data-node-id="${A}" class=`);
  });
});

describe("ReplayView (DAN-537)", () => {
  it("says it is loading, and carries the purpose and the two notes", () => {
    const markup = renderToStaticMarkup(h(ReplayView, { documentId: "doc-test-z1", session: null, student: false }));
    const shown = text(markup);
    expect(markup).toContain('aria-busy="true"');
    expect(shown).toContain(t.loading);
    expect(shown).toContain(t.purpose);
    expect(shown).not.toContain(t.sameView);
    expect(shown).toContain(t.note);
    expect(shown).toContain(t.foot);
  });

  it("tells the student the mentor sees the same view", () => {
    const shown = text(renderToStaticMarkup(h(ReplayView, { documentId: "doc-test-z1", session: null, student: true })));
    expect(shown).toContain(t.sameView);
  });
});
