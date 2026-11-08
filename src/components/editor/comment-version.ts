/**
 * A comment on the submitted work stays with the submitted version (DAN-215,
 * contract on #1091, K7c and K7d). After the submission the editor may still
 * hold text that never reached the server; a comment of the teacher, written
 * on the submitted revision, is placed only on a paragraph whose text in the
 * editor is exactly its text in that revision. Any other paragraph, or a
 * revision that is not known, gives no place: the comment stays in the list
 * with its note, never at a place of another version.
 *
 * The client has no source of the submitted revision that asks nothing of the
 * server: the opening carries the current revision, which may be later than
 * the submitted one (a segment can land between the request and the record),
 * and a submitted work makes no request to the live channel (DAN-289 O2). So
 * after the submission the version is not known and nothing is placed (K7d).
 */

import type { Node as PmNode, Schema } from "@tiptap/pm/model";

import type { CanonicalDocument } from "@/domain/document";
import type { CommentRange } from "@/editor/comment-anchor";
import { canonicalToTiptap, NODE_ID_ATTRIBUTE } from "@/editor/interop";

/** The text of every paragraph of the submitted revision, by its id. */
export type SubmittedTexts = ReadonlyMap<string, string>;

/**
 * Which version the comments are placed on: `"draft"` before the submission
 * (the text in the editor), the texts of the submitted revision after it, or
 * `null` after it while that revision is not known.
 */
export type PlacementVersion = "draft" | SubmittedTexts | null;

function textsOf(doc: PmNode): Map<string, string> {
  const texts = new Map<string, string>();
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    const id = node.attrs[NODE_ID_ATTRIBUTE];
    if (typeof id === "string") texts.set(id, node.textContent);
    return false;
  });
  return texts;
}

/**
 * The version the comments are placed on in the editor: the draft before the
 * submission, and after it none, since the submitted revision is not known
 * without a request (see the module comment).
 */
export function placementVersion(submitted: boolean): PlacementVersion {
  return submitted ? null : "draft";
}

/** The texts of a stored revision, read through the editor's own schema. */
export function submittedTextsOf(schema: Schema, document: CanonicalDocument): SubmittedTexts | null {
  try {
    return textsOf(schema.nodeFromJSON(canonicalToTiptap(document)));
  } catch {
    return null;
  }
}

/**
 * Keeps a place only where the paragraph holding it reads in the editor as in
 * the version. Returns the same array while the document, the version and the
 * places are the same, so a cursor move draws nothing again.
 */
export function createVersionGate() {
  let last: { doc: PmNode; version: PlacementVersion; ranges: readonly (CommentRange | null)[]; out: readonly (CommentRange | null)[] } | null = null;
  return (doc: PmNode, version: PlacementVersion, ranges: readonly (CommentRange | null)[]): readonly (CommentRange | null)[] => {
    if (version === "draft") return ranges;
    if (last && last.doc === doc && last.version === version && last.ranges === ranges) return last.out;
    const out = ranges.map((range) => {
      if (range === null || version === null) return null;
      const block = doc.resolve(range.from).parent;
      const id = block.attrs[NODE_ID_ATTRIBUTE];
      return typeof id === "string" && version.get(id) === block.textContent ? range : null;
    });
    last = { doc, version, ranges, out };
    return out;
  };
}
