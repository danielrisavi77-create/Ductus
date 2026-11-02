/**
 * Browser side of the input origin suite (M3.5-P01, D-54 spike, DAN-390):
 * the editor with the extensions `LocalDocumentProvider` gives it, the
 * `SourceObserver` included, on a bare page. Each change that edits the
 * document gets the source the production code would record for it; the
 * page keeps only that list. Of the `beforeinput` events it keeps the
 * `inputType` and `isTrusted` alone: never a key, a text, a time or a run.
 * It is bundled by `source-harness.ts` and never shipped.
 */

import { Editor } from "@tiptap/core";

import type { EvidenceSourceV2 } from "../../src/domain/forensics/evidence-segment-v2";
import { ArrowCollapse } from "../../src/editor/arrow-collapse";
import { createEditorExtensions } from "../../src/editor/schema";
import { sourceOfChange, SourceObserver } from "../../src/editor/source";
import { StorableInput } from "../../src/editor/storable-input";

export type InputSignal = { inputType: string; isTrusted: boolean };

export type SourceHarness = {
  /** Set once the editor has made its own changes on creation (block ids). */
  ready: boolean;
  /** The source of every change that edited the document, in order. */
  sources(): EvidenceSourceV2[];
  /** The `beforeinput` events the editor received, as kind and trust only. */
  signals(): InputSignal[];
  text(): string;
  /** Empties the document and both lists; the reset itself is not recorded. */
  reset(): void;
  /** A change made by a script through the editor's own API, with no DOM event. */
  scripted(text: string): void;
};

declare global {
  interface Window {
    __source?: SourceHarness;
  }
}

const observer = new SourceObserver();
const editor = new Editor({
  element: document.querySelector("#editor"),
  extensions: [...createEditorExtensions(), StorableInput, ArrowCollapse, observer.extension],
});

let sources: EvidenceSourceV2[] = [];
let signals: InputSignal[] = [];
let resetting = false;
let ready = false;

editor.on("transaction", ({ transaction, appendedTransactions }) => {
  const all = [transaction, ...appendedTransactions];
  const seen = observer.take(all);
  // Like `readyRef` in `LocalDocumentProvider`: what the editor does to itself
  // while it is created is not a change of the author.
  if (!ready || resetting || !all.some((tr) => tr.docChanged)) return;
  sources.push(sourceOfChange(all, seen));
});

editor.view.dom.addEventListener("beforeinput", (event) => {
  signals.push({ inputType: (event as InputEvent).inputType, isTrusted: event.isTrusted });
}, { capture: true });

const harness: SourceHarness = {
  ready: false,
  sources: () => [...sources],
  signals: () => signals.map((signal) => ({ ...signal })),
  text: () => editor.getText(),
  reset() {
    resetting = true;
    editor.commands.clearContent();
    resetting = false;
    sources = [];
    signals = [];
  },
  scripted(text) {
    editor.commands.insertContent(text);
  },
};

window.__source = harness;
// Registered after the extensions' own `create` handlers, so it runs last.
editor.on("create", () => {
  ready = true;
  harness.ready = true;
});
