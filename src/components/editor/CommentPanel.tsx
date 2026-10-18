"use client";

/**
 * The comments next to a paragraph, on the student's /rad (F-9 step 1,
 * design editor-v11 §5.1 "Komentari"). The list comes from the same
 * `list_comments` the teacher reads (PRODUCT §5 rule 5); each anchor is
 * resolved against the text this editor holds and marked as a decoration.
 * A comment whose place cannot be found reliably stays in the list with a
 * note, never at a guessed place. Text is rendered as React text, never as
 * HTML (attack 10). The student only replies; opening a comment on a
 * paragraph is the teacher's, and waits for the teacher view (B-11).
 */

import { useEditorState, type Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import {
  listComments, replyComment, type CommentThread, type ListOutcome, type ReplyOutcome, type ThreadComment,
} from "@/client/comments";
import {
  anchorRange, commentHighlightKey, commentHighlightPlugin, type CommentRange,
} from "@/editor/comment-anchor";
import { formatDateTimeHr } from "@/lib/i18n/hr";
import { messagesHr } from "@/lib/i18n/messages.hr";

import styles from "./CommentPanel.module.css";
import { useLocalEditor, useLocalSignedOut } from "./LocalDocument";

const t = messagesHr.comments;

type Placed = { thread: CommentThread; range: CommentRange | null };

function placeAll(editor: Editor | null, threads: readonly CommentThread[]): Placed[] {
  if (!editor || editor.isDestroyed) return threads.map((thread) => ({ thread, range: null }));
  const { doc } = editor.state;
  return threads.map((thread) => ({ thread, range: thread.anchor ? anchorRange(doc, thread.anchor) : null }));
}

function who(comment: ThreadComment): string {
  if (comment.isOwn) return t.own;
  return comment.role === "teacher" ? t.teacher : t.student;
}

function ThreadCard({ placed, editor, onReplied }: {
  placed: Placed; editor: Editor | null; onReplied: () => void;
}) {
  const { thread, range } = placed;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<Exclude<ReplyOutcome, "ok"> | null>(null);
  const [first, ...replies] = thread.comments;

  const show = () => {
    if (!editor || editor.isDestroyed || !range) return;
    editor.chain().setTextSelection(range).scrollIntoView().run();
    editor.view.focus();
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (sending || draft.trim() === "") return;
    setSending(true);
    const outcome = await replyComment(thread.id, draft);
    setSending(false);
    if (outcome !== "ok") return setError(outcome);
    setDraft("");
    setError(null);
    onReplied();
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void send(event);
  };

  return (
    <article className={styles.thread} data-state={thread.state} aria-label={t.number.replace("{n}", String(thread.number))}>
      <header className={styles.head}>
        <span className={styles.number}>{thread.number}</span>
        <span className={styles.who}>{first ? who(first) : null}</span>
        <span className={styles.meta}>{t.state[thread.state]}</span>
      </header>
      {thread.anchor ? <p className={styles.quote}>„{thread.anchor.quote}”</p> : null}
      {range ? null : <p className={styles.notPlaced}>{t.notPlaced}</p>}
      {first ? <p className={styles.body}>{first.body}</p> : null}
      {first ? <p className={styles.when}>{formatDateTimeHr(first.createdWindow)}</p> : null}
      {replies.map((reply) => (
        <div key={reply.id} className={styles.reply}>
          <span className={styles.who}>{who(reply)}</span>
          <p className={styles.body}>{reply.body}</p>
        </div>
      ))}
      {range ? (
        <button type="button" className={styles.link} onClick={show}>{t.showInText}</button>
      ) : null}
      {thread.state === "resolved" ? (
        <p className={styles.note}>{t.resolvedNote}</p>
      ) : (
        <form className={styles.form} onSubmit={(event) => void send(event)}>
          <textarea
            rows={2}
            aria-label={t.replyLabel}
            placeholder={t.replyPlaceholder}
            maxLength={2000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKey}
          />
          <button type="submit" className={styles.send} disabled={sending || draft.trim() === ""}>
            {sending ? t.replying : t.reply}
          </button>
          {error ? <p role="alert" className={styles.error}>{t.replyErrors[error]}</p> : null}
        </form>
      )}
    </article>
  );
}

export default function CommentPanel({ documentId }: { documentId: string }) {
  const editor = useLocalEditor();
  const stopped = useLocalSignedOut();
  const [outcome, setOutcome] = useState<ListOutcome | null>(null);
  // Bumped by every load and by the stop: an answer for an older request, or
  // one that lands after the session ended, is dropped (F-088).
  const generation = useRef(0);
  const stoppedRef = useRef(false);

  const load = useCallback(async () => {
    if (stoppedRef.current) return;
    const mine = ++generation.current;
    const result = await listComments(documentId);
    if (mine === generation.current && !stoppedRef.current) setOutcome(result);
  }, [documentId]);
  useEffect(() => { void load(); }, [load]);

  // The session ended (D-118): forget the threads; the cards, and with them
  // any typed reply, are no longer rendered.
  useEffect(() => {
    if (!stopped) return;
    stoppedRef.current = true;
    generation.current += 1;
    setOutcome(null);
  }, [stopped]);

  // The highlight lives as long as this panel; it never enters the document.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.registerPlugin(commentHighlightPlugin());
    return () => { if (!editor.isDestroyed) editor.unregisterPlugin(commentHighlightKey); };
  }, [editor]);

  const threads = !stopped && outcome?.kind === "ok" ? outcome.threads : [];
  // Placed again on every change of the text, so an edited paragraph never keeps a stale place.
  const placed = useEditorState({ editor, selector: ({ editor: e }) => placeAll(e, threads) }) ?? placeAll(null, threads);

  const ranges = placed.flatMap((p) => (p.range && p.thread.state !== "resolved" ? [p.range] : []));
  const key = JSON.stringify(ranges);
  useEffect(() => {
    if (!editor || editor.isDestroyed || !commentHighlightKey.get(editor.state)) return;
    editor.view.dispatch(editor.state.tr.setMeta(commentHighlightKey, JSON.parse(key) as CommentRange[]).setMeta("addToHistory", false));
  }, [editor, key]);

  let body;
  if (stopped) body = <p className="rail-empty" role="status">{t.signedOut}</p>;
  else if (outcome === null) body = <p className="rail-empty">{t.loading}</p>;
  else if (outcome.kind === "forbidden") body = <p className="rail-empty">{t.notAvailable}</p>;
  else if (outcome.kind !== "ok") body = <p className="rail-empty" role="status">{t[outcome.kind]}</p>;
  else if (placed.length === 0) body = <p className="rail-empty">{t.empty}</p>;
  else body = placed.map((p) => <ThreadCard key={p.thread.id} placed={p} editor={editor} onReplied={() => void load()} />);

  return (
    <section className="rail-section" aria-labelledby="comments-title">
      <h2 id="comments-title" className="rail-section__title">
        {t.title}
        <span className="rail-section__count">{threads.length > 0 ? threads.length : null}</span>
      </h2>
      <div className={styles.list}>{body}</div>
      <p className={styles.note}>{t.note}</p>
      {stopped ? null : <button type="button" className={styles.link} onClick={() => void load()}>{t.refresh}</button>}
    </section>
  );
}
