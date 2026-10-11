/**
 * Block identity inside the editor state.
 *
 * A block's `nodeId` is what comments, revision requests and evidence point
 * at, so the question "which block is this" cannot be answered by reading an
 * attribute that arrived with the content. It is answered here, from the
 * steps of the transaction itself:
 *
 *   1. A block that was in the document before the transaction and is still
 *      there after it keeps its id, whatever the transaction wrote into the
 *      attribute. "Still there" follows the text: the id stays with the
 *      block's own text, not with whatever was put in front of it (`trace`).
 *   2. Every other block is new and gets a freshly minted id, whatever id it
 *      carried in. Two narrow exceptions hand an existing id to a new block,
 *      and both demand the *same block*, not just the same attribute:
 *        - move: the transaction removed exactly one such block, leaving none
 *          of its text behind, and inserted exactly one block with identical
 *          type, attributes and content;
 *        - restore (undo, redo): the block carries the id of a block this
 *          state saw removed, and is identical to it as it was then.
 *   3. Content coming through the clipboard or a drop has its ids removed
 *      before it is inserted, so a cut-and-paste is a new block and only a
 *      move inside one transaction (a drag inside the editor) keeps the id.
 *
 * None of this reads transaction meta: several input paths set none, and a
 * page script can set any. Nothing here refuses input either; the text always
 * lands, only the id is decided.
 *
 * Stored documents enter through `replaceWithStoredDocument` (or as the
 * initial content of the state) and are taken as they are: an id that is
 * malformed in stored content is still reported by `tiptapToCanonical`, not
 * repaired, and ids are never re-minted on load. `replaceWithStoredDocument`
 * refuses a document that holds an id twice. Initial content is checked by
 * nobody, so there the one thing repaired is a repeated id: the earlier block
 * keeps it and the later one is given a new id once, in the state, instead of
 * a different one at every conversion.
 *
 * What a plugin cannot do: it sees transactions, so code that replaces the
 * whole editor state, or edits while the editor is unmounted (Tiptap attaches
 * plugins on mount), is outside it. The browser is not the trust boundary for
 * identity; whoever accepts a document must not rely on this alone.
 */

import { Fragment, Slice, type Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Mapping, Step, StepResult, type Mappable } from "@tiptap/pm/transform";

import {
  isNodeId,
  newNodeId,
  validateDocument,
  type CanonicalDocument,
  type NodeId,
  type ValidationError,
} from "../domain/document";

import { canonicalToTiptap, NODE_ID_ATTRIBUTE } from "./interop";

/** Mints the id of a new block. Injectable so tests stay deterministic. */
export type NodeIdMinter = () => NodeId;

/**
 * Removed blocks remembered for restore: id → the block as it was, and the
 * number of the removing transaction. The nodes are the ones the undo history
 * already holds, so remembering them copies no text.
 */
type Removed = { transactions: number; blocks: ReadonlyMap<string, { node: PmNode; at: number }> };

const NOTHING_REMOVED: Removed = { transactions: 0, blocks: new Map() };

type Block = { pos: number; node: PmNode };
type Fix = { pos: number; id: unknown };
/**
 * `removed` are the old blocks that are no longer blocks of their own; `gone`
 * are those of them with no content left anywhere (the rest were joined into
 * another block and their text lives on there).
 */
type Trace = { next: Block[]; kept: Map<number, unknown>; removed: Block[]; gone: Block[] };

/**
 * The trace of a single applied transaction, computed once for both plugin
 * hooks. Only asked for transactions the state has applied, which no longer
 * change.
 */
const traces = new WeakMap<Transaction, Trace>();

function traceOf(tr: Transaction): Trace {
  let result = traces.get(tr);
  if (!result) {
    result = trace(tr.before, tr.doc, tr.mapping);
    traces.set(tr, result);
  }
  return result;
}

/**
 * For how many removing transactions a removed block is remembered. Well past
 * what the undo history can reach; a block removed longer ago comes back as a
 * new block.
 */
export const REMOVAL_MEMORY = 1000;

const identityKey = new PluginKey<Removed>("nodeIdentity");

/**
 * Transactions built by `replaceWithStoredDocument`. Held by object identity,
 * so no meta key or value written by other code can mark a load.
 */
const storedLoads = new WeakSet<Transaction>();

function carriesId(node: PmNode): boolean {
  return NODE_ID_ATTRIBUTE in node.attrs;
}

function idOf(node: PmNode): unknown {
  return node.attrs[NODE_ID_ATTRIBUTE];
}

function blocksOf(doc: PmNode): Block[] {
  const found: Block[] = [];
  doc.descendants((node, pos) => {
    if (carriesId(node)) {
      found.push({ pos, node });
    }
    return !node.isTextblock;
  });
  return found;
}

/** Type, attributes and content of a block, with the id left out. */
function signature(node: PmNode): string {
  return JSON.stringify([
    node.type.name,
    { ...node.attrs, [NODE_ID_ATTRIBUTE]: null },
    node.content.toJSON(),
  ]);
}

/**
 * Where the text of an old block is now: the new position of its first
 * content token that the transaction did not delete, or null when the block
 * was empty or all of its content was deleted.
 */
function survivingContent(old: Block, mapping: Mapping): number | null {
  const start = old.pos + 1;
  const end = start + old.node.content.size;
  for (let pos = start; pos < end; pos += 1) {
    const mapped = mapping.mapResult(pos, 1);
    if (!mapped.deletedAfter) {
      return mapped.pos;
    }
  }
  return null;
}

/** The block whose content holds `pos`. `blocks` is in document order. */
function holderOf(blocks: readonly Block[], pos: number): Block | undefined {
  let low = 0;
  let high = blocks.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (blocks[middle].pos < pos) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  const block = blocks[low];
  return block && block.pos < pos && pos < block.pos + block.node.nodeSize ? block : undefined;
}

/**
 * Splits the old blocks into those still present (with the position they now
 * have) and those removed.
 *
 * Identity follows the text. An old block lives on in the new block that
 * holds its first surviving piece of content; when two old blocks end up in
 * one new block (a join), the one whose content comes first lives on. So text
 * pasted or typed in front of the text of a block never takes the id away
 * from that text, wherever the block boundaries fall afterwards.
 *
 * Only a block with no surviving content (empty, or fully rewritten) is traced
 * by its wrapper: its opening position, or the start of its content when a
 * step replaced the wrapper alone (a type or attribute change). Nothing of
 * such a block exists anywhere else, so nothing can be passed off as it.
 *
 * Content is settled for every block before any wrapper, and ties go to the
 * earlier text, so the outcome does not depend on the order of evaluation.
 */
function trace(oldDoc: PmNode, newDoc: PmNode, mapping: Mapping): Trace {
  const next = blocksOf(newDoc);
  const byPos = new Map(next.map((block) => [block.pos, block]));
  const claims = new Map<number, Block>();
  const empty: Block[] = [];
  const removed: Block[] = [];
  const gone: Block[] = [];

  for (const old of blocksOf(oldDoc)) {
    const at = survivingContent(old, mapping);
    const heir = at === null ? undefined : holderOf(next, at);
    if (at === null || !heir) {
      (at === null ? empty : removed).push(old);
      continue;
    }
    // Position maps keep order and the old blocks come in document order, so
    // a block that already claimed this heir is the one with the earlier text.
    if (claims.has(heir.pos)) {
      removed.push(old);
      continue;
    }
    claims.set(heir.pos, old);
  }
  for (const old of empty) {
    const opening = mapping.mapResult(old.pos, 1);
    const content = mapping.mapResult(old.pos + 1, 1);
    const pos = !opening.deletedAfter ? opening.pos : !content.deleted ? content.pos - 1 : -1;
    if (byPos.has(pos) && !claims.has(pos)) {
      claims.set(pos, old);
    } else {
      removed.push(old);
      gone.push(old);
    }
  }

  const kept = new Map<number, unknown>();
  for (const [pos, old] of claims) {
    kept.set(pos, idOf(old.node));
  }
  return { next, kept, removed, gone };
}

function groupBySignature(blocks: readonly Block[]): Map<string, Block[]> {
  const groups = new Map<string, Block[]>();
  for (const block of blocks) {
    const key = signature(block.node);
    const group = groups.get(key);
    if (group) {
      group.push(block);
    } else {
      groups.set(key, [block]);
    }
  }
  return groups;
}

/** The id every block of `newDoc` must carry, as a list of corrections. */
function plan({ next, kept, gone }: Trace, remembered: Removed, mint: NodeIdMinter): Fix[] {
  const want = new Map<number, unknown>();
  const taken = new Set<string>();
  const claim = (pos: number, id: unknown) => {
    want.set(pos, id);
    if (typeof id === "string") {
      taken.add(id.toLowerCase());
    }
  };
  const fresh = (): NodeId => {
    let id = mint();
    while (taken.has(id.toLowerCase())) {
      id = newNodeId();
    }
    return id;
  };

  // Blocks that never had an id (a document created empty) are settled last.
  // So is a block whose id an earlier block already holds: that can only come
  // from content the state was created with, which no validator has seen, and
  // leaving it would make every later conversion mint a different id for it.
  for (const { pos } of next) {
    const id = kept.get(pos);
    if (id !== null && id !== undefined && !(typeof id === "string" && taken.has(id.toLowerCase()))) {
      claim(pos, id);
    }
  }

  const arrivals = next.filter((block) => !kept.has(block.pos));
  const carriers = new Map<unknown, number>();
  for (const { node } of arrivals) {
    carriers.set(idOf(node), (carriers.get(idOf(node)) ?? 0) + 1);
  }

  // Move: one block whose content is gone from where it was, one identical arrival.
  if (gone.length > 0 && arrivals.length > 0) {
    const arrivalGroups = groupBySignature(arrivals);
    for (const [key, left] of groupBySignature(gone)) {
      const arrived = arrivalGroups.get(key);
      const id = idOf(left[0].node);
      if (left.length === 1 && arrived?.length === 1 && typeof id === "string" && !taken.has(id.toLowerCase())) {
        claim(arrived[0].pos, id);
      }
    }
  }

  // Restore: the arrival is a remembered removed block, unchanged.
  for (const block of arrivals) {
    const id = idOf(block.node);
    if (
      !want.has(block.pos) &&
      isNodeId(id) &&
      carriers.get(id) === 1 &&
      !taken.has(id.toLowerCase()) &&
      sameBlock(remembered.blocks.get(id)?.node, block.node)
    ) {
      claim(block.pos, id);
    }
  }

  for (const block of next) {
    if (!want.has(block.pos)) {
      claim(block.pos, fresh());
    }
  }

  return next
    .filter((block) => want.get(block.pos) !== idOf(block.node))
    .map((block) => ({ pos: block.pos, id: want.get(block.pos) }));
}

function remember(remembered: Removed, tr: Transaction): Removed {
  const { removed } = traceOf(tr);
  if (removed.length === 0) {
    return remembered;
  }
  const at = remembered.transactions + 1;
  const blocks = new Map(remembered.blocks);
  // Entries stay in the order they were removed, so the oldest come first.
  for (const [id, entry] of blocks) {
    if (entry.at > at - REMOVAL_MEMORY) {
      break;
    }
    blocks.delete(id);
  }
  for (const { node } of removed) {
    const id = idOf(node);
    if (isNodeId(id)) {
      blocks.delete(id);
      blocks.set(id, { node, at });
    }
  }
  return { transactions: at, blocks };
}

/** Same type, attributes and content; the id is not compared. */
function sameBlock(a: PmNode | undefined, b: PmNode): boolean {
  return a !== undefined && a.content.eq(b.content) && signature(a.copy()) === signature(b.copy());
}

/** A transaction that gives every block without an id a minted one, or null. */
export function mintMissingIds(state: EditorState, mint: NodeIdMinter = newNodeId): Transaction | null {
  const fixes = plan(trace(state.doc, state.doc, new Mapping()), NOTHING_REMOVED, mint);
  return fixes.length === 0 ? null : applyFixes(state.tr, fixes).setMeta("addToHistory", false);
}

/**
 * Sets the ids of many blocks in one pass over the document. One attribute
 * step per block copies the document once per block, which makes a large
 * paste quadratic. Like an attribute step it changes no positions.
 */
class SetNodeIds extends Step {
  constructor(readonly fixes: readonly Fix[]) {
    super();
  }

  apply(doc: PmNode): StepResult {
    const ids = new Map(this.fixes.map((fix) => [fix.pos, fix.id]));
    let found = 0;
    const rewrite = (fragment: Fragment, start: number): Fragment => {
      const nodes: PmNode[] = [];
      let changed = false;
      let pos = start;
      fragment.forEach((node) => {
        let out = node;
        if (ids.has(pos) && carriesId(node)) {
          found += 1;
          out = node.type.create({ ...node.attrs, [NODE_ID_ATTRIBUTE]: ids.get(pos) }, node.content, node.marks);
        } else if (!node.isTextblock && !node.isLeaf) {
          out = node.copy(rewrite(node.content, pos + 1));
        }
        // `copy` returns the node itself when nothing below it changed.
        changed ||= out !== node;
        nodes.push(out);
        pos += node.nodeSize;
      });
      return changed ? Fragment.fromArray(nodes) : fragment;
    };
    const content = rewrite(doc.content, 0);
    return found === ids.size ? StepResult.ok(doc.copy(content)) : StepResult.fail("No block at a node id position");
  }

  invert(doc: PmNode): Step {
    const wanted = new Set(this.fixes.map((fix) => fix.pos));
    return new SetNodeIds(
      blocksOf(doc).filter((block) => wanted.has(block.pos)).map((block) => ({ pos: block.pos, id: idOf(block.node) })),
    );
  }

  map(mapping: Mappable): Step | null {
    const fixes = this.fixes.flatMap(({ pos, id }) => {
      const mapped = mapping.mapResult(pos, 1);
      return mapped.deletedAfter ? [] : [{ pos: mapped.pos, id }];
    });
    return fixes.length === 0 ? null : new SetNodeIds(fixes);
  }

  toJSON(): { stepType: string; fixes: readonly Fix[] } {
    return { stepType: "setNodeIds", fixes: this.fixes };
  }
}

function applyFixes(tr: Transaction, fixes: readonly Fix[]): Transaction {
  return tr.step(new SetNodeIds(fixes));
}

/** The plugin that keeps block identity. One per editor state. */
export function createNodeIdentityPlugin(mint: NodeIdMinter = newNodeId): Plugin<Removed> {
  return new Plugin<Removed>({
    key: identityKey,
    state: {
      init: () => NOTHING_REMOVED,
      apply(tr, remembered) {
        if (!tr.docChanged) {
          return remembered;
        }
        return storedLoads.has(tr) ? NOTHING_REMOVED : remember(remembered, tr);
      },
    },
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged) || transactions.some((tr) => storedLoads.has(tr))) {
        return null;
      }
      let traced: Trace;
      if (transactions.length === 1 && transactions[0].before === oldState.doc) {
        traced = traceOf(transactions[0]);
      } else {
        const mapping = new Mapping();
        for (const tr of transactions) {
          mapping.appendMapping(tr.mapping);
        }
        traced = trace(oldState.doc, newState.doc, mapping);
      }
      const remembered = identityKey.getState(oldState) ?? NOTHING_REMOVED;
      const fixes = plan(traced, remembered, mint);
      return fixes.length === 0 ? null : applyFixes(newState.tr, fixes);
    },
    props: {
      transformPasted: withoutNodeIds,
    },
  });
}

function stripIds(fragment: Fragment): Fragment {
  const nodes: PmNode[] = [];
  fragment.forEach((node) => {
    if (node.isText) {
      nodes.push(node);
      return;
    }
    const attrs = carriesId(node) ? { ...node.attrs, [NODE_ID_ATTRIBUTE]: null } : node.attrs;
    nodes.push(node.type.create(attrs, stripIds(node.content), node.marks));
  });
  return Fragment.fromArray(nodes);
}

/** The slice with every node id removed: what a paste or a drop inserts. */
export function withoutNodeIds(slice: Slice): Slice {
  return new Slice(stripIds(slice.content), slice.openStart, slice.openEnd);
}

type Dispatcher = { state: EditorState; dispatch: (tr: Transaction) => void };

/**
 * Replaces the editor content with a stored canonical document, ids included.
 * This is the only way ids enter the editor from outside, so it takes a
 * canonical document, not editor JSON, and refuses one the domain validator
 * refuses (a duplicated id among them) instead of repairing it. Not an edit:
 * it stays out of the undo history and raises no update.
 */
export function replaceWithStoredDocument(
  view: Dispatcher,
  doc: CanonicalDocument,
): { ok: true } | { ok: false; errors: ValidationError[] } {
  const validated = validateDocument(doc);
  if (!validated.ok) {
    return { ok: false, errors: validated.errors };
  }
  const { state } = view;
  const content = state.schema.nodeFromJSON(canonicalToTiptap(validated.doc)).content;
  const tr = state.tr
    .replaceWith(0, state.doc.content.size, content)
    .setMeta("addToHistory", false)
    .setMeta("preventUpdate", true);
  storedLoads.add(tr);
  view.dispatch(tr);
  return { ok: true };
}
