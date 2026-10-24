/**
 * How evidence capture writes one editor step in `ductus-edit-steps-v1`
 * (F-8 step 3d-1b, DAN-282; contract #476 `issuecomment-6383232090`).
 *
 * Pure: the step's own ProseMirror JSON and the document the server's
 * replayer will hold before it (`doc`) go in, the steps to write come out.
 * Block ids are left to the caller, which gives every block still without
 * one the id the identity plugin decided, by an `attr` step at the end of the
 * change. The caller applies every written step and refuses the change when
 * the document it ends with is not the editor's, so a rewrite here can only
 * turn a change that would be refused into one that replays, never change
 * what the document holds.
 *
 * Each rewrite below is for a change the plain form cannot write, because
 * the identity plugin leaves the id with the text while ProseMirror leaves it
 * with the block in front (the rules of replay #391 named in brackets):
 *   - Enter at the start of a block with text: written as a new empty block
 *     in front of it (`attr_identity`);
 *   - a selection from the start of a block into a later one, replaced or
 *     removed: written as the removal of the selection, end first, then the
 *     new text (`attr_identity`). The same covers Backspace into an empty
 *     block in front of one with text (Undo of the first rewrite): the
 *     empty block is removed;
 *   - blocks put in at the start of a block (Undo of the second): written
 *     as the new blocks in front of it and the text of the last at its
 *     start (`attr_identity`);
 *   - a selection of whole blocks from the start of the document, replaced
 *     (Ctrl+A, then Backspace, typing or pasting): written as the new blocks
 *     in front, then the removal of the old ones (not canonical otherwise).
 * Every other step keeps its form and only gets the ids the format asks for:
 * the id of the block it continues on an open side of a slice or around a
 * `replaceAround` (`open_start_block`, `open_end_block`,
 * `replace_around_identity`), and `null` on every new block.
 */

import type { Node as PmNode, ResolvedPos } from "@tiptap/pm/model";

type Json = Record<string, unknown>;
type BlockJson = { type: string; attrs: Record<string, unknown>; content?: unknown[] };
type SliceJson = { content: BlockJson[]; openStart?: number; openEnd?: number };

/** Thrown when a step cannot be written; the caller refuses the change. */
class UnwritableStep extends Error {}

const blockAt = ($pos: ResolvedPos): PmNode | null => ($pos.depth === 1 ? $pos.parent : null);

/** The block's markup as a slice writes it: type and attributes, no content. */
const markup = (block: PmNode, nodeId: unknown): BlockJson =>
  block.type.create({ ...block.attrs, nodeId }).toJSON() as BlockJson;

/** Same type and level; the id is not compared. */
const sameKind = (a: BlockJson, b: PmNode) => a.type === b.type.name && a.attrs.level === b.attrs.level;

/** Blocks without text, open on both sides: a slice that only divides a block. */
const isSplit = (slice: SliceJson) =>
  slice.openStart === 1 && slice.openEnd === 1 && slice.content.every((item) => !("content" in item));

const isBlockSlice = (slice: SliceJson | undefined): slice is SliceJson =>
  slice !== undefined && slice.content[0]?.type !== "text";

/** The steps that write `json`, a step the editor applied to the document `doc` holds. */
export function writtenSteps(doc: PmNode, json: Json): Json[] {
  if (json.stepType === "replaceAround") return [aroundWithId(doc, json)];
  if (json.stepType !== "replace") return [json];
  const from = json.from as number;
  const to = json.to as number;
  const slice = json.slice as SliceJson | undefined;
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  return (
    enterAtStart($from, to, slice) ??
    wholeBlocksFromStart(doc, from, $to, slice) ??
    fromBlockStart($from, $to, slice) ??
    blocksAtBlockStart($from, $to, slice) ?? [withSliceIds(json, $from, $to, slice)]
  );
}

/** `replaceAround` keeps the block it wraps, id included: the wrapper carries that id. */
function aroundWithId(doc: PmNode, json: Json): Json {
  const block = doc.nodeAt(json.from as number);
  const slice = json.slice as SliceJson;
  const wrapper = slice.content[0]!;
  if (!block) throw new UnwritableStep();
  return { ...json, slice: { ...slice, content: [{ ...wrapper, attrs: { ...wrapper.attrs, nodeId: block.attrs.nodeId } }] } };
}

/**
 * Enter at the start of a block with text: ProseMirror leaves the empty part
 * in front with the block's markup and the identity plugin names it, while
 * the text keeps its id. Written as a new empty block of the same kind in
 * front: at the start of the document a closed block, elsewhere a split at
 * the end of the block before (the format writes no closed block after one).
 */
function enterAtStart($from: ResolvedPos, to: number, slice: SliceJson | undefined): Json[] | null {
  const block = blockAt($from);
  if (
    !block || to !== $from.pos || $from.parentOffset !== 0 || block.content.size === 0 ||
    !isBlockSlice(slice) || slice.content.length !== 2 || !isSplit(slice) || !sameKind(slice.content[1]!, block)
  ) {
    return null;
  }
  return [insertBefore($from, [markup(block, null)])];
}

/**
 * New blocks, none with an id, in front of the block `$at` lies in: at the
 * start of the document closed blocks, elsewhere a split at the end of the
 * block before whose open end is the last new block (the format writes no
 * closed block after a block).
 */
function insertBefore($at: ResolvedPos, blocks: BlockJson[]): Json {
  const at = $at.before();
  if (at === 0) return { stepType: "replace", from: 0, to: 0, slice: { content: blocks } };
  const before = $at.doc.resolve(at).nodeBefore!;
  const slice: SliceJson = { content: [markup(before, before.attrs.nodeId), ...blocks], openStart: 1, openEnd: 1 };
  return { stepType: "replace", from: at - 1, to: at - 1, slice, ...(isSplit(slice) ? { structure: true } : {}) };
}

/**
 * Blocks put in at the start of a block, open on both sides (Undo of a
 * selection from the start of a block replaced or removed, a paste of
 * several blocks there): ProseMirror leaves the block's markup on the first
 * new block and the last block of the slice on the block's own text, which
 * keeps its id. Written as the new blocks in front of the block, after the
 * removal of what the range held, and the text of the last one at its
 * start. A block left without text is removed after the new blocks, all of
 * which are new.
 */
function blocksAtBlockStart($from: ResolvedPos, $to: ResolvedPos, slice: SliceJson | undefined): Json[] | null {
  const block = blockAt($from);
  if (
    !block || $from.parentOffset !== 0 || !blockAt($to) || $to.before() !== $from.before() ||
    !isBlockSlice(slice) || slice.openStart !== 1 || slice.openEnd !== 1 || slice.content.length < 2 || isSplit(slice)
  ) {
    return null;
  }
  const items = slice.content.map((item) => ({ ...item, attrs: { ...item.attrs, nodeId: null } }));
  items[0] = { ...items[0]!, type: block.type.name, attrs: { ...block.attrs, nodeId: null } };
  const sizeOf = (list: BlockJson[]) => list.reduce((sum, item) => sum + block.type.schema.nodeFromJSON(item).nodeSize, 0);
  if ($to.parentOffset === block.content.size) {
    const at = $from.before() + sizeOf(items);
    return [insertBefore($from, items), { stepType: "replace", from: at, to: at + block.nodeSize }];
  }
  const last = items.pop()!;
  if (!sameKind(last, block)) return null;
  const steps: Json[] = $to.pos > $from.pos ? [{ stepType: "replace", from: $from.pos, to: $to.pos }] : [];
  steps.push(insertBefore($from, items));
  const start = $from.pos + sizeOf(items);
  if (last.content) steps.push({ stepType: "replace", from: start, to: start, slice: { content: last.content } });
  return steps;
}

/**
 * Whole blocks from the start of the document replaced by closed blocks (a
 * selection of everything, then Backspace, typing or pasting): the new blocks
 * go in front, then the old ones are removed. None of them keeps an id.
 */
function wholeBlocksFromStart(doc: PmNode, from: number, $to: ResolvedPos, slice: SliceJson | undefined): Json[] | null {
  if (from !== 0 || $to.depth !== 0 || $to.pos === 0 || !isBlockSlice(slice) || slice.openStart || slice.openEnd) {
    return null;
  }
  const blocks = slice.content.map((item) => ({ ...item, attrs: { ...item.attrs, nodeId: null } }));
  const size = blocks.reduce((sum, item) => sum + doc.type.schema.nodeFromJSON(item).nodeSize, 0);
  return [
    { stepType: "replace", from: 0, to: 0, slice: { content: blocks } },
    { stepType: "replace", from: size, to: size + $to.pos },
  ];
}

/**
 * A selection from the start of one block into the text of a later one,
 * replaced by text or removed: ProseMirror keeps the first block, the
 * identity plugin gives it the id of the last one, whose text is the only
 * old text left. Written as what happened to the text: the selected start of
 * the last block removed, then the whole blocks in front of it, then the new
 * text at its start. The last block keeps its id.
 */
function fromBlockStart($from: ResolvedPos, $to: ResolvedPos, slice: SliceJson | undefined): Json[] | null {
  const last = blockAt($to);
  if (
    !blockAt($from) || $from.parentOffset !== 0 || !last || $to.before() <= $from.before() ||
    $to.parentOffset >= last.content.size || isBlockSlice(slice)
  ) {
    return null;
  }
  const start = $from.before();
  const steps: Json[] = [];
  if ($to.parentOffset > 0) steps.push({ stepType: "replace", from: $to.start(), to: $to.pos });
  steps.push({ stepType: "replace", from: start, to: $to.before() });
  if (slice) steps.push({ stepType: "replace", from: start + 1, to: start + 1, slice });
  return steps;
}

/**
 * The step as it is, with the ids the format asks for in its slice: an open
 * start continues the block it starts in (markup and id: ProseMirror keeps
 * that block's own); an open end continues the block it ends in, or is a new
 * block (`null`) when both ends lie in one block; every other block is new.
 * At one position `structure` stands exactly on a split.
 */
function withSliceIds(json: Json, $from: ResolvedPos, $to: ResolvedPos, slice: SliceJson | undefined): Json {
  const written: Json = { ...json };
  if (!isBlockSlice(slice)) return written;
  const last = slice.content.length - 1;
  const content = slice.content.map((item, i): BlockJson => {
    if (i === 0 && slice.openStart === 1) {
      const block = blockAt($from);
      if (!block) throw new UnwritableStep();
      return { ...item, type: block.type.name, attrs: { ...block.attrs } };
    }
    if (i === last && slice.openEnd === 1) {
      const block = blockAt($to);
      if (block && blockAt($from) && $from.before() === $to.before()) return { ...item, attrs: { ...item.attrs, nodeId: null } };
      if (!block || !sameKind(item, block)) throw new UnwritableStep();
      return { ...item, attrs: { ...item.attrs, nodeId: block.attrs.nodeId } };
    }
    return { ...item, attrs: { ...item.attrs, nodeId: null } };
  });
  written.slice = { ...slice, content };
  if (json.from === json.to) {
    delete written.structure;
    if (isSplit(slice)) written.structure = true;
  }
  return written;
}
