"use client";

/**
 * The heading list in the structure rail (F-8 step 1, design editor-v11 §5.1
 * point 3). A view of the headings the editor holds: indented by level, the
 * section that holds the cursor marked with `aria-current`, and a click puts
 * the cursor at the start of that heading. It never changes the document.
 */

import { useEditorState, type Editor } from "@tiptap/react";

import { showInText } from "@/client/comments-bridge";
import { currentHeading, headingOutline, type OutlineEntry } from "@/editor/outline";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { useLocalEditor } from "./LocalDocument";

type OutlineState = { entries: OutlineEntry[]; current: number };

const EMPTY: OutlineState = { entries: [], current: -1 };

function outlineOf(editor: Editor | null): OutlineState {
  if (!editor || editor.isDestroyed) return EMPTY;
  const entries = headingOutline(editor.state.doc);
  return { entries, current: currentHeading(entries, editor.state.selection.from) };
}

export default function HeadingOutline({ documentId }: { documentId?: string } = {}) {
  const editor = useLocalEditor();
  const { entries, current } = useEditorState({ editor, selector: ({ editor: e }) => outlineOf(e) }) ?? EMPTY;

  if (entries.length === 0) return <p className="rail-empty">{t.workspace.structureEmpty}</p>;

  const go = (entry: OutlineEntry) => {
    // The teacher view on /rad replaced the editor: the heading is shown there (#732 item 7).
    if (documentId && entry.id && showInText(documentId, { nodeId: entry.id })) return;
    if (!editor || editor.isDestroyed) return;
    // Inside the heading, before its first letter; read-only text still takes a cursor.
    editor.chain().setTextSelection(entry.pos + 1).scrollIntoView().run();
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
              {entry.text === "" ? <span className="outline__untitled">{t.outline.untitledHeading}</span> : entry.text}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
