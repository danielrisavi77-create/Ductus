// @vitest-environment node
import { Editor } from "@tiptap/core";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";

import { canonical, replays, type Recorded } from "./capture.fixture";
import { EvidenceRecorder } from "./capture";
import {
  MAX_REPLACE_ALL,
  replaceAllTransaction,
  replaceMatchTransaction,
  searchDocument,
  type SearchResult,
} from "./find-replace";
import { createEditorExtensions } from "./schema";
import { NO_OBSERVATION, recordWithSource, type SourceObservation } from "./source";

/**
 * DAN-507 (M5.10-P02), contract #1091 c.6587093852: one row per input class,
 * through the real editor, its history, the recorder and the server's
 * replayer. Synthetic text and ids only.
 *
 * Invariant after every row:
 *   1. matches are literal, non-overlapping, left to right, inside one block;
 *   2. "replace all" is one transaction, one recorded event, one undo step,
 *      and its segment replays to exactly what the editor holds;
 *   3. it is one pass over the matches found before it (no loop);
 *   4. every block keeps its type and id, and the number of blocks holds.
 */

const ids = ["a", "b", "c", "d"].map((x) => `${x.repeat(8)}-0000-4000-8000-${x.repeat(12)}`);
const T0 = Date.parse("2026-11-02T09:00:00.000Z");

type Mark = "bold" | "italic";
type Run = string | { text: string; marks: Mark[] };
type BlockSpec = { type?: "paragraph" | "heading" | "bulletItem" | "quote"; runs: Run[] };

function blockJSON(spec: BlockSpec, index: number) {
  const content = spec.runs
    .map((run) => (typeof run === "string" ? { text: run, marks: [] as Mark[] } : run))
    .filter((run) => run.text !== "")
    .map((run) => ({ type: "text", text: run.text, ...(run.marks.length ? { marks: run.marks.map((type) => ({ type })) } : {}) }));
  const type = spec.type ?? "paragraph";
  return { type, attrs: { nodeId: ids[index], ...(type === "heading" ? { level: 1 } : {}) }, ...(content.length ? { content } : {}) };
}

/** An editor whose every change goes through `recordWithSource`, as `LocalDocument` records it. */
function recorded(specs: BlockSpec[]): Recorded & { undo(): void; observation: SourceObservation } {
  const editor = new Editor({ element: null, extensions: createEditorExtensions(), content: { type: "doc", content: specs.map(blockJSON) } });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  const recorder = new EvidenceRecorder();
  const initial = canonical(editor);
  let at = T0;
  const t = {
    editor, recorder, initial,
    observation: NO_OBSERVATION,
    as() { at += 1_000; },
    undo() { editor.commands.undo(); },
  };
  editor.on("transaction", ({ transaction, appendedTransactions }) => {
    const all: Transaction[] = [transaction, ...appendedTransactions];
    recordWithSource(recorder, all, t.observation, (at += 50));
  });
  return t;
}

const texts = (editor: Editor) => editor.state.doc.content.content.map((block) => block.textContent);
const shape = (editor: Editor) => editor.state.doc.content.content.map((block) => [block.type.name, block.attrs.nodeId]);
const ranges = (result: SearchResult | null) => result?.matches.map(({ from, to }) => [from, to]) ?? null;
const p = (...runs: Run[]): BlockSpec => ({ runs });

type Row = {
  name: string;
  blocks: BlockSpec[];
  query: string;
  matchCase?: boolean;
  replacement: string;
  /** Text of each match, in order. */
  found: string[];
  /** Block texts after "replace all", or the refusal. */
  after: string[] | "no_match" | "unchanged" | "invalid_replacement" | "invalid_query";
};

const ROWS: Row[] = [
  { name: "K1 empty query", blocks: [p("abc")], query: "", replacement: "x", found: [], after: "no_match" },
  { name: "K2 no match", blocks: [p("abc")], query: "x", replacement: "y", found: [], after: "no_match" },
  { name: "K3 one match", blocks: [p("izmisljeni tekst")], query: "tekst", replacement: "odlomak", found: ["tekst"], after: ["izmisljeni odlomak"] },
  {
    name: "K4 several, in several blocks",
    blocks: [p("ab ab"), p("x"), p("ab")], query: "ab", replacement: "c",
    found: ["ab", "ab", "ab"], after: ["c c", "x", "c"],
  },
  { name: "K5 overlaps aaa", blocks: [p("aaa")], query: "aa", replacement: "b", found: ["aa"], after: ["ba"] },
  { name: "K5 overlaps aaaa", blocks: [p("aaaa")], query: "aa", replacement: "b", found: ["aa", "aa"], after: ["bb"] },
  { name: "K6 across a block boundary", blocks: [p("ab"), p("cd")], query: "bc", replacement: "x", found: [], after: "no_match" },
  {
    name: "K7 across a mark boundary",
    blocks: [p({ text: "iz", marks: ["bold"] }, "misljeno")], query: "zmi", replacement: "ZMI",
    found: ["zmi"], after: ["iZMIsljeno"],
  },
  { name: "K8 a → aa", blocks: [p("aaa")], query: "a", replacement: "aa", found: ["a", "a", "a"], after: ["aaaaaa"] },
  { name: "K8 ab → b", blocks: [p("aabb")], query: "ab", replacement: "b", found: ["ab"], after: ["abb"] },
  { name: "K9 empty replacement", blocks: [p("a-b-c")], query: "-", replacement: "", found: ["-", "-"], after: ["abc"] },
  { name: "K9 whole block text", blocks: [p("xx"), p("yxx")], query: "xx", replacement: "", found: ["xx", "xx"], after: ["", "y"] },
  { name: "K10 pattern is literal", blocks: [p("a.*b axb")], query: "a.*b", replacement: "z", found: ["a.*b"], after: ["z axb"] },
  { name: "K11 case on", blocks: [p("Čaša čaša")], query: "čaša", replacement: "šalica", found: ["čaša"], after: ["Čaša šalica"] },
  {
    name: "K11 case off", blocks: [p("Čaša čaša ČAŠA")], query: "čaša", matchCase: false, replacement: "šalica",
    found: ["Čaša", "čaša", "ČAŠA"], after: ["šalica šalica šalica"],
  },
  { name: "K12 emoji", blocks: [p("a😀b😀")], query: "😀", replacement: "🙂", found: ["😀", "😀"], after: ["a🙂b🙂"] },
  { name: "K12 half a pair", blocks: [p("a😀b")], query: "\uDE00", replacement: "x", found: [], after: "invalid_query" },
  { name: "K13 query with a line break", blocks: [p("a b")], query: "a\nb", replacement: "x", found: [], after: "invalid_query" },
  { name: "K13 replacement with NUL", blocks: [p("ab")], query: "a", replacement: "\u0000", found: ["a"], after: "invalid_replacement" },
  { name: "K13 replacement with a lone surrogate", blocks: [p("ab")], query: "a", replacement: "\uD800", found: ["a"], after: "invalid_replacement" },
  { name: "K13 replacement with a tab", blocks: [p("ab")], query: "a", replacement: "\t", found: ["a"], after: "invalid_replacement" },
  { name: "K13 replacement too long", blocks: [p("ab")], query: "a", replacement: "x".repeat(201), found: ["a"], after: "invalid_replacement" },
  {
    name: "K15 heading, list item and quote",
    blocks: [{ type: "heading", runs: ["Uvod u temu"] }, { type: "bulletItem", runs: ["prva temu"] }, { type: "quote", runs: ["citat temu"] }],
    query: "temu", replacement: "rad", found: ["temu", "temu", "temu"], after: ["Uvod u rad", "prva rad", "citat rad"],
  },
  { name: "K16 the same text", blocks: [p("ab ab")], query: "ab", replacement: "ab", found: ["ab", "ab"], after: "unchanged" },
  {
    name: "K16 case off, the same text in one of two", blocks: [p("Ab ab")], query: "ab", matchCase: false, replacement: "ab",
    found: ["Ab", "ab"], after: ["ab ab"],
  },
];

describe("find and replace: every input class", () => {
  it.each(ROWS)("$name", async (row) => {
    const t = recorded(row.blocks);
    const before = { texts: texts(t.editor), shape: shape(t.editor), json: t.editor.getJSON() };
    const result = searchDocument(t.editor.state.doc, { text: row.query, matchCase: row.matchCase ?? true });

    if (row.after === "invalid_query") {
      expect(result).toBeNull();
      return;
    }
    expect(result).not.toBeNull();
    const doc = t.editor.state.doc;
    expect(result!.matches.map(({ from, to }) => doc.textBetween(from, to))).toEqual(row.found);
    for (const [i, match] of result!.matches.entries()) {
      // Inside one block, and that block's id.
      const $from = doc.resolve(match.from);
      expect($from.sameParent(doc.resolve(match.to))).toBe(true);
      expect(match.blockId).toBe($from.parent.attrs.nodeId);
      if (i > 0) expect(match.from).toBeGreaterThanOrEqual(result!.matches[i - 1]!.to);
    }

    const outcome = replaceAllTransaction(t.editor.state, result!, row.replacement);
    if (typeof row.after === "string") {
      expect(outcome).toEqual({ ok: false, reason: row.after });
      expect(t.editor.getJSON()).toEqual(before.json);
      expect(t.recorder.pendingEvents).toBe(0);
      return;
    }
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    t.editor.view.dispatch(outcome.tr);

    expect(texts(t.editor)).toEqual(row.after);
    expect(shape(t.editor)).toEqual(before.shape);
    // One recorded event, and it replays to what the editor holds.
    t.recorder.close();
    expect(t.recorder.pendingEvents).toBe(1);
    await replays(t);
    // One undo step takes all of it back.
    t.undo();
    expect(texts(t.editor)).toEqual(before.texts);
  });

  it("K7: the replacement takes the marks of the first character of the match", () => {
    const t = recorded([p({ text: "iz", marks: ["bold"] }, "misljeno")]);
    const result = searchDocument(t.editor.state.doc, { text: "zmi", matchCase: true })!;
    const outcome = replaceAllTransaction(t.editor.state, result, "ZMI");
    t.editor.view.dispatch(outcome.ok ? outcome.tr : t.editor.state.tr);
    expect(t.editor.getJSON().content![0]!.content).toEqual([
      { type: "text", text: "iZMI", marks: [{ type: "bold" }] },
      { type: "text", text: "sljeno" },
    ]);
  });

  it("K14: over the limit, replace all is refused and the matches stop at the limit", () => {
    const t = recorded([p("x".repeat(MAX_REPLACE_ALL + 1))]);
    const result = searchDocument(t.editor.state.doc, { text: "x", matchCase: true })!;
    expect(result.matches).toHaveLength(MAX_REPLACE_ALL);
    expect(result.overLimit).toBe(true);
    expect(replaceAllTransaction(t.editor.state, result, "y")).toEqual({ ok: false, reason: "too_many" });
    // One match can still be replaced.
    expect(replaceMatchTransaction(t.editor.state, result, 0, "y").ok).toBe(true);
  });

  it("K14: at the limit, the longest replacement is one segment under D-96 that replays", async () => {
    const t = recorded([p("x ".repeat(MAX_REPLACE_ALL))]);
    const result = searchDocument(t.editor.state.doc, { text: "x", matchCase: true })!;
    expect(result.overLimit).toBe(false);
    const outcome = replaceAllTransaction(t.editor.state, result, "ž😀".repeat(66) + "ž");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) t.editor.view.dispatch(outcome.tr);
    await replays(t);
  });

  it("replace one: only the match asked for changes", async () => {
    const t = recorded([p("ab ab ab")]);
    const result = searchDocument(t.editor.state.doc, { text: "ab", matchCase: true })!;
    const outcome = replaceMatchTransaction(t.editor.state, result, 1, "c");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) t.editor.view.dispatch(outcome.tr);
    expect(texts(t.editor)).toEqual(["ab c ab"]);
    await replays(t);
    expect(replaceMatchTransaction(t.editor.state, searchDocument(t.editor.state.doc, { text: "ab", matchCase: true })!, 5, "c"))
      .toEqual({ ok: false, reason: "no_match" });
  });
});

describe("find and replace: evidence", () => {
  it("replace all is an event of its own between typing, and its source is unattributed even after a key", async () => {
    const t = recorded([p("ab ab")]);
    t.observation = { ...NO_OBSERVATION, keyedInput: true };
    t.editor.view.dispatch(t.editor.state.tr.insertText("x", 1));
    const result = searchDocument(t.editor.state.doc, { text: "ab", matchCase: true })!;
    const outcome = replaceAllTransaction(t.editor.state, result, "c");
    if (outcome.ok) t.editor.view.dispatch(outcome.tr);
    t.editor.view.dispatch(t.editor.state.tr.insertText("y", 1));
    t.recorder.close();
    expect(t.recorder.pendingEvents).toBe(3);
    expect(texts(t.editor)).toEqual(["yxc c"]);
    const built = (await t.recorder.takeSegment({
      documentId: "dokument-izmisljeni",
      sessionId: "11111111-1111-4111-8111-111111111111",
      segmentId: "22222222-2222-4222-8222-222222222222",
      evidenceProfileId: "profil-izmisljeni",
      sequenceFrom: 1,
      predecessorSegmentHash: null,
    }))!;
    expect(built.segment.events.map((event) => event.source)).toEqual(["editor", "unattributed", "editor"]);
  });

  it("replace all is never one event with a program change of the same source before or after it", () => {
    const t = recorded([p("ab ab")]);
    t.editor.view.dispatch(t.editor.state.tr.insertText("x", 1));
    const outcome = replaceAllTransaction(t.editor.state, searchDocument(t.editor.state.doc, { text: "ab", matchCase: true })!, "c");
    if (outcome.ok) t.editor.view.dispatch(outcome.tr);
    t.editor.view.dispatch(t.editor.state.tr.insertText("y", 1));
    t.recorder.close();
    expect(texts(t.editor)).toEqual(["yxc c"]);
    expect(t.recorder.pendingEvents).toBe(3);
  });

  it("replace all is its own undo step, even right after typing next to a match", () => {
    const t = recorded([p("ab")]);
    t.editor.view.dispatch(t.editor.state.tr.insertText("b", 3));
    const outcome = replaceAllTransaction(t.editor.state, searchDocument(t.editor.state.doc, { text: "b", matchCase: true })!, "c");
    if (outcome.ok) t.editor.view.dispatch(outcome.tr);
    expect(texts(t.editor)).toEqual(["acc"]);
    t.undo();
    expect(texts(t.editor)).toEqual(["abb"]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("no telemetry: search and replace log, fetch and store nothing", () => {
    const spies = [
      ...(["log", "info", "warn", "error", "debug"] as const).map((name) => vi.spyOn(console, name)),
      vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new Error("no network"))),
    ];
    const t = recorded([p("tajni izmisljeni tekst")]);
    const result = searchDocument(t.editor.state.doc, { text: "tajni", matchCase: false })!;
    const outcome = replaceAllTransaction(t.editor.state, result, "javni");
    if (outcome.ok) t.editor.view.dispatch(outcome.tr);
    replaceAllTransaction(t.editor.state, result, "\u0000");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("Istodobnost: the text changes between search and replace", () => {
  const stale = (t: Recorded, result: SearchResult) => {
    const json = t.editor.getJSON();
    const pending = t.recorder.pendingEvents;
    expect(replaceAllTransaction(t.editor.state, result, "c")).toEqual({ ok: false, reason: "stale" });
    expect(replaceMatchTransaction(t.editor.state, result, 0, "c")).toEqual({ ok: false, reason: "stale" });
    expect(t.editor.getJSON()).toEqual(json);
    // Only the change made after the search is recorded: the refusals add nothing.
    expect(t.recorder.pendingEvents).toBe(pending);
    t.recorder.close();
    expect(t.recorder.pendingEvents).toBe(1);
  };

  it("typing after the search makes the result stale", () => {
    const t = recorded([p("ab ab")]);
    const result = searchDocument(t.editor.state.doc, { text: "ab", matchCase: true })!;
    t.editor.view.dispatch(t.editor.state.tr.insertText("a", 1));
    stale(t, result);
    expect(texts(t.editor)).toEqual(["aab ab"]);
  });

  it("a change taken back by undo still makes the result stale", () => {
    const t = recorded([p("ab ab")]);
    const result = searchDocument(t.editor.state.doc, { text: "ab", matchCase: true })!;
    t.editor.view.dispatch(t.editor.state.tr.insertText("z", 1));
    t.undo();
    expect(texts(t.editor)).toEqual(["ab ab"]);
    stale(t, result);
  });

  it("a change to the selection alone does not", () => {
    const t = recorded([p("ab ab")]);
    const result = searchDocument(t.editor.state.doc, { text: "ab", matchCase: true })!;
    t.editor.view.dispatch(t.editor.state.tr.setSelection(TextSelection.create(t.editor.state.doc, 3)));
    expect(ranges(result)).toEqual([[1, 3], [4, 6]]);
    const outcome = replaceAllTransaction(t.editor.state, result, "c");
    expect(outcome.ok).toBe(true);
  });
});
