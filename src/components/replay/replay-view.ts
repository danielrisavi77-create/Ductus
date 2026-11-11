/**
 * The words and the small decisions of the replay view (DAN-537, rb 261),
 * kept apart from React so they are tested on their own. Nothing here knows
 * who looks at the replay, and nothing here speaks about time: a change is
 * only "change n of N" (D-143, D-239).
 */

import type { DocumentNode } from "@/domain/document";
import type { ParagraphHistoryEntry, ReplayGap } from "@/domain/projection/replay-player";
import type { ReplayChangeKind } from "@/domain/projection/replay-timeline";
import type { EvidenceSourceV2 } from "@/domain/forensics/evidence-segment-v2";
import { tiptapToCanonical } from "@/editor/interop";
import { pluralHr } from "@/lib/i18n/hr";
import { groupHr } from "@/lib/i18n/length-line";
import { messagesHr } from "@/lib/i18n/messages.hr";

const t = messagesHr.replay;

/** `{name}` placeholders filled in; numbers are grouped as everywhere else in the UI. */
export function fill(text: string, values: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : typeof value === "number" ? groupHr(value) : value;
  });
}

/** The blocks of the replayed document, or null when the editor's JSON is no canonical document. */
export function replayBlocks(json: unknown): DocumentNode[] | null {
  const result = tiptapToCanonical(json);
  return result.ok ? result.doc.nodes : null;
}

export const nodeText = (node: DocumentNode): string => node.children.map((child) => child.text).join("");

/** Characters as a reader counts them: code points, so one emoji is one. */
export const characters = (text: string): number => Array.from(text).length;

export const sourceLabel = (source: EvidenceSourceV2): string => t.sources[source];

function counted(n: number, forms: { one: string; few: string; many: string }): string {
  return fill(pluralHr(n, forms.one, forms.few, forms.many), { count: n });
}

/** What one change did to one paragraph; `ordinal` is the paragraph's place, from 1. */
export type ChangePart = { ordinal: number; removed: string; inserted: string };

/** The line read out for change `index`: "Promjena 12: umetnut 1 znak u odlomku 2." */
export function describeChange(index: number, kind: ReplayChangeKind, parts: readonly ChangePart[]): string {
  if (parts.length === 0) return fill(t.changeBare, { n: index });
  const said = parts.map(({ ordinal, removed, inserted }) => {
    const out = characters(removed);
    const into = characters(inserted);
    if (out === 0 && into === 0) return fill(kind === "format" ? t.format : t.structure, { k: ordinal });
    const what = out > 0 && into > 0
      ? fill(t.and, { a: counted(out, t.removed), b: counted(into, t.inserted) })
      : out > 0 ? counted(out, t.removed) : counted(into, t.inserted);
    return fill(t.inBlock, { what, k: ordinal });
  });
  return fill(t.change, { n: index, parts: said.join("; ") });
}

/** A gap as the view says it, and the change a "go to" button takes the reader to (null: none). */
export type GapWords = { text: string; note: string | null; target: number | null };

export function gapWords(gap: ReplayGap, beforeIndex: number): GapWords {
  const before = beforeIndex - 1;
  if (gap === "starts_later") return { text: t.gapStartsLater, note: null, target: beforeIndex };
  if (gap === "resumed") {
    const text = before > 0 ? fill(t.gapBetween, { a: before, b: beforeIndex }) : fill(t.gapBefore, { b: beforeIndex });
    return { text, note: t.gapResumed, target: beforeIndex };
  }
  return {
    text: before > 0 ? fill(t.gapStopped, { a: before }) : t.gapStoppedStart,
    note: t.gapStoppedNote,
    target: before > 0 ? before : null,
  };
}

/** The changes a reader steps through: every position for the whole work, else those that touched the paragraph. */
export function stepsOf(total: number, history: readonly ParagraphHistoryEntry[] | null): number[] {
  if (history === null) return Array.from({ length: total + 1 }, (_, i) => i);
  return history.flatMap((entry) => (entry.entry === "change" ? [entry.index] : []));
}

/** Where `at` stands among `steps`: the last step not after it, else the first. */
export function nearestStep(steps: readonly number[], at: number): number {
  let place = 0;
  steps.forEach((step, i) => {
    if (step <= at) place = i;
  });
  return place;
}

export type HistoryRow =
  | { row: "version"; label: string; text: string; replacedBy: string; source: string }
  | { row: "gap"; text: string };

/**
 * The rows of a paragraph's history up to change `at`, newest first: the
 * current version, the one just before it and the first recorded one, with
 * every gap of the record up to `at` at its place, since the paragraph may
 * have changed inside it.
 */
export function historyRows(history: readonly ParagraphHistoryEntry[], at: number): HistoryRow[] {
  const shown = history.filter((entry) => (entry.entry === "change" ? entry.index : entry.beforeIndex) <= at);
  const changes = shown.flatMap((entry) => (entry.entry === "change" ? [entry] : []));
  if (changes.length === 0) return [];
  // Later entries win: the current version is never called the first, and with
  // two versions the older one is the first recorded, which it is.
  const labels = new Map<number, string>([
    [changes[changes.length - 2]?.index ?? -1, t.historyPrevious],
    [changes[0].index, t.historyFirst],
    [changes[changes.length - 1].index, t.historyCurrent],
  ]);
  const rows: HistoryRow[] = [];
  for (const entry of [...shown].reverse()) {
    if (entry.entry === "gap") {
      rows.push({ row: "gap", text: gapWords(entry.gap, entry.beforeIndex).text });
      continue;
    }
    const label = labels.get(entry.index);
    if (label === undefined) continue;
    const next = changes[changes.indexOf(entry) + 1];
    rows.push({
      row: "version",
      label: fill(label, { n: entry.index }),
      text: entry.after === null ? t.historyDeleted : `„${entry.after}”`,
      replacedBy: next === undefined ? t.historyNotYet : fill(t.historyBy, { n: next.index }),
      source: sourceLabel(entry.source),
    });
  }
  return rows;
}

/** A paragraph as the select names it: its place and the start of its text. */
export function paragraphOption(ordinal: number, node: DocumentNode): string {
  const text = nodeText(node).trim();
  const short = characters(text) > 60 ? `${Array.from(text).slice(0, 60).join("").trimEnd()}…` : text;
  return fill(t.paragraphOption, { k: ordinal, text: short });
}
