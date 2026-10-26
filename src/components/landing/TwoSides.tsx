"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { useRef } from "react";

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
 * speed or rhythm anywhere (PRODUCT §5 rule 4).
 */
export default function TwoSides() {
  const theme = useSheetTheme();
  const mentorRef = useRef<ReturnType<typeof useEditor>>(null);

  const mentor = useEditor({
    extensions: createEditorExtensions(),
    content: `<p>${l.sampleText}</p>`,
    editable: false,
    immediatelyRender: false,
    editorProps: { attributes: () => attributes(l.mentorLabel, true) },
  });
  mentorRef.current = mentor;

  const student = useEditor({
    extensions: createEditorExtensions(l.placeholder),
    content: `<p>${l.sampleText}</p>`,
    immediatelyRender: false,
    editorProps: { attributes: () => attributes(l.editorLabel, false) },
    onUpdate: ({ editor }) => {
      mentorRef.current?.commands.setContent(editor.getJSON(), { emitUpdate: false });
    },
  });

  return (
    <section className={styles.block} aria-labelledby="dvije-strane-naslov">
      <p className={styles.eyebrow}>{l.sidesEyebrow}</p>
      <h2 id="dvije-strane-naslov" className={styles.blockTitle}>
        {l.sidesTitle}
      </h2>
      <p className={styles.lead}>{l.sidesLead}</p>
      <div className={styles.panes}>
        <div className={styles.pane}>
          <p className={styles.paneLabel}>{l.studentPane}</p>
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
