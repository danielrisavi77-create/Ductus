"use client";

/**
 * The heading list in the structure rail (F-8 step 1, design editor-v11 §5.1
 * point 3) and the table of contents (M5.3-P02, DAN-395). A view of the
 * headings the editor holds, numbered by `deriveChapters`: indented by level,
 * the section that holds the cursor marked with `aria-current`, and a click
 * puts the cursor at the start of that heading. The click looks the heading
 * up by its block id at that moment, so it reaches the right block after a
 * move or an undo. It never changes the document.
 */

import { useEditorState, type Editor } from "@tiptap/react";

import { showInText } from "@/client/comments-bridge";
import { blockPosition, numberedHeadings, type NumberedHeading } from "@/editor/chapter-numbers";
import { currentHeading } from "@/editor/outline";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { useLocalEditor } from "./LocalDocument";

type OutlineState = { entries: NumberedHeading[]; current: number };

const EMPTY: OutlineState = { entries: [], current: -1 };

function outlineOf(editor: Editor | null): OutlineState {
  if (!editor || editor.isDestroyed) return EMPTY;
  const entries = numberedHeadings(editor.state.doc);
  return { entries, current: currentHeading(entries, editor.state.selection.from) };
}

export default function HeadingOutline({ documentId }: { documentId?: string } = {}) {
  const editor = useLocalEditor();
  const { entries, current } = useEditorState({ editor, selector: ({ editor: e }) => outlineOf(e) }) ?? EMPTY;

  if (entries.length === 0) return <p className="rail-empty">{t.workspace.structureEmpty}</p>;

  const go = (entry: NumberedHeading) => {
    // The teacher view on /rad replaced the editor: the heading is shown there (#732 item 7).
    if (documentId && entry.id && showInText(documentId, { nodeId: entry.id })) return;
    if (!editor || editor.isDestroyed) return;
    // By id now, not the position this list was drawn with (DAN-395).
    const pos = entry.id ? blockPosition(editor.state.doc, entry.id) : entry.pos;
    if (pos === null) return;
    // Inside the heading, before its first letter; read-only text still takes a cursor.
    editor.chain().setTextSelection(pos + 1).scrollIntoView().run();
    // Tiptap's focus command waits for the next frame, and keys typed before it
    // would go to this button and be lost; ProseMirror focuses at once.
    editor.view.focus();
  };

  return (
    <nav aria-label={t.outline.label}>
      <ol className="outline">
        {entries.map((entry, index) => (
          <li key={entry.id ?? `pos-${entry.pos}`} className="outline__item" data-level={entry.level}>
            <button
              type="button"
              className="outline__link"
              aria-current={index === current ? "location" : undefined}
              onClick={() => go(entry)}
            >
              <span className="outline__number">{entry.number}.</span>{" "}
              {entry.title === "" ? <span className="outline__untitled">{t.outline.untitledHeading}</span> : entry.title}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
