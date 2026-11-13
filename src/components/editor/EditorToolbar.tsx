"use client";

import EditorToolbarFor from "./EditorToolbarFor";
import { useLocalEditor } from "./LocalDocument";

/** The writing page's toolbar, bound to its local document. */
export default function EditorToolbar() {
  return <EditorToolbarFor editor={useLocalEditor()} />;
}
