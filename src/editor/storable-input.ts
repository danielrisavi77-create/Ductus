/**
 * The editor never holds text the journal would store differently
 * (#206 Codex r4240240763, closed in #214).
 *
 * The saver journals `storableDocument(doc)`: a lone surrogate becomes U+FFFD
 * and U+0000 is dropped (`storable-text.ts`). Text holding either, from paste,
 * drop or any other input, is made storable in the editor itself, in the same
 * update, so "Spremljeno na uređaju" always describes exactly what is shown
 * and a reload gives the same text back.
 *
 * Only the text blocks a change touched are read, whole: a delete or split
 * at the edge of a run, or a mark added over half a pair, leaves the other
 * half just outside the step's own range (#251 review 6109174031). Typing in
 * a long document still costs nothing beyond the edited block. Node ids are
 * left to the identity plugin: replacing text inside a block keeps the block
 * and its id.
 *
 * Only the offending code units are replaced, never the whole run: the caret
 * and every position outside them map through unchanged, so typing goes on
 * where it was.
 *
 * More than `MAX_REPAIR_STEPS` offending runs, as a paste can bring, are
 * repaired with one `RepairRuns` step (F-067): each step rebuilds the blocks
 * above it and the transaction keeps every intermediate document, so one step
 * per run grows as runs times document size. Its position map lists only the
 * runs, like the steps it stands for, so the identity plugin sees the same
 * change either way and every block keeps its id (F-071).
 */

import { Extension } from "@tiptap/core";
import { Fragment, type Mark, type Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, RemoveMarkStep, Step, StepMap, StepResult, type Mappable } from "@tiptap/pm/transform";

import { storableText } from "./storable-text";

const storableInputKey = new PluginKey("storableInput");

// A run of code units `storableText` would change. With the `u` flag a valid
// pair is one code point outside the class, so it never joins a run, and the
// run's own repair equals the repair of the whole text at that place.
const UNSTORABLE_RUN = /[\uD800-\uDFFF\u0000]+/gu;

// Up to this many runs are repaired one step each; above it they get a single
// step (F-067).
const MAX_REPAIR_STEPS = 8;

type Run = { from: number; to: number; text: string; node: PmNode };

/** The runs of one text block `storableText` would change, in order. */
function runsOf(block: PmNode, start: number): Run[] {
  const runs: Run[] = [];
  block.forEach((node, offset) => {
    if (!node.isText) return;
    for (const run of node.text!.matchAll(UNSTORABLE_RUN)) {
      const from = start + offset + run.index;
      runs.push({ from, to: from + run[0].length, text: storableText(run[0]), node });
    }
  });
  return runs;
}

/**
 * Text a step puts in place of `from`..`to`, with `marks`. The range holds
 * only text, inside one text block; an empty range inserts.
 */
type Repair = { from: number; to: number; text: string; marks: readonly Mark[] };

type IdentityMapResult = { pos: number; deleted: boolean; deletedAfter: boolean };

/**
 * `StepMap` preserves the exact position semantics but scans every earlier
 * range for each query. Identity traces old blocks in document order, so let
 * that caller advance through repair ranges once instead.
 */
class RepairRunsMap extends StepMap {
  private readonly identityRanges: readonly number[];
  private identityRange = 0;
  private identityDiff = 0;
  private identityLastPos = -1;

  constructor(ranges: readonly number[]) {
    super(ranges);
    this.identityRanges = ranges;
  }

  /** Map ascending positions for the identity trace; falls back safely on a rewind. */
  mapIdentityPosition(pos: number, assoc: number): IdentityMapResult {
    if (pos < this.identityLastPos) {
      this.identityRange = 0;
      this.identityDiff = 0;
    }
    this.identityLastPos = pos;

    while (this.identityRange < this.identityRanges.length) {
      const index = this.identityRange;
      const start = this.identityRanges[index]!;
      if (start > pos) break;
      const oldSize = this.identityRanges[index + 1]!;
      const newSize = this.identityRanges[index + 2]!;
      const end = start + oldSize;
      if (pos <= end) {
        const side = !oldSize ? assoc : pos === start ? -1 : pos === end ? 1 : assoc;
        return {
          pos: start + this.identityDiff + (side < 0 ? 0 : newSize),
          deleted: oldSize > 0 && (assoc < 0 ? pos !== start : pos !== end),
          deletedAfter: oldSize > 0 && pos < end,
        };
      }
      this.identityDiff += newSize - oldSize;
      this.identityRange += 3;
    }
    return { pos: pos + this.identityDiff, deleted: false, deletedAfter: false };
  }
}

/**
 * Replaces many text ranges in one pass over the document, rebuilding each
 * touched block once. Its map lists only those ranges, exactly as one replace
 * step per range would, so every other position, block and id maps through
 * unchanged. Like `SetNodeIds` in `identity.ts` it has no JSON form.
 */
export class RepairRuns extends Step {
  /** `repairs` in document order, not overlapping. */
  constructor(readonly repairs: readonly Repair[]) {
    super();
  }

  apply(doc: PmNode): StepResult {
    const byBlock = new Map<number, Repair[]>();
    for (const repair of this.repairs) {
      if (repair.to < repair.from || repair.from < 0 || repair.to > doc.content.size) return StepResult.fail("Repair out of range");
      const $from = doc.resolve(repair.from);
      if (!$from.parent.isTextblock || repair.to > $from.end()) return StepResult.fail("Repair outside one text block");
      const start = $from.start() - 1;
      const repairs = byBlock.get(start);
      if (repairs) repairs.push(repair);
      else byBlock.set(start, [repair]);
    }
    let failed = false;
    const rewrite = (fragment: Fragment, start: number): Fragment => {
      const nodes: PmNode[] = [];
      let changed = false;
      let pos = start;
      fragment.forEach((node) => {
        let out = node;
        const repairs = byBlock.get(pos);
        if (repairs) {
          const content = repairBlock(node, pos + 1, repairs);
          if (content === null) failed = true;
          else out = node.copy(content);
        } else if (!node.isTextblock && !node.isLeaf) {
          out = node.copy(rewrite(node.content, pos + 1));
        }
        changed ||= out !== node;
        nodes.push(out);
        pos += node.nodeSize;
      });
      return changed ? Fragment.fromArray(nodes) : fragment;
    };
    const content = rewrite(doc.content, 0);
    return failed ? StepResult.fail("Repair over something other than text") : StepResult.ok(doc.copy(content));
  }

  getMap(): StepMap {
    const ranges = this.repairs.flatMap(({ from, to, text }) => [from, to - from, text.length]);
    return new RepairRunsMap(ranges);
  }

  invert(doc: PmNode): Step {
    let shift = 0;
    return new RepairRuns(
      this.repairs.map(({ from, to, text, marks }) => {
        const start = from + shift;
        shift += text.length - (to - from);
        return { from: start, to: start + text.length, text: doc.textBetween(from, to), marks };
      }),
    );
  }

  map(mapping: Mappable): Step | null {
    const repairs = this.repairs.flatMap((repair) => {
      const from = mapping.mapResult(repair.from, 1);
      const to = mapping.mapResult(repair.to, -1);
      return from.deletedAcross || to.deletedAcross || to.pos < from.pos ? [] : [{ ...repair, from: from.pos, to: to.pos }];
    });
    return repairs.length === 0 ? null : new RepairRuns(repairs);
  }

  toJSON(): never {
    throw new Error("RepairRuns cannot be serialised: it is derived from the document by the storable input plugin");
  }
}

/** The content of `block` (content starting at `start`) with `repairs` applied, or null when one covers a non-text node. */
function repairBlock(block: PmNode, start: number, repairs: readonly Repair[]): Fragment | null {
  const nodes: PmNode[] = [];
  const schema = block.type.schema;
  const insert = (repair: Repair) => {
    if (repair.text !== "") nodes.push(schema.text(repair.text, repair.marks));
  };
  let next = 0;
  let pos = start;
  let ok = true;
  block.forEach((node) => {
    const end = pos + node.nodeSize;
    if (!node.isText) {
      while (next < repairs.length && repairs[next]!.from === pos && repairs[next]!.to === pos) insert(repairs[next++]!);
      if (next < repairs.length && repairs[next]!.from < end) ok = false;
      nodes.push(node);
    } else {
      let cursor = pos;
      while (next < repairs.length && repairs[next]!.from < end) {
        const repair = repairs[next++]!;
        if (repair.from < cursor || repair.to > end) ok = false;
        if (repair.from > cursor) nodes.push(node.cut(cursor - pos, repair.from - pos));
        insert(repair);
        cursor = Math.max(cursor, repair.to);
      }
      if (cursor < end) nodes.push(node.cut(cursor - pos));
    }
    pos = end;
  });
  while (next < repairs.length && repairs[next]!.from === pos && repairs[next]!.to === pos) insert(repairs[next++]!);
  return ok && next === repairs.length ? Fragment.fromArray(nodes) : null;
}

/**
 * Ranges of `doc` (the state after `transactions`) that they changed, each
 * widened to the whole text blocks at its ends. Mark steps map no positions,
 * so their own from/to is taken.
 */
function changedRanges(transactions: readonly Transaction[], doc: PmNode): [number, number][] {
  let ranges: [number, number][] = [];
  for (const tr of transactions) {
    ranges = ranges.map(([from, to]) => [tr.mapping.map(from, -1), tr.mapping.map(to, 1)]);
    tr.steps.forEach((step, index) => {
      const after = tr.mapping.slice(index + 1);
      const add = (from: number, to: number) => ranges.push([after.map(from, -1), after.map(to, 1)]);
      tr.mapping.maps[index]!.forEach((_oldFrom, _oldTo, from, to) => add(from, to));
      if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) add(step.from, step.to);
    });
  }
  const size = doc.content.size;
  const clamp = (pos: number) => Math.max(0, Math.min(pos, size));
  return ranges.map(([from, to]) => {
    const $from = doc.resolve(clamp(from));
    const $to = doc.resolve(clamp(Math.max(from, to)));
    return [
      $from.parent.isTextblock ? $from.start() : $from.pos,
      $to.parent.isTextblock ? $to.end() : $to.pos,
    ];
  });
}

export function createStorableInputPlugin(): Plugin {
  return new Plugin({
    key: storableInputKey,
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const blocks = new Map<number, Run[]>();
      for (const [from, to] of changedRanges(transactions, newState.doc)) {
        newState.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isTextblock) return true;
          if (!blocks.has(pos)) blocks.set(pos, runsOf(node, pos + 1));
          return false;
        });
      }
      const runs = [...blocks.values()].flat().sort((a, b) => a.from - b.from);
      if (runs.length === 0) return null;
      const tr = newState.tr;
      if (runs.length > MAX_REPAIR_STEPS) {
        return tr.step(new RepairRuns(runs.map(({ from, to, text, node }) => ({ from, to, text, marks: node.marks }))));
      }
      // From the end, so earlier positions stay valid.
      for (const { from, to, text, node } of runs.reverse()) {
        if (text === "") tr.delete(from, to);
        else tr.replaceWith(from, to, newState.schema.text(text, node.marks));
      }
      return tr;
    },
  });
}

export const StorableInput = Extension.create({
  name: "storableInput",

  addProseMirrorPlugins() {
    return [createStorableInputPlugin()];
  },
});
