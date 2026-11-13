"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { useLayoutEffect, useRef } from "react";

import { EditorToolbarFor } from "@/components/editor/EditorToolbar";
import { useSheetTheme } from "@/components/shell/useSheetTheme";
import { createEditorExtensions } from "@/editor/schema";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import styles from "./Wow.module.css";

const l = t.landing.wow;

const attributes = (label: string, readOnly: boolean) => ({
  role: "textbox",
  "aria-multiline": "true",
  "aria-label": label,
  "aria-readonly": readOnly ? "true" : "false",
  class: "manuscript",
});

/**
 * The real editor schema in a sandbox: the visitor types on the left, a second
 * read-only editor on the right shows the same document at once (PRODUCT §5
 * rule 5: same text, same function). Nothing is saved or sent: no journal, no
 * session, no publisher. The text lives in this page only. There is no clock,
 * speed or rhythm anywhere (PRODUCT §5 rule 4). Above the visitor's sheet is
 * the writing page's own toolbar (editor-v11, DAN-354): it only runs this
 * editor's commands, and its "Prikaz" keeps just the sheet theme, as on /rad.
 */
export default function TwoSides() {
  const theme = useSheetTheme();
  const mentorRef = useRef<ReturnType<typeof useEditor>>(null);

  const mentor = useEditor({
    extensions: createEditorExtensions(),
    content: `<p>${l.sampleText}</p>`,
    editable: false,
    immediatelyRender: false,
    injectCSS: false, // app/prosemirror.css (DAN-489)
    editorProps: { attributes: () => attributes(l.mentorLabel, true) },
  });
  // Kept after each commit, before the student's next edit can reach it.
  useLayoutEffect(() => { mentorRef.current = mentor; });

  const student = useEditor({
    extensions: createEditorExtensions(l.placeholder),
    content: `<p>${l.sampleText}</p>`,
    immediatelyRender: false,
    injectCSS: false, // app/prosemirror.css (DAN-489)
    editorProps: { attributes: () => attributes(l.editorLabel, false) },
    onUpdate: ({ editor }) => {
      mentorRef.current?.commands.setContent(editor.getJSON(), { emitUpdate: false });
    },
  });

  return (
    <section id="isprobaj" className={styles.block} aria-labelledby="dvije-strane-naslov">
      <p className={styles.eyebrow}>{l.sidesEyebrow}</p>
      <h2 id="dvije-strane-naslov" className={styles.blockTitle}>
        {l.sidesTitle}
      </h2>
      <p className={styles.lead}>{l.sidesLead}</p>
      <div className={styles.panes}>
        <div className={styles.pane}>
          <p className={styles.paneLabel}>{l.studentPane}</p>
          <EditorToolbarFor editor={student} />
          <article className={`sheet ${styles.editorSheet}`} data-sheet-theme={theme}>
            <EditorContent editor={student} />
          </article>
        </div>
        <div className={styles.pane}>
          <p className={styles.paneLabel}>{l.mentorPane}</p>
          <div className={styles.mentorRow}>
            <article className={`sheet ${styles.editorSheet}`} data-sheet-theme={theme}>
              <EditorContent editor={mentor} />
            </article>
            <p className={styles.note} data-shown="true">
              <span>{l.sampleCommentPlace}</span>
              {l.sampleComment}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
