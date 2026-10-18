import { EditorState, type Transaction } from "@tiptap/pm/state";

import { mintMissingIds } from "./identity";

type View = {
  state: EditorState;
  updateState: (state: EditorState) => void;
  dispatch: (tr: Transaction) => void;
};

/**
 * Gives the editor a new state with an empty undo history and the same
 * plugins. `content: "keep"` keeps the document as it is; `"empty"` leaves
 * one empty block. Nothing from before can come back through undo or redo,
 * so the sheet of one person or document never returns in the next.
 *
 * Not an edit: the new state is set, not dispatched. One transaction
 * follows, kept out of the history and raising no update, so that whoever
 * listens for transactions (the toolbar) reads the new state; it gives an id
 * to a block that has none, or changes nothing.
 */
export function startFreshHistory(view: View, content: "keep" | "empty"): void {
  const { schema, doc, plugins } = view.state;
  const next = content === "keep" ? doc : schema.topNodeType.createAndFill();
  const fresh = EditorState.create({ schema, doc: next ?? undefined, plugins });
  view.updateState(fresh);
  const tr = mintMissingIds(fresh) ?? fresh.tr.setMeta("addToHistory", false);
  view.dispatch(tr.setMeta("preventUpdate", true));
}
