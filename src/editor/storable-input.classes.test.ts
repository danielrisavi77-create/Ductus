// @vitest-environment node
import { Editor } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { verifyCanonicalEvidencePayloadV2 } from "@/domain/forensics/evidence-chain-v2";

import { changeOf, EvidenceRecorder, type SegmentContext } from "./capture";
import { tiptapToCanonical } from "./interop";
import { createEditorExtensions, NODE_ID_ATTRIBUTE } from "./schema";
import { StorableInput } from "./storable-input";
import { storableText } from "./storable-text";

/**
 * DAN-699 (#1876, plan #1897): text pasted, dropped or typed into the sheet
 * is recorded as steps the server takes. One U+0000 in a paste used to reach
 * the recorded step, the server's `parseEditSteps` refused it (`invalid_text`)
 * and the recorder stopped for good. Every input class of the contract is
 * pasted, dropped and typed here, each through what prosemirror-view does
 * with it, and the segment the recorder builds must pass the server's own
 * payload check. Synthetic text only.
 */

const ID = "aaaaaaaa-0000-4000-8000-00000000000a";
const BEFORE = "Odlomak ";
const T0 = Date.parse("2026-11-11T09:00:00.000Z");
const CONTEXT: SegmentContext = {
  documentId: "dokument-izmisljeni",
  sessionId: "11111111-1111-4111-8111-111111111111",
  segmentId: "22222222-2222-4222-8222-222222222222",
  evidenceProfileId: "profil-izmisljeni",
  sequenceFrom: 1,
  predecessorSegmentHash: null,
};

const C0 = Array.from({ length: 0x1f }, (_, i) => String.fromCharCode(i + 1)).join("");
const NUL = String.fromCharCode(0);

/** The classes of the contract (#1836 OBLAK w699a · UGOVOR): what goes in, what the sheet holds. */
const CLASSES: readonly { name: string; input: string; held: string }[] = [
  { name: "NUL", input: `a${NUL}b${NUL}`, held: "ab" },
  { name: "NUL only", input: `${NUL}${NUL}`, held: "" },
  { name: "other C0 controls U+0001..U+001F", input: C0, held: C0 },
  { name: "lone high surrogate", input: "x\uD83Dy", held: "x�y" },
  { name: "lone low surrogate", input: "x\uDE00y", held: "x�y" },
  { name: "a valid pair is kept", input: "x😀y", held: "x😀y" },
  { name: "U+FFFE and U+FFFF", input: "x￾￿y", held: "x￾￿y" },
  { name: "BOM U+FEFF", input: "﻿x﻿", held: "﻿x﻿" },
  { name: "mix with diacritics", input: `čć${NUL}žš\uD800đ﻿Č\u0007Ž😀`, held: "čćžš�đ﻿Č\u0007Ž😀" },
  { name: "more than eight runs", input: `a${NUL}`.repeat(12) + "\uDC00".repeat(3), held: "a".repeat(12) + "�".repeat(3) },
];

type Input = "paste" | "drop" | "type";

/** The two view props the test asks, as prosemirror-view calls them. */
type Props = {
  transformPasted: (slice: Slice, view: never, plain: boolean) => Slice;
  handleTextInput: (view: never, from: number, to: number, text: string, deflt: () => Transaction) => boolean | void;
};

function setup() {
  const editor = new Editor({
    element: null,
    extensions: [...createEditorExtensions(), StorableInput],
    content: { type: "doc", content: [{ type: "paragraph", attrs: { [NODE_ID_ATTRIBUTE]: ID }, content: [{ type: "text", text: BEFORE }] }] },
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  const recorder = new EvidenceRecorder();
  let at = T0;
  let repaired = 0;
  let refused: unknown = null;
  editor.on("transaction", ({ transaction, appendedTransactions }) => {
    const all: Transaction[] = [transaction, ...appendedTransactions];
    if (!all.some((tr) => tr.docChanged)) return;
    repaired += appendedTransactions.filter((tr) => tr.docChanged).length;
    at += 50;
    try {
      recorder.record(changeOf(all, "editor", at));
    } catch (error) {
      refused ??= error;
    }
  });
  const view = editor.view;
  // The headless view has no `someProp`: the plugins' props are asked in the
  // same order prosemirror-view asks them.
  const someProp = <K extends keyof Props>(name: K): Props[K][] =>
    editor.state.plugins.flatMap((plugin) => {
      const prop = plugin.props[name];
      return prop ? [prop.bind(plugin) as unknown as Props[K]] : [];
    });
  const end = () => editor.state.doc.content.size - 1;
  const slice = (text: string) => new Slice(Fragment.from(editor.schema.text(text)), 0, 0);
  /** Every plugin's `transformPasted`, as `parseFromClipboard` and `handleDrop` apply them. */
  const transformed = (input: Slice) => {
    let result = input;
    for (const f of someProp("transformPasted")) result = f(result, view as never, true);
    return result;
  };
  return {
    editor, recorder,
    get repaired() { return repaired; },
    get refused() { return refused; },
    input(kind: Input, text: string) {
      editor.commands.setTextSelection(end());
      if (kind === "type") {
        // `readDOMChange`: handleTextInput first, insertText when no prop takes it.
        const from = editor.state.selection.from;
        const insert = () => view.state.tr.insertText(text, from, from);
        if (!someProp("handleTextInput").some((f) => f(view as never, from, from, text, insert))) view.dispatch(insert());
        return;
      }
      // `doPaste` and `handleDrop` both replace the selection with the transformed slice.
      const tr = editor.state.tr.replaceSelection(transformed(slice(text)));
      view.dispatch(kind === "paste" ? tr.setMeta("paste", true).setMeta("uiEvent", "paste") : tr.setMeta("uiEvent", "drop"));
    },
    text: () => editor.state.doc.textContent,
  };
}

/** The segment the recorder builds, checked as the server checks a payload (B-8). */
async function serverTakes(recorder: EvidenceRecorder): Promise<boolean> {
  recorder.close();
  const built = await recorder.takeSegment(CONTEXT);
  if (built === null) return true;
  const payload = await verifyCanonicalEvidencePayloadV2(built.bytes);
  return payload.ok;
}

describe("DAN-699: every input class reaches the recorder as text the server takes", () => {
  for (const kind of ["paste", "drop", "type"] as const) {
    for (const { name, input, held } of CLASSES) {
      it(`${kind}: ${name}`, async () => {
        const t = setup();
        t.input(kind, input);
        expect(t.text()).toBe(BEFORE + held);
        // Cleaned before the step, never by a repair after it: a repair after
        // a refused step leaves the refused step in the record.
        expect(t.repaired).toBe(0);
        expect(t.refused).toBeNull();
        expect(t.recorder.intact).toBe(true);
        expect(await serverTakes(t.recorder)).toBe(true);
        expect(t.recorder.intact).toBe(true);
        const canonical = tiptapToCanonical(t.editor.getJSON());
        expect(canonical.ok).toBe(true);
        t.editor.destroy();
      });
    }
  }
});

// Units from every class, halves of pairs included, so a mix can build or break a pair.
const unit = fc.constantFrom(NUL, "\u0001", "\u0009", "\u001F", "\uD83D", "\uDE00", "\uD800", "\uDFFF", "😀", "￾", "￿", "﻿", "č", "ć", "ž", "š", "đ", "a", " ");

describe("DAN-699 property", () => {
  it("any mix pasted, dropped or typed is held as storableText and the server takes the segment", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<Input>("paste", "drop", "type"), fc.array(unit, { minLength: 1, maxLength: 16 }), async (kind, units) => {
        const input = units.join("");
        const t = setup();
        try {
          t.input(kind, input);
          expect(t.text()).toBe(BEFORE + storableText(input));
          expect(t.repaired).toBe(0);
          expect(t.refused).toBeNull();
          expect(await serverTakes(t.recorder)).toBe(true);
          expect(t.recorder.intact).toBe(true);
        } finally {
          t.editor.destroy();
        }
      }),
      { numRuns: 60 },
    );
  });
});
