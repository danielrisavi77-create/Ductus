"use client";

/**
 * A self-contained writing surface, not connected to a journal or a person.
 * The F1 schema is the same one used by the application. Its parent must not
 * present this component as a saved document or a view shared with anyone.
 */
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { useId, useState, type ReactNode } from "react";

import { ArrowCollapse } from "@/editor/arrow-collapse";
import { headingOutline, type OutlineEntry } from "@/editor/outline";
import { createEditorExtensions } from "@/editor/schema";
import { StorableInput } from "@/editor/storable-input";
import { countTextWords, lengthLine } from "@/lib/i18n/length-line";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import styles from "./EditorSurface.module.css";

type Tool = {
  key: string;
  label: string;
  glyph: ReactNode;
  pressed?: (editor: Editor) => boolean;
  enabled?: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
};

const tools: readonly Tool[] = [
  { key: "undo", label: t.toolbar.undo, glyph: "↶", enabled: (e) => e.can().undo(), run: (e) => { e.chain().focus().undo().run(); } },
  { key: "redo", label: t.toolbar.redo, glyph: "↷", enabled: (e) => e.can().redo(), run: (e) => { e.chain().focus().redo().run(); } },
  { key: "paragraph", label: t.toolbar.paragraph, glyph: "¶", pressed: (e) => e.isActive("paragraph"), run: (e) => { e.chain().focus().setParagraph().run(); } },
  { key: "heading1", label: t.toolbar.heading1, glyph: "Naslov", pressed: (e) => e.isActive("heading", { level: 1 }), run: (e) => { e.chain().focus().setHeading({ level: 1 }).run(); } },
  { key: "heading2", label: t.toolbar.heading2, glyph: "Podnaslov", pressed: (e) => e.isActive("heading", { level: 2 }), run: (e) => { e.chain().focus().setHeading({ level: 2 }).run(); } },
  { key: "bold", label: t.toolbar.bold, glyph: <b>B</b>, pressed: (e) => e.isActive("bold"), run: (e) => { e.chain().focus().toggleBold().run(); } },
  { key: "italic", label: t.toolbar.italic, glyph: <i>I</i>, pressed: (e) => e.isActive("italic"), run: (e) => { e.chain().focus().toggleItalic().run(); } },
  { key: "bullet", label: t.toolbar.bulletItem, glyph: "•", pressed: (e) => e.isActive("bulletItem"), run: (e) => { e.chain().focus().toggleNode("bulletItem", "paragraph").run(); } },
  { key: "quote", label: t.toolbar.quote, glyph: "„ ”", pressed: (e) => e.isActive("quote"), run: (e) => { e.chain().focus().toggleNode("quote", "paragraph").run(); } },
];

function goToHeading(editor: Editor, entry: OutlineEntry) {
  editor.chain().setTextSelection(entry.pos + 1).scrollIntoView().run();
  editor.view.focus();
}

export default function EditorSurface() {
  const [showMobileOutline, setShowMobileOutline] = useState(false);
  const outlineId = useId();
  const editor = useEditor({
    extensions: [...createEditorExtensions(t.editor.placeholder), StorableInput, ArrowCollapse],
    content: "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": t.workspace.documentLabel,
      },
    },
  });

  const view = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current || current.isDestroyed) return null;
      const text = current.state.doc.textBetween(0, current.state.doc.content.size, " ");
      return {
        words: countTextWords(text),
        outline: headingOutline(current.state.doc),
        pressed: tools.map((tool) => tool.pressed?.(current)),
        enabled: tools.map((tool) => tool.enabled?.(current) ?? true),
      };
    },
  });

  const count = lengthLine(view?.words ?? 0, 0, null);

  return (
    <section className={styles.surface} aria-label={t.workspace.documentLabel}>
      <aside className={styles.rail} aria-label={t.workspace.structureLabel} data-expanded={showMobileOutline}>
        <div className={styles.railHeader}>
          <span className={styles.desktopRailTitle}>{t.workspace.structure}</span>
          <button
            className={styles.mobileRailToggle}
            type="button"
            aria-expanded={showMobileOutline}
            aria-controls={outlineId}
            onClick={() => setShowMobileOutline((open) => !open)}
          >
            {t.workspace.structure}<span aria-hidden="true">{showMobileOutline ? "−" : "+"}</span>
          </button>
          <span aria-hidden="true">{view?.outline.length ?? 0}</span>
        </div>
        <div className={styles.railContent} id={outlineId}>
          {!view?.outline.length ? <p className={styles.empty}>{t.workspace.structureEmpty}</p> : (
          <nav aria-label={t.outline.label}>
            <ol className={styles.outline}>
              {view.outline.map((entry, index) => (
                <li key={entry.id ?? `heading-${index}`} data-level={entry.level}>
                  <button type="button" onClick={() => { if (editor) goToHeading(editor, entry); }}>
                    <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    {entry.text || t.outline.untitledHeading}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          )}
        </div>
      </aside>

      <div className={styles.workspace}>
        <div className={styles.toolbar} role="group" aria-label={t.toolbar.label}>
          {tools.map((tool, index) => (
            <button
              key={tool.key}
              type="button"
              className={styles.tool}
              aria-label={tool.label}
              title={tool.label}
              aria-pressed={tool.pressed ? view?.pressed[index] ?? false : undefined}
              disabled={!editor || !view?.enabled[index]}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { if (editor) tool.run(editor); }}
            >
              {tool.glyph}
            </button>
          ))}
        </div>
        <div className={styles.pageArea}>
          <article className={styles.paper}>
            <p className={styles.paperLabel}>{t.workspace.documentUntitled}</p>
            <EditorContent editor={editor} className={styles.editor} />
          </article>
        </div>
        <div className={styles.status}><span>{count.count}{count.rest}</span></div>
      </div>
    </section>
  );
}
