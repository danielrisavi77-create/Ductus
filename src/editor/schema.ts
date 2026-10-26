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
 *   doc, paragraph, heading (levels 1-3), bullet item, quote, text, bold,
 *   italic, history.
 * The bullet item and the quote (E1, #823) are flat text blocks of their own
 * (`bullet-item.ts`, `quote.ts`), not StarterKit's list and blockquote,
 * which wrap paragraphs.
 * Placeholder is a decoration only: it adds no node or mark to the schema.
 *
 * Gapcursor is not registered: it exists for non-textblock leaf nodes (images,
 * tables, horizontal rules), none of which exist in the F1 schema.
 */

import { Extension, type Editor, type Extensions } from "@tiptap/core";
import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import Heading from "@tiptap/extension-heading";
import History from "@tiptap/extension-history";
import Italic from "@tiptap/extension-italic";
import Paragraph from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import Text from "@tiptap/extension-text";
import { PluginKey } from "@tiptap/pm/state";

import { blockMarkerRule, markerRemoval } from "./block-marker";
import { BulletItem } from "./bullet-item";
import { Quote } from "./quote";
import { createNodeIdentityPlugin, mintMissingIds, repeatedNodeIds, type NodeIdMinter } from "./identity";
import { NODE_ID_ATTRIBUTE } from "./interop";

export { NODE_ID_ATTRIBUTE };

/** HTML attribute the node id is serialised to when Tiptap renders/parses. */
export const NODE_ID_HTML_ATTRIBUTE = "data-node-id";

/** Block node types that carry a canonical id. */
export const ID_CARRYING_TYPES = ["paragraph", "heading", "bulletItem", "quote"] as const;

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
 *
 * The attribute is only where the id is kept. Which block owns which id is
 * decided by the plugin from `identity.ts`: content that is pasted, dropped
 * or inserted by a script never brings an id with it, and a block that was
 * already in the document never loses its own.
 */
export type NodeIdentityOptions = {
  mint?: NodeIdMinter;
  /**
   * Told which ids the initial content held more than once, before they are
   * repaired. The default writes a console warning.
   */
  onRepeatedInitialId?: (ids: readonly string[]) => void;
};

/**
 * Initial content (`content` of the editor) is not the way in for a stored
 * document: nothing validates it, so an id held twice is repaired by position
 * instead of being refused. `replaceWithStoredDocument` is that way in. This
 * makes the repair visible, so a stored document cannot take the wrong way
 * unnoticed.
 */
function warnRepeatedInitialId(ids: readonly string[]): void {
  console.warn(
    `Editor content held ${ids.length} node id(s) more than once; the later blocks got new ids. ` +
      "Load stored documents with replaceWithStoredDocument, which refuses such a document.",
  );
}

export const NodeIdentity = Extension.create<NodeIdentityOptions>({
  name: "nodeIdentity",

  addOptions() {
    return {};
  },

  addProseMirrorPlugins() {
    return [createNodeIdentityPlugin(this.options.mint)];
  },

  // A document created empty has a block with no id yet. It gets one before
  // the author types, not as a side effect of the first keystroke.
  onCreate() {
    const repeated = repeatedNodeIds(this.editor.state.doc);
    if (repeated.length > 0) {
      (this.options.onRepeatedInitialId ?? warnRepeatedInitialId)(repeated);
    }
    const tr = mintMissingIds(this.editor.state, this.options.mint);
    if (tr && !this.editor.isDestroyed) {
      this.editor.view.dispatch(tr.setMeta("preventUpdate", true));
    }
  },

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

const headingMarkerKey = new PluginKey<null>("headingMarker");

/**
 * Tiptap's heading with "# ", "## " and "### " in two transactions
 * (`block-marker.ts`): Tiptap's own rule removes the marker and changes the
 * type at once, so a heading typed on an empty line got a new id. Keys,
 * commands and the schema are Tiptap's.
 */
const MarkedHeading = Heading.extend({
  addInputRules() {
    const deepest = Math.max(...this.options.levels);
    return [
      blockMarkerRule(new RegExp(`^(#{1,${deepest}})\\s$`), this.type, headingMarkerKey, (match) => ({ level: match[1]!.length })),
    ];
  },

  addProseMirrorPlugins() {
    return [markerRemoval(headingMarkerKey)];
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Tiptap's undoInputRule cannot take back a marker removed in a
      // transaction of its own, so an empty heading becomes a paragraph
      // first (same id); only the next Backspace joins.
      Backspace: () => emptyHeadingBackspace(this.editor),
    };
  },
});

/** Backspace in an empty heading: a paragraph with the same id, or false. */
export function emptyHeadingBackspace(editor: Editor): boolean {
  const { $from, empty } = editor.state.selection;
  if (!empty || $from.parent.type.name !== "heading" || $from.parent.content.size !== 0) return false;
  return editor.commands.setNode("paragraph");
}

/** Every extension name registered by `createEditorExtensions`. */
export const F1_EXTENSION_NAMES = [
  "doc",
  "paragraph",
  "heading",
  "bulletItem",
  "text",
  "bold",
  "italic",
  "quote",
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
    MarkedHeading.configure({ levels: [...F1_HEADING_LEVELS] }),
    BulletItem,
    Text,
    Bold,
    Italic,
    // After Bold: Tiptap runs keymaps of equal priority last-first, and with
    // Shift held Bold's "Mod-B" (for caps lock) would take Mod-Shift-b. Not
    // by priority: that would also run the quote's marker plugin before
    // NodeIdentity, which then sees the marker gone and gives a new id.
    Quote,
    History,
    Placeholder.configure({ placeholder }),
    NodeIdentity,
  ];
}
