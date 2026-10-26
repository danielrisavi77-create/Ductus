/**
 * A plain left or right arrow on a selection across blocks is handled by the
 * editor itself (DAN-247, contract #567 issuecomment-6410842945).
 *
 * prosemirror-view 1.42.6 leaves such an arrow to the browser
 * (`capturekeys.ts` 51-55, an `AllSelection` from Ctrl+A among them) and
 * learns of the moved caret only from the asynchronous `selectionchange`. A
 * key typed before that event arrives still meets the old selection, and
 * `input.ts` 153-159 writes the letter over all of it. Here the caret is set
 * in the editor state in the same keydown, so the state never lags the caret
 * on screen.
 *
 * Only the selection changes: the transaction holds no step, so it reaches
 * neither the journal nor the evidence. A caret, or a selection inside one
 * block, stays with the browser as before. Home, End, ArrowUp and ArrowDown
 * are out of scope (known limit, an upstream report).
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, Selection, TextSelection, type EditorState } from "@tiptap/pm/state";

const arrowCollapseKey = new PluginKey("arrowCollapse");

/** The keys this plugin reads; anything with a modifier is left alone. */
type ArrowKey = Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey">;

/**
 * The caret a plain left or right arrow leaves on `state`'s selection, or
 * null when the browser handles the key as before.
 */
export function collapsedByArrow(state: EditorState, event: ArrowKey): Selection | null {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return null;
  if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return null;
  const sel = state.selection;
  if (sel.empty || (sel instanceof TextSelection && sel.$from.sameParent(sel.$to))) return null;
  const forward = event.key === "ArrowRight";
  // `near` searches back from the end and forward from the start, so the
  // caret stays inside the selection's own outermost text blocks.
  return Selection.near(forward ? sel.$to : sel.$from, forward ? -1 : 1);
}

export const ArrowCollapse = Extension.create({
  name: "arrowCollapse",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: arrowCollapseKey,
        props: {
          handleKeyDown(view, event) {
            const caret = collapsedByArrow(view.state, event);
            if (caret === null) return false;
            view.dispatch(view.state.tr.setSelection(caret).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
