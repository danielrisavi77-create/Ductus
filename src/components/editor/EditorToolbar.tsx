"use client";

/**
 * The toolbar above the sheet (F-8 step 1, design editor-v11 §5.1 point 2).
 *
 * Only what the F1 schema holds: paragraph, headings 1-3, bold, italic, undo
 * and redo. Every button runs an editor command, so a change reaches the
 * journal exactly as typing does; the toolbar itself stores nothing.
 *
 * One Tab stop (WAI-ARIA toolbar): arrows, Home and End move between buttons.
 * While the editor may not be written in (loading, another tab, a failure,
 * signing out) every button says so with `aria-disabled` and does nothing,
 * and stays reachable, so a keyboard user learns why nothing happens.
 */

import { useEditorState, type Editor } from "@tiptap/react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { useLocalEditor } from "./LocalDocument";

type ToolbarState = {
  editable: boolean;
  paragraph: boolean;
  heading1: boolean;
  heading2: boolean;
  heading3: boolean;
  bold: boolean;
  italic: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

const IDLE: ToolbarState = {
  editable: false, paragraph: false, heading1: false, heading2: false, heading3: false,
  bold: false, italic: false, canUndo: false, canRedo: false,
};

function stateOf(editor: Editor | null): ToolbarState {
  if (!editor || editor.isDestroyed) return IDLE;
  const editable = editor.isEditable;
  return {
    editable,
    paragraph: editor.isActive("paragraph"),
    heading1: editor.isActive("heading", { level: 1 }),
    heading2: editor.isActive("heading", { level: 2 }),
    heading3: editor.isActive("heading", { level: 3 }),
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    canUndo: editable && editor.can().undo(),
    canRedo: editable && editor.can().redo(),
  };
}

type Tool = {
  key: string;
  label: string;
  /** What the button shows; the label is its accessible name and title. */
  glyph: ReactNode;
  /** Toggle buttons only: whether it is on. */
  pressed?: (state: ToolbarState) => boolean;
  enabled?: (state: ToolbarState) => boolean;
  run: (editor: Editor) => void;
};

const TOOLS: readonly Tool[] = [
  {
    key: "paragraph", label: t.toolbar.paragraph, glyph: "¶",
    pressed: (s) => s.paragraph, run: (e) => e.chain().focus().setParagraph().run(),
  },
  ...([1, 2, 3] as const).map((level): Tool => ({
    key: `heading${level}`, label: t.toolbar[`heading${level}`], glyph: `N${level}`,
    pressed: (s) => s[`heading${level}`],
    run: (e) => e.chain().focus().setHeading({ level }).run(),
  })),
  {
    key: "bold", label: t.toolbar.bold, glyph: <b>B</b>,
    pressed: (s) => s.bold, run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    key: "italic", label: t.toolbar.italic, glyph: <i>I</i>,
    pressed: (s) => s.italic, run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    key: "undo", label: t.toolbar.undo, glyph: "↶",
    enabled: (s) => s.canUndo, run: (e) => e.chain().focus().undo().run(),
  },
  {
    key: "redo", label: t.toolbar.redo, glyph: "↷",
    enabled: (s) => s.canRedo, run: (e) => e.chain().focus().redo().run(),
  },
];

export default function EditorToolbar() {
  const editor = useLocalEditor();
  const state = useEditorState({ editor, selector: ({ editor: e }) => stateOf(e) }) ?? IDLE;
  const listRef = useRef<HTMLDivElement>(null);
  const [focusAt, setFocusAt] = useState(0);

  // Roving focus between the buttons; Tab leaves the toolbar.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) return;
    const next = event.key === "ArrowRight" ? (at + 1) % buttons.length
      : event.key === "ArrowLeft" ? (at - 1 + buttons.length) % buttons.length
      : event.key === "Home" ? 0
      : event.key === "End" ? buttons.length - 1
      : -1;
    if (next === -1) return;
    event.preventDefault();
    setFocusAt(next);
    buttons[next]!.focus();
  };

  return (
    <div
      ref={listRef}
      className="editor-toolbar"
      role="toolbar"
      aria-label={t.toolbar.label}
      onKeyDown={onKeyDown}
    >
      {TOOLS.map((tool, index) => {
        const usable = state.editable && (tool.enabled?.(state) ?? true);
        return (
          <button
            key={tool.key}
            type="button"
            className="editor-toolbar__button"
            data-tool={tool.key}
            aria-label={tool.label}
            title={tool.label}
            aria-pressed={tool.pressed ? tool.pressed(state) : undefined}
            aria-disabled={usable ? undefined : "true"}
            tabIndex={index === focusAt ? 0 : -1}
            // Keeps the selection in the sheet; the command refocuses it.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setFocusAt(index);
              // Checked again at the click: a sign-out stops writing without a render.
              if (usable && editor && !editor.isDestroyed && editor.isEditable) tool.run(editor);
            }}
          >
            <span aria-hidden="true">{tool.glyph}</span>
          </button>
        );
      })}
    </div>
  );
}
