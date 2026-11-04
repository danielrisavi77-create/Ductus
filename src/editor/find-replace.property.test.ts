// @vitest-environment node
import { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { findLiteral } from "@/domain/text/find-literal";

import { EvidenceRecorder } from "./capture";
import { canonical, replays } from "./capture.fixture";
import { replaceAllTransaction, searchDocument } from "./find-replace";
import { createEditorExtensions } from "./schema";
import { NO_OBSERVATION, recordWithSource } from "./source";

/**
 * DAN-507 (M5.10-P02), contract #1091 c.6587093852: random documents, queries
 * and replacements over a small alphabet, so matches, overlaps, case pairs and
 * surrogate pairs are frequent. Synthetic text and ids only.
 */

const IDS = ["a", "b", "c", "d"].map((x) => `${x.repeat(8)}-0000-4000-8000-${x.repeat(12)}`);
const T0 = Date.parse("2026-11-02T09:00:00.000Z");
const ALPHABET = ["a", "A", "b", "č", "Č", "ž", " ", "😀"];
const MARKS = [[], ["bold"], ["italic"], ["bold", "italic"]] as const;

const word = (max: number) => fc.array(fc.constantFrom(...ALPHABET), { maxLength: max }).map((chars) => chars.join(""));
const run = fc.record({ text: word(6), marks: fc.constantFrom(...MARKS) });
const block = fc.record({
  type: fc.constantFrom("paragraph", "heading", "bulletItem", "quote"),
  runs: fc.array(run, { maxLength: 4 }),
});
const docArb = fc.array(block, { minLength: 1, maxLength: 4 });

type BlockSpec = { type: string; runs: { text: string; marks: readonly string[] }[] };

function editorOf(specs: BlockSpec[]) {
  const content = specs.map((spec, i) => {
    const runs = spec.runs
      .filter((r) => r.text !== "")
      .map((r) => ({ type: "text", text: r.text, ...(r.marks.length ? { marks: r.marks.map((type) => ({ type })) } : {}) }));
    return { type: spec.type, attrs: { nodeId: IDS[i], ...(spec.type === "heading" ? { level: 2 } : {}) }, ...(runs.length ? { content: runs } : {}) };
  });
  const editor = new Editor({ element: null, extensions: createEditorExtensions(), content: { type: "doc", content } });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  const recorder = new EvidenceRecorder();
  const initial = canonical(editor);
  let at = T0;
  editor.on("transaction", ({ transaction, appendedTransactions }) => {
    const all: Transaction[] = [transaction, ...appendedTransactions];
    recordWithSource(recorder, all, NO_OBSERVATION, (at += 50));
  });
  return { editor, recorder, initial, as() { at += 1_000; } };
}

const texts = (editor: Editor) => editor.state.doc.content.content.map((b) => b.textContent);
const shape = (editor: Editor) => editor.state.doc.content.content.map((b) => [b.type.name, b.attrs.nodeId]);

describe("find and replace: properties", () => {
  it("findLiteral with case on is exactly the split of the text by the query", () => {
    fc.assert(
      fc.property(word(30), word(3), (text, query) => {
        const found = findLiteral(text, { text: query, matchCase: true });
        expect(found.length).toBe(query === "" ? 0 : text.split(query).length - 1);
        let last = 0;
        for (const { from, to } of found) {
          expect(from).toBeGreaterThanOrEqual(last);
          expect(text.slice(from, to)).toBe(query);
          last = to;
        }
      }),
    );
  });

  it("findLiteral with case off finds what case on finds in the lowercased text, in the same places", () => {
    fc.assert(
      fc.property(word(30), word(3), (text, query) => {
        // Every letter of the alphabet keeps its length when lowercased.
        const off = findLiteral(text, { text: query, matchCase: false });
        expect(off).toEqual(findLiteral(text.toLowerCase(), { text: query.toLowerCase(), matchCase: true }));
      }),
    );
  });

  it("replace all is one change that keeps every block and replays; each block reads as split and join", async () => {
    await fc.assert(
      fc.asyncProperty(docArb, word(3), word(3), fc.boolean(), async (specs, query, replacement, matchCase) => {
        const t = editorOf(specs);
        const before = { texts: texts(t.editor), shape: shape(t.editor) };
        const result = searchDocument(t.editor.state.doc, { text: query, matchCase })!;
        expect(result).not.toBeNull();
        for (const [i, match] of result.matches.entries()) {
          const $from = t.editor.state.doc.resolve(match.from);
          expect($from.sameParent(t.editor.state.doc.resolve(match.to))).toBe(true);
          expect(match.blockId).toBe($from.parent.attrs.nodeId);
          if (i > 0) expect(match.from).toBeGreaterThanOrEqual(result.matches[i - 1]!.to);
        }
        const outcome = replaceAllTransaction(t.editor.state, result, replacement);
        if (!outcome.ok) {
          expect(["no_match", "unchanged"]).toContain(outcome.reason);
          expect(texts(t.editor)).toEqual(before.texts);
          return;
        }
        t.editor.view.dispatch(outcome.tr);
        expect(shape(t.editor)).toEqual(before.shape);
        if (matchCase) expect(texts(t.editor)).toEqual(before.texts.map((text) => text.split(query).join(replacement)));
        expect(t.recorder.pendingEvents).toBe(1);
        await replays(t);
        t.editor.commands.undo();
        expect(texts(t.editor)).toEqual(before.texts);
      }),
      { numRuns: Math.min(Number(process.env.FC_NUM_RUNS ?? 100), 60) },
    );
  });
});
