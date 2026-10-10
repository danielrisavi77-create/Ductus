/**
 * Tiptap schema for F1 (step F1-2b).
 *
 * The editor is a *projection* of the canonical document, so its schema must
 * not be able to express anything the canonical model cannot hold. That is why
 * StarterKit is deliberately not used: it registers lists, blockquotes, code
 * blocks, horizontal rules, strike and code marks — all outside the F1 node
 * model (dossier §5) — and a document containing them could not be projected
 * back without losing the author's text.
 *
 * Exactly the F1 set is registered here:
 *   doc, paragraph, heading (levels 1-3), text, bold, italic, history.
 * Placeholder is a decoration only: it adds no node or mark to the schema.
 *
 * Gapcursor is not registered: it exists for non-textblock leaf nodes (images,
 * tables, horizontal rules), none of which exist in the F1 schema.
 */

import { Extension, type Extensions } from "@tiptap/core";
import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import Heading from "@tiptap/extension-heading";
import History from "@tiptap/extension-history";
import Italic from "@tiptap/extension-italic";
import Paragraph from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import Text from "@tiptap/extension-text";

import { NODE_ID_ATTRIBUTE } from "./interop";

export { NODE_ID_ATTRIBUTE };

/** HTML attribute the node id is serialised to when Tiptap renders/parses. */
export const NODE_ID_HTML_ATTRIBUTE = "data-node-id";

/** Block node types that carry a canonical id. */
export const ID_CARRYING_TYPES = ["paragraph", "heading"] as const;

/** Heading levels allowed in F1. Mirrors `HeadingLevel` in the domain. */
export const F1_HEADING_LEVELS = [1, 2, 3] as const;

/** Croatian placeholder shown while the document is empty. */
export const DEFAULT_PLACEHOLDER = "Počni pisati…";

/**
 * Global attribute carrying the canonical node id.
 *
 * `keepOnSplit: false` is the important part: when the author splits a
 * paragraph, ProseMirror copies the original node's attributes onto the new
 * node by default, which would hand two blocks the *same* canonical identity —
 * and identity is what comments, evidence and revisions anchor to. With the
 * flag off the new block arrives with no id and the interop layer mints a
 * fresh one.
 */
export const NodeIdentity = Extension.create({
  name: "nodeIdentity",

  addGlobalAttributes() {
    return [
      {
        types: [...ID_CARRYING_TYPES],
        attributes: {
          [NODE_ID_ATTRIBUTE]: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute(NODE_ID_HTML_ATTRIBUTE),
            renderHTML: (attributes: Record<string, unknown>) => {
              const id = attributes[NODE_ID_ATTRIBUTE];
              return typeof id === "string" && id !== ""
                ? { [NODE_ID_HTML_ATTRIBUTE]: id }
                : {};
            },
          },
        },
      },
    ];
  },
});

/** Every extension name registered by `createEditorExtensions`. */
export const F1_EXTENSION_NAMES = [
  "doc",
  "paragraph",
  "heading",
  "text",
  "bold",
  "italic",
  "undoRedo",
  "placeholder",
  "nodeIdentity",
] as const;

/**
 * The F1 extension array. `placeholder` is injectable so a caller can localise
 * it; the default is already Croatian.
 */
export function createEditorExtensions(
  placeholder: string = DEFAULT_PLACEHOLDER,
): Extensions {
  return [
    Document,
    Paragraph,
    Heading.configure({ levels: [...F1_HEADING_LEVELS] }),
    Text,
    Bold,
    Italic,
    History,
    Placeholder.configure({ placeholder }),
    NodeIdentity,
  ];
}
