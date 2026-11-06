import type { CanonicalDocument, HeadingLevel, NodeId } from "./schema";

/**
 * The one chapter projection of a document (M5.3-P01, DAN-395). Chapter scope
 * (M5.8), the Draft panel (M5.14), the form check (M4.4) and export read the
 * chapters from here, never from a second projection.
 *
 * Read from the canonical document, never stored: a chapter is its heading,
 * keyed by the heading's stable block id, so an edit elsewhere never renames,
 * renumbers or reparents it. Pure, so it is tested without an editor.
 */

/**
 * How a chapter's number is written. The rules package of M4 may give one;
 * until it does the neutral numbering applies (D-229).
 */
export type ChapterProfile = {
  /** The label of a chapter from its path, e.g. `[1, 2]`. */
  readonly label: (path: readonly number[]) => string;
};

/** "1", "1.1", "1.1.1": an editor setting, no claim about the FPZG form (D-229). */
export const NEUTRAL_CHAPTER_PROFILE: ChapterProfile = { label: (path) => path.join(".") };

export type Chapter = {
  /** The heading's block id. */
  readonly blockId: NodeId;
  readonly level: HeadingLevel;
  /**
   * One counter per level up to `level`. A heading raises the counter of its
   * level and resets the deeper ones, so a skipped level stays 0 (`[1, 0, 1]`):
   * the level is kept and the gap stays visible to the form check.
   */
  readonly path: readonly number[];
  /** The label from the profile. */
  readonly number: string;
  /** The heading's text without marks, trimmed; "" for an empty heading. */
  readonly title: string;
  /** The nearest earlier heading of a lower level, or null. */
  readonly parentId: NodeId | null;
  /** The blocks after the heading up to the next heading of any level. */
  readonly ownBlockIds: readonly NodeId[];
};

export type ChapterOutline = {
  /** The blocks before the first heading. */
  readonly preambleBlockIds: readonly NodeId[];
  readonly chapters: readonly Chapter[];
};

/** Every heading of the document as a chapter, in document order. */
export function deriveChapters(
  document: CanonicalDocument,
  profile: ChapterProfile = NEUTRAL_CHAPTER_PROFILE,
): ChapterOutline {
  const preambleBlockIds: NodeId[] = [];
  const chapters: Chapter[] = [];
  const counters = [0, 0, 0];
  // The latest heading seen at each level, for the parent of a deeper one.
  const latest: (NodeId | null)[] = [null, null, null];
  let own: NodeId[] = preambleBlockIds;

  for (const node of document.nodes) {
    if (node.type !== "heading") {
      own.push(node.id);
      continue;
    }
    const depth = node.level - 1;
    counters[depth]! += 1;
    for (let i = depth + 1; i < counters.length; i += 1) {
      counters[i] = 0;
      latest[i] = null;
    }
    latest[depth] = node.id;
    const path = counters.slice(0, node.level);
    own = [];
    chapters.push({
      blockId: node.id,
      level: node.level,
      path,
      number: profile.label([...path]),
      title: node.children.map((child) => child.text).join("").trim(),
      parentId: nearest(latest, depth),
      ownBlockIds: own,
    });
  }
  return { preambleBlockIds, chapters };
}

/** The deepest heading seen above `depth`, or null. */
function nearest(latest: readonly (NodeId | null)[], depth: number): NodeId | null {
  for (let i = depth - 1; i >= 0; i -= 1) {
    const id = latest[i];
    if (id) return id;
  }
  return null;
}
