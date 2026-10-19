"use client";

/**
 * Comments next to a paragraph from the teacher's live view (DAN-86 step 2c;
 * route and RPCs: B-10, BACKEND 4.11; design pregled-radova-v2 "Novi
 * komentar"). The teacher marks text in the live document and writes a
 * comment; the anchor is made from the text the teacher sees, never from a
 * newer one (attack 8). Each thread is placed again against every new state
 * of the text; a place that cannot be found reliably stays in the list with
 * a note, never at a guessed place (attack 7). Text is React text, never
 * HTML (attack 10). The list is the same `list_comments` the student reads
 * (PRODUCT §5 rule 5).
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  changeThreadState, createComment, listComments, replyComment,
  type CommentThread, type CreateOutcome, type ListOutcome, type ReplyOutcome,
} from "@/client/comments";
import type { TextAnchor } from "@/domain/collaboration";
import { formatDateTimeHr } from "@/lib/i18n/hr";
import { messagesHr } from "@/lib/i18n/messages.hr";

import type { TextRange } from "./comment-place";
import styles from "./LiveWorkView.module.css";

const t = messagesHr.comments;
const tt = messagesHr.teacherComments;

export type PlacedThread = { thread: CommentThread; range: TextRange | null };

function ThreadCard({ placed, current, onChanged, onShow }: {
  placed: PlacedThread; current: () => boolean; onChanged: () => void; onShow: (range: TextRange) => void;
}) {
  const { thread, range } = placed;
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Exclude<ReplyOutcome, "ok"> | null>(null);
  const [first, ...replies] = thread.comments;

  const act = async (run: () => Promise<ReplyOutcome>) => {
    if (busy) return;
    setBusy(true);
    const outcome = await run();
    setBusy(false);
    if (outcome !== "ok") return setError(outcome);
    setDraft("");
    setError(null);
    onChanged();
  };
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim() !== "") void act(() => replyComment(thread.id, draft, current));
  };

  return (
    <article className={styles.thread} aria-label={t.number.replace("{n}", String(thread.number))}>
      <header className={styles.threadHead}>
        <span>{thread.number}</span>
        <span>{t.state[thread.state]}</span>
      </header>
      {thread.anchor ? <p className={styles.quote}>„{thread.anchor.quote}”</p> : null}
      {range ? null : <p className={styles.muted}>{t.notPlaced}</p>}
      {first ? <p>{first.body}</p> : null}
      {first ? <p className={styles.muted}>{formatDateTimeHr(first.createdWindow)}</p> : null}
      {replies.map((reply) => (
        <p key={reply.id} className={styles.reply}>
          <span className={styles.muted}>{reply.isOwn ? t.own : reply.role === "teacher" ? t.teacher : t.student}</span>{" "}
          {reply.body}
        </p>
      ))}
      <div className={styles.actions}>
        {range ? <button type="button" className={styles.link} onClick={() => onShow(range)}>{t.showInText}</button> : null}
        {thread.state === "resolved" ? (
          <button type="button" className={styles.link} disabled={busy}
            onClick={() => void act(() => changeThreadState(thread.id, "reopen", current))}>{tt.reopen}</button>
        ) : (
          <button type="button" className={styles.link} disabled={busy}
            onClick={() => void act(() => changeThreadState(thread.id, "resolve", current))}>{tt.resolve}</button>
        )}
      </div>
      {thread.state === "resolved" ? null : (
        <form className={styles.form} onSubmit={send}>
          <textarea rows={2} aria-label={t.replyLabel} placeholder={t.replyPlaceholder} maxLength={2000}
            value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" className="btn" disabled={busy || draft.trim() === ""}>{busy ? t.replying : t.reply}</button>
        </form>
      )}
      {error ? <p role="alert" className={styles.error}>{t.replyErrors[error]}</p> : null}
    </article>
  );
}

/** The new comment on a marked passage; `anchor` comes from the text on screen. */
function NewComment({ documentId, anchor, current, onDone }: {
  documentId: string; anchor: TextAnchor; current: () => boolean; onDone: (created: boolean) => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Exclude<CreateOutcome, "ok"> | null>(null);
  const publish = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || body.trim() === "") return;
    setBusy(true);
    const outcome = await createComment(documentId, body, anchor, current);
    setBusy(false);
    if (outcome === "ok") return onDone(true);
    setError(outcome);
  };
  return (
    <form className={styles.newComment} onSubmit={(event) => void publish(event)} aria-labelledby="new-comment-title">
      <h3 id="new-comment-title">{tt.newTitle}</h3>
      <p className={styles.quote}>„{anchor.quote}”</p>
      <textarea rows={3} aria-label={tt.bodyLabel} maxLength={2000} value={body}
        onChange={(event) => setBody(event.target.value)} />
      <div className={styles.actions}>
        <button type="submit" className="btn" disabled={busy || body.trim() === ""}>{busy ? tt.publishing : tt.publish}</button>
        <button type="button" className={styles.link} onClick={() => onDone(false)}>{tt.cancel}</button>
      </div>
      {error ? <p role="alert" className={styles.error}>{tt.errors[error]}</p> : null}
    </form>
  );
}

export function useComments(documentId: string, current: () => boolean, active: boolean) {
  const [outcome, setOutcome] = useState<ListOutcome | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    if (!active || !current()) return;
    const mine = ++generation.current;
    const result = await listComments(documentId, current);
    if (mine === generation.current) setOutcome(result);
  }, [documentId, current, active]);
  useEffect(() => {
    if (active) void load();
    else { generation.current += 1; setOutcome(null); }
  }, [load, active]);
  return { outcome, load };
}

export default function TeacherComments({ documentId, outcome, placed, draft, current, onReload, onDraftDone, onShow }: {
  documentId: string;
  outcome: ListOutcome | null;
  placed: PlacedThread[];
  draft: TextAnchor | null;
  current: () => boolean;
  onReload: () => void;
  onDraftDone: () => void;
  onShow: (range: TextRange) => void;
}) {
  let list;
  if (outcome === null) list = <p className={styles.muted}>{t.loading}</p>;
  else if (outcome.kind === "forbidden") list = <p className={styles.muted}>{t.notAvailable}</p>;
  else if (outcome.kind !== "ok") list = <p className={styles.muted} role="status">{t[outcome.kind]}</p>;
  else if (placed.length === 0) list = <p className={styles.muted}>{tt.empty}</p>;
  else list = placed.map((p) => <ThreadCard key={p.thread.id} placed={p} current={current} onChanged={onReload} onShow={onShow} />);

  return (
    <section className={styles.comments} aria-labelledby="teacher-comments-title">
      <h2 id="teacher-comments-title">{t.title}</h2>
      {draft ? (
        <NewComment key={`${draft.nodeId}:${draft.startHint}:${draft.endHint}`} documentId={documentId} anchor={draft} current={current}
          onDone={(created) => { onDraftDone(); if (created) onReload(); }} />
      ) : <p className={styles.muted}>{tt.hint}</p>}
      {list}
      <p className={styles.muted}>{t.note}</p>
      <button type="button" className={styles.link} onClick={onReload}>{t.refresh}</button>
    </section>
  );
}
