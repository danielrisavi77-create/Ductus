/**
 * Find and replace in the editor, the domain and editor part (DAN-507,
 * M5.10-P02; contract #1091 c.6587093852). No interface here: D-235 has no
 * approved image for it yet.
 *
 * - `searchDocument` finds literal matches inside each text block, never
 *   across two blocks; a match may cross a mark boundary. It binds the result
 *   to the document it searched.
 * - Istodobnost: a result applies only to that same document object. Any
 *   change after the search (typing, a paste, an undo that restores the same
 *   text) gives a new document, and the result is refused as `stale`; a
 *   change of the selection alone keeps the document and the result.
 * - "Replace all" is one transaction in one pass over the matches found
 *   before it, last to first, so a replacement that makes a new match is never
 *   searched again. It carries `FIND_REPLACE_META`: `recordWithSource` records
 *   it as an event of its own, one undo step takes it back, and it goes
 *   through the same capture as every other change. History is closed before
 *   it (`closeHistory` on the transaction) and after it (`FindReplaceHistory`
 *   appends an empty closing transaction), so neither the typing before nor
 *   the typing right after it joins its undo step.
 * - Nothing is logged, sent or stored: the query and the text stay here.
 */

import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";

import { findLiteral, isSearchableText, type LiteralQuery } from "@/domain/text/find-literal";

import { FIND_REPLACE_META } from "./source";

/**
 * Most matches one search keeps and "replace all" changes. With a replacement
 * of at most 200 units it keeps one event well under the 2 MiB segment limit
 * (D-96), so it can never stop the recorder with `too_large`.
 */
export const MAX_REPLACE_ALL = 1_000;

export type SearchMatch = Readonly<{ from: number; to: number; blockId: string | null }>;

export type SearchResult = Readonly<{
  /** The document searched; the result applies to it alone. */
  doc: ProseMirrorNode;
  query: LiteralQuery;
  /** At most `MAX_REPLACE_ALL`, in document order. */
  matches: readonly SearchMatch[];
  /** More matches than `MAX_REPLACE_ALL` exist. */
  overLimit: boolean;
}>;

export type ReplaceRefusal = "stale" | "no_match" | "unchanged" | "invalid_replacement" | "too_many";

export type ReplaceOutcome =
  | Readonly<{ ok: true; tr: Transaction; count: number }>
  | Readonly<{ ok: false; reason: ReplaceRefusal }>;

/** A stand-in for each inline node that is not text, so offsets stay positions. */
const LEAF = "￼";

/** Matches in `doc`, or null for a query that cannot be typed or stored. */
export function searchDocument(doc: ProseMirrorNode, query: LiteralQuery): SearchResult | null {
  if (!isSearchableText(query.text)) return null;
  const matches: SearchMatch[] = [];
  let overLimit = false;
  if (query.text !== "") {
    doc.descendants((node, pos) => {
      if (overLimit) return false;
      if (!node.isTextblock) return true;
      let text = "";
      const leaves: number[] = [];
      node.forEach((child) => {
        if (child.isText) text += child.text!;
        else {
          leaves.push(text.length);
          text += LEAF.repeat(child.nodeSize);
        }
      });
      const blockId = typeof node.attrs.nodeId === "string" ? node.attrs.nodeId : null;
      for (const { from, to } of findLiteral(text, query)) {
        if (leaves.some((leaf) => leaf >= from && leaf < to)) continue;
        if (matches.length === MAX_REPLACE_ALL) {
          overLimit = true;
          break;
        }
        matches.push({ from: pos + 1 + from, to: pos + 1 + to, blockId });
      }
      return false;
    });
  }
  return { doc, query, matches, overLimit };
}

function replaceMatches(state: EditorState, matches: readonly SearchMatch[], replacement: string): ReplaceOutcome {
  const { doc, schema } = state;
  const tr = state.tr;
  let count = 0;
  for (const { from, to } of [...matches].reverse()) {
    if (doc.textBetween(from, to) === replacement) continue;
    if (replacement === "") tr.delete(from, to);
    else tr.replaceWith(from, to, schema.text(replacement, doc.nodeAt(from)?.marks));
    count += 1;
  }
  if (!tr.docChanged) return { ok: false, reason: "unchanged" };
  // Never one undo step with the typing before it.
  closeHistory(tr);
  tr.setMeta(FIND_REPLACE_META, true);
  return { ok: true, tr, count };
}

function refusal(state: EditorState, result: SearchResult, replacement: string): ReplaceRefusal | null {
  if (state.doc !== result.doc) return "stale";
  if (!isSearchableText(replacement)) return "invalid_replacement";
  if (result.matches.length === 0) return "no_match";
  return null;
}

/** One transaction that replaces every match of `result`; refused over `MAX_REPLACE_ALL`. */
export function replaceAllTransaction(state: EditorState, result: SearchResult, replacement: string): ReplaceOutcome {
  const reason = refusal(state, result, replacement) ?? (result.overLimit ? "too_many" : null);
  if (reason !== null) return { ok: false, reason };
  return replaceMatches(state, result.matches, replacement);
}

/** One transaction that replaces the match at `index` of `result`. */
export function replaceMatchTransaction(
  state: EditorState,
  result: SearchResult,
  index: number,
  replacement: string,
): ReplaceOutcome {
  const reason = refusal(state, result, replacement);
  if (reason !== null) return { ok: false, reason };
  const match = result.matches[index];
  if (match === undefined) return { ok: false, reason: "no_match" };
  return replaceMatches(state, [match], replacement);
}

/**
 * Closes the history group right after a find and replace. `closeHistory` on
 * the transaction only ends the group before it; without this, typing next to
 * a match within the history's group delay would join the replacement's undo
 * step (Codex c.4447413741). The appended transaction has no steps, so it
 * changes neither the document nor the evidence.
 */
export const FindReplaceHistory = Extension.create({
  name: "findReplaceHistory",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("findReplaceHistory"),
        appendTransaction(transactions, _oldState, newState) {
          const replaced = transactions.some((tr) => tr.docChanged && tr.getMeta(FIND_REPLACE_META) === true);
          return replaced ? closeHistory(newState.tr) : null;
        },
      }),
    ];
  },
});
