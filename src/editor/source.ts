/**
 * The source of each change the editor applies (F-8 step 3d-1c, Q1, DAN-287;
 * contract #476 `issuecomment-6385376486` with addenda `6385389840` and
 * `6385392797`).
 *
 * - The observer only watches the editor's DOM events and changes nothing:
 *   every handler returns false and none calls `preventDefault` (I6). What it
 *   saw holds until the end of the browser task the event came in, and is
 *   cleared by `setTimeout(0)`: ProseMirror applies typing from a
 *   `MutationObserver` microtask of the same task, so a microtask is too soon.
 * - It keeps no time, no text and no run of keys (D-56, I5). A key waits only
 *   for the `beforeinput` of the same task and is compared with its `data`
 *   there; that `data` waits only for the change of the task and is dropped.
 *   What stays is a few booleans and the kind of a clipboard event.
 * - What was seen belongs to one change, not to the task (F-127): the caller
 *   passes `observer.take(transactions)`, which hands it to the first change
 *   that edits the document and checks the inserted text against the input.
 * - `sourceOfChange` names a source only with a trusted DOM event of the same
 *   task behind it; any doubt is `unattributed` (D-54, I2). `composition` is
 *   never written in Q1: input without a key and IME composition are
 *   `keyless-input` (owner decision, addendum 2). Undo and Redo are
 *   `unattributed` (P3, I3); so is a toolbar click (addendum 1, t. 3).
 * - `recordWithSource` closes the recorder's open event before and after a
 *   paste, cut or drop, so each is an event of its own and two pastes are
 *   never one (I4); the recorder's API stays as it is.
 */

import { Extension } from "@tiptap/core";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { ReplaceAroundStep, ReplaceStep } from "@tiptap/pm/transform";

import type { EvidenceSourceV2 } from "@/domain/forensics/evidence-segment-v2";

import { changeOf, type EvidenceRecorder } from "./capture";

/** Sources that are always an event of their own (contract §1 c). */
export const STANDALONE_SOURCES = ["paste", "cut", "drop"] as const;
export type StandaloneSource = (typeof STANDALONE_SOURCES)[number];

/** What the observer saw in the current task. Never a key, text or time. */
export type SourceObservation = Readonly<{
  /** A trusted keydown of a key the keymap edits with (Enter, Backspace, Delete, Ctrl+B, Ctrl+I). */
  keymapKey: boolean;
  /** A trusted `insertText` whose data was the key of a trusted keydown of the same task. */
  keyedInput: boolean;
  /** A trusted `insertText` without that keydown, or a trusted `insertCompositionText`. */
  keylessInput: boolean;
  /** A trusted compositionstart or compositionend (IME, dead keys). */
  composing: boolean;
  /** A trusted `insertReplacementText` (spelling, autocorrect). */
  replacement: boolean;
  /** The kind of a trusted paste, cut or drop event. */
  clipboard: StandaloneSource | null;
}>;

export const NO_OBSERVATION: SourceObservation = Object.freeze({
  keymapKey: false,
  keyedInput: false,
  keylessInput: false,
  composing: false,
  replacement: false,
  clipboard: null,
});

const EDITING_KEYS = new Set(["Enter", "Backspace", "Delete"]);
const FORMAT_KEYS = new Set(["b", "B", "i", "I"]);

function isStandalone(value: unknown): value is StandaloneSource {
  return (STANDALONE_SOURCES as readonly unknown[]).includes(value);
}

function isKeymapKey(event: KeyboardEvent): boolean {
  if (EDITING_KEYS.has(event.key)) return true;
  return (event.ctrlKey || event.metaKey) && !event.altKey && FORMAT_KEYS.has(event.key);
}

/** The text a change inserts: the text of every replaced slice, without block or leaf separators. */
function insertedText(transactions: readonly Transaction[]): string {
  let text = "";
  for (const tr of transactions) {
    for (const step of tr.steps) {
      if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
        const { content } = step.slice;
        text += content.textBetween(0, content.size, "", "");
      }
    }
  }
  return text;
}

/**
 * Whether the change inserts one run of text that, with the text around it in
 * its block, reads as `whole` (F-131). Anything else is false.
 */
function completes(transactions: readonly Transaction[], whole: string): boolean {
  let found: { tr: number; step: number; from: number; to: number; text: string } | null = null;
  for (const [i, tr] of transactions.entries()) {
    for (const [j, step] of tr.steps.entries()) {
      if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) continue;
      const { content } = step.slice;
      const text = content.textBetween(0, content.size, "", "");
      if (text === "") continue;
      if (found !== null || !(step instanceof ReplaceStep)) return false;
      found = { tr: i, step: j, from: step.from, to: step.from + step.slice.size, text };
    }
  }
  if (found === null) return false;
  const at = found;
  let { from, to } = at;
  for (const [i, tr] of transactions.entries()) {
    tr.mapping.maps.forEach((map, j) => {
      if (i < at.tr || (i === at.tr && j <= at.step)) return;
      from = map.map(from, 1);
      to = map.map(to, -1);
    });
  }
  const doc = transactions[transactions.length - 1]!.doc;
  if (from < 0 || to > doc.content.size || from > to) return false;
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  if (!$from.parent.isTextblock || !$from.sameParent($to)) return false;
  const block = $from.parent;
  if (block.textBetween($from.parentOffset, $to.parentOffset, "", "") !== found.text) return false;
  const before = block.textBetween(0, $from.parentOffset, "", "");
  const after = block.textBetween($to.parentOffset, block.content.size, "", "");
  const { text } = found;
  for (let k = whole.indexOf(text); k !== -1; k = whole.indexOf(text, k + 1)) {
    if (before.endsWith(whole.slice(0, k)) && after.startsWith(whole.slice(k + text.length))) return true;
  }
  return false;
}

/** One character (one code point) a key would type, or null for any other key. */
function typedKey(event: KeyboardEvent): string | null {
  return [...event.key].length === 1 ? event.key : null;
}

/**
 * Watches one editor. Add `extension` to it (its priority puts the observer
 * before every keymap, which would otherwise stop ProseMirror from asking it)
 * and pass `take(transactions)` to `recordWithSource` when the editor emits
 * `transaction`.
 */
export class SourceObserver {
  private seen: { -readonly [K in keyof SourceObservation]: SourceObservation[K] } = { ...NO_OBSERVATION };
  /** The key of a trusted keydown, kept only until a `beforeinput` or the end of the task. */
  private pendingKey: string | null = null;
  /** The data of a trusted `insertText`, kept only until the change it belongs to or the end of the task (F-127). */
  private inputData: string | null = null;
  /** A trusted `insertCompositionText` was seen in this task. */
  private compositionText = false;
  /** The text of a trusted `insertReplacementText`, kept like `inputData` (F-130). */
  private replacementText: string | null = null;
  /** The text of a trusted compositionend or `insertCompositionText`, kept like `inputData` (F-130, F-132). */
  private composedText: string | null = null;
  private clearing = false;

  readonly plugin: Plugin = new Plugin({
    key: new PluginKey("evidenceSourceObserver"),
    props: {
      handleKeyDown: (_view, event) => {
        this.touch();
        this.pendingKey = event.isTrusted ? typedKey(event) : null;
        if (event.isTrusted && isKeymapKey(event)) this.seen.keymapKey = true;
        return false;
      },
      handlePaste: (_view, event) => this.clipboard("paste", event),
      handleDrop: (_view, event) => this.clipboard("drop", event),
      handleDOMEvents: {
        beforeinput: (_view, event) => {
          this.touch();
          const key = this.pendingKey;
          this.pendingKey = null;
          if (!event.isTrusted) return false;
          if (event.inputType === "insertReplacementText") {
            this.seen.replacement = true;
            // Chromium gives the suggested text in dataTransfer, not in data.
            this.replacementText = event.data ?? event.dataTransfer?.getData("text/plain") ?? null;
          }
          else if (event.inputType === "insertCompositionText") {
            this.seen.keylessInput = true;
            this.compositionText = true;
            if (event.data) this.composedText = event.data;
          }
          else if (event.inputType === "insertText") {
            if (key !== null && event.data === key) this.seen.keyedInput = true;
            else this.seen.keylessInput = true;
            this.inputData = event.data;
          }
          return false;
        },
        cut: (_view, event) => this.clipboard("cut", event),
        compositionstart: (_view, event) => this.composition(event),
        compositionend: (_view, event) => this.composition(event),
      },
    },
  });

  readonly extension = Extension.create({
    name: "evidenceSourceObserver",
    priority: 100_000,
    addProseMirrorPlugins: () => [this.plugin],
  });

  /** What was seen in the current task; a copy, never the observer's own state. */
  get observation(): SourceObservation {
    return { ...this.seen };
  }

  /**
   * What one change may use of what was seen (F-127). The first change of the
   * task that edits the document takes it, so every later change of the task is
   * `unattributed`. A typed key counts only when the change inserts exactly the
   * text of its `beforeinput`; a keymap key only when it inserts no text; input
   * without a key only when it inserts exactly its data. A replacement or a
   * composition counts only when the change inserts the part of the suggested
   * or composed text that changed, where it reads as that text (F-130, F-131).
   * A change that does not edit the document takes nothing.
   */
  take(transactions: readonly Transaction[]): SourceObservation {
    if (!transactions.some((tr) => tr.docChanged)) return this.observation;
    const seen = this.seen;
    const text = insertedText(transactions);
    const sameText = this.inputData !== null && text === this.inputData;
    const partOf = (whole: string | null) => whole !== null && text !== "" && completes(transactions, whole);
    const replaced = partOf(this.replacementText);
    const composed = this.compositionText && partOf(this.composedText);
    const composing = partOf(this.composedText);
    this.forget();
    return {
      ...seen,
      keyedInput: seen.keyedInput && sameText,
      keymapKey: seen.keymapKey && text === "",
      keylessInput: seen.keylessInput && (sameText || composed),
      composing: seen.composing && composing,
      replacement: seen.replacement && replaced,
    };
  }

  private forget(): void {
    this.seen = { ...NO_OBSERVATION };
    this.pendingKey = null;
    this.inputData = null;
    this.compositionText = false;
    this.replacementText = null;
    this.composedText = null;
  }

  /** The first event of a task schedules the clearing at its end. */
  private touch(): void {
    if (this.clearing) return;
    this.clearing = true;
    setTimeout(() => {
      this.forget();
      this.clearing = false;
    }, 0);
  }

  private clipboard(kind: StandaloneSource, event: Event): false {
    this.touch();
    if (event.isTrusted) this.seen.clipboard = kind;
    return false;
  }

  private composition(event: CompositionEvent): false {
    this.touch();
    if (!event.isTrusted) return false;
    this.seen.composing = true;
    if (event.type === "compositionend" && event.data) this.composedText = event.data;
    return false;
  }
}

/**
 * The source of one change (a transaction and those appended to it), by the
 * Q1 table; the first rule that holds decides (contract §1 b, addenda 1 and 2).
 */
export function sourceOfChange(
  transactions: readonly Transaction[],
  observation: SourceObservation,
): EvidenceSourceV2 {
  // 1. Undo and Redo, by key, toolbar or command (P3).
  if (transactions.some((tr) => isHistoryTransaction(tr))) return "unattributed";
  // 2 and 3. A paste, cut or drop counts only with a trusted event of its kind.
  const uiEvent = transactions.map((tr) => tr.getMeta("uiEvent") as unknown).find(isStandalone);
  if (uiEvent !== undefined) return observation.clipboard === uiEvent ? uiEvent : "unattributed";
  // 4. Spelling or autocorrect of the browser.
  if (observation.replacement) return "system-replacement";
  // 5. A key typed or handled by the keymap.
  if (observation.keyedInput || observation.keymapKey) return "editor";
  // 6. Input without a key, IME composition (owner decision: keyless-input).
  if (observation.keylessInput || observation.composing) return "keyless-input";
  // 7. Everything else: a program, a toolbar click, no or an untrusted event.
  return "unattributed";
}

/**
 * Records one change with its source. A paste, cut or drop is an event of
 * its own: the open event is closed before it, and it is closed after it.
 * Returns the source, or null when no transaction changed the document.
 */
export function recordWithSource(
  recorder: EvidenceRecorder,
  transactions: readonly Transaction[],
  observation: SourceObservation,
  at: number,
): EvidenceSourceV2 | null {
  if (!transactions.some((tr) => tr.docChanged)) return null;
  const source = sourceOfChange(transactions, observation);
  const standalone = isStandalone(source);
  if (standalone) recorder.close();
  recorder.record(changeOf(transactions, source, at));
  if (standalone) recorder.close();
  return source;
}
