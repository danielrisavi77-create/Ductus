/**
 * The citation of document schema v2 (DAN-620, contract
 * `docs/contracts/document-schema-v2.md` §3.1).
 *
 * An inline atom of one position: `sourceId` points at a record in the
 * document's list of sources, `locator` (a page, a chapter) is optional. Its
 * spec gives the same JSON as the replayer's (`edit-steps-v2-rules.ts`), so
 * the steps of the v2 editor replay; `edit-steps-v2-editor-schema.test.ts`
 * holds the two together.
 *
 * A citation takes no mark (§3.1), but the schema cannot say so: ProseMirror
 * lets a block decide which marks its inline children take, and a paragraph
 * takes bold and italic for its text. `CitationGuard` keeps the rule instead:
 *
 *   - after a transaction that can mark a citation (a mark step, or content
 *     that brings a marked citation along, such as a paste), it takes the
 *     marks off again in a transaction of its own, outside the history and
 *     with `CITATION_UNMARK_META`. The replayer does the same on its side;
 *   - a transaction of mark steps that would mark nothing but citations is
 *     refused, so it leaves no empty undo step behind.
 *
 * The capture of v2 steps (DAN-620 b) leaves out the guard's transaction.
 *
 * Pasted HTML: `span[data-citation]` with a valid `data-source-id` and, if
 * present, a valid `data-locator` is a citation. Anything else in such a span
 * is dropped, never repaired: the attribute values come from outside.
 */

import { mergeAttributes, Node } from "@tiptap/core";
import { Fragment, type Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import {
  AddMarkStep,
  AddNodeMarkStep,
  RemoveMarkStep,
  RemoveNodeMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  type Step,
} from "@tiptap/pm/transform";

import { isAllowedText } from "../domain/document/forbidden";
import { isSourceId, MAX_CITATION_LOCATOR_CODE_POINTS } from "../domain/document/schema";

export const CITATION = "citation";

/** Meta of the guard's own transaction, which takes marks off citations. */
export const CITATION_UNMARK_META = "citationUnmark";

export const CITATION_HTML_ATTRIBUTE = "data-citation";
export const CITATION_SOURCE_HTML_ATTRIBUTE = "data-source-id";
export const CITATION_LOCATOR_HTML_ATTRIBUTE = "data-locator";

/** Attributes of a pasted citation span, or false when they are not valid. */
function citationAttrs(element: HTMLElement): { sourceId: string; locator: string | null } | false {
  const sourceId = element.getAttribute(CITATION_SOURCE_HTML_ATTRIBUTE);
  if (!isSourceId(sourceId)) return false;
  const locator = element.getAttribute(CITATION_LOCATOR_HTML_ATTRIBUTE);
  if (locator !== null && !isAllowedText(locator, MAX_CITATION_LOCATOR_CODE_POINTS)) return false;
  return { sourceId, locator };
}

function holdsMarkedCitation(node: Fragment): boolean {
  let marked = false;
  node.descendants((child) => {
    marked ||= child.type.name === CITATION && child.marks.length > 0;
    return !marked;
  });
  return marked;
}

/** A step after which a citation can carry a mark. */
function canMarkCitation(step: Step): boolean {
  if (step instanceof AddMarkStep || step instanceof AddNodeMarkStep) return true;
  if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
    return holdsMarkedCitation(step.slice.content);
  }
  return false;
}

const isMarkStep = (step: Step) =>
  step instanceof AddMarkStep ||
  step instanceof RemoveMarkStep ||
  step instanceof AddNodeMarkStep ||
  step instanceof RemoveNodeMarkStep;

/** Positions of the citations in `doc` that carry a mark. */
function markedCitations(doc: PmNode): number[] {
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === CITATION && node.marks.length > 0) positions.push(pos);
    return node.isBlock;
  });
  return positions;
}

/**
 * `doc` with every citation unmarked; `doc` itself when none is marked. Blocks
 * are flat (a citation sits directly in a block), as in the replayer's
 * `unmarkCitations`.
 */
function unmarked(doc: PmNode): PmNode {
  if (markedCitations(doc).length === 0) return doc;
  const blocks: PmNode[] = [];
  doc.forEach((block) => {
    const children: PmNode[] = [];
    block.forEach((child) => children.push(child.type.name === CITATION ? child.mark([]) : child));
    blocks.push(block.copy(Fragment.from(children)));
  });
  return doc.copy(Fragment.from(blocks));
}

/** True for a transaction of mark steps that marks or unmarks only citations. */
function marksOnlyCitations(tr: Transaction): boolean {
  if (!tr.docChanged || !tr.steps.every(isMarkStep)) return false;
  return unmarked(tr.doc).eq(unmarked(tr.before));
}

const guardKey = new PluginKey<null>("citationGuard");

export function createCitationGuard(): Plugin {
  return new Plugin({
    key: guardKey,
    filterTransaction: (tr) => tr.getMeta(CITATION_UNMARK_META) === true || !marksOnlyCitations(tr),
    appendTransaction: (transactions, _old, state) => {
      const touched = transactions.some(
        (tr) => tr.getMeta(CITATION_UNMARK_META) !== true && tr.steps.some(canMarkCitation),
      );
      if (!touched) return null;
      const positions = markedCitations(state.doc);
      if (positions.length === 0) return null;
      const tr = state.tr;
      // A mark step keeps every position, so the positions found stay valid.
      for (const pos of positions) tr.removeMark(pos, pos + 1);
      return tr.setMeta(CITATION_UNMARK_META, true).setMeta("addToHistory", false);
    },
  });
}

export const Citation = Node.create({
  name: CITATION,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      sourceId: {
        isRequired: true,
        parseHTML: (element: HTMLElement) => element.getAttribute(CITATION_SOURCE_HTML_ATTRIBUTE),
        renderHTML: (attributes: Record<string, unknown>) => ({
          [CITATION_SOURCE_HTML_ATTRIBUTE]: attributes.sourceId,
        }),
      },
      locator: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute(CITATION_LOCATOR_HTML_ATTRIBUTE),
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.locator === "string" ? { [CITATION_LOCATOR_HTML_ATTRIBUTE]: attributes.locator } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[${CITATION_HTML_ATTRIBUTE}]`, getAttrs: (element) => (citationAttrs(element) ? null : false) }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ [CITATION_HTML_ATTRIBUTE]: "" }, HTMLAttributes)];
  },

  addProseMirrorPlugins() {
    return [createCitationGuard()];
  },
});
