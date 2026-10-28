"use client";

/**
 * The teacher's live view of one work (DAN-86 steps 2b and 2c, D-142; route
 * GET /api/live/<id>, BACKEND 4.12). The text is the last state the student
 * published, read through one `startLiveReader`, which shows only the exact
 * document its ETag names. It is rendered as React text, read-only: nothing
 * here writes to the document (D-34). The connection line speaks about this
 * page's own requests, never about the student (4.12 t. 8). The teacher marks
 * a passage to comment on it (B-10); a comment is shown as a mark over the
 * text, never inside the document. Beside the text stands what the record
 * cannot show (K-3, D-80 point 3). The text itself is drawn only by
 * `LiveText`, which the student's "Kako vidi nastavnik" view shares.
 */

import { useRef, useState } from "react";

import type { SessionMark } from "@/client/session-marks";
import type { TextAnchor } from "@/domain/collaboration";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { anchorForSelection, placeThreads, type TextRange } from "./comment-place";
import LiveText, { liveStopped, openMarks, useLiveView } from "./LiveText";
import styles from "./LiveWorkView.module.css";
import RecordLimits from "./RecordLimits";
import { selectedRange, selectInBlock } from "./selection";
import SummaryCard from "./SummaryCard";
import TeacherComments, { useComments, type PlacedThread } from "./TeacherComments";

const t = messagesHr.liveView;

export default function LiveWorkView({ documentId, session }: {
  documentId: string; session: SessionMark | null;
}) {
  const { view, current } = useLiveView(documentId, session);
  const stopped = liveStopped(view);
  const comments = useComments(documentId, current, !stopped);
  const [draft, setDraft] = useState<TextAnchor | null>(null);
  const textRef = useRef<HTMLDivElement>(null);

  const threads = !stopped && comments.outcome?.kind === "ok" ? comments.outcome.threads : [];
  // Placed again against every new state of the text: an edited paragraph never keeps a stale place.
  const placed: PlacedThread[] = placeThreads(view.document, threads);
  const marks = openMarks(placed);

  // The anchor is made from the text on screen, so it never carries text the teacher has not seen (attack 8).
  const takeSelection = () => {
    const root = textRef.current;
    if (!root || !view.document) return;
    const range = selectedRange(root, window.getSelection());
    const anchor = range && anchorForSelection(view.document, range.nodeId, range.start, range.end);
    if (anchor) setDraft(anchor);
  };
  const show = (range: TextRange) => {
    if (textRef.current) selectInBlock(textRef.current, range.nodeId, range.start, range.end);
  };

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <LiveText view={view} marks={marks} textRef={textRef} onSelect={takeSelection} />
      </div>
      <aside className={styles.aside} aria-label={t.sidePanel}>
        {stopped ? null : (
          <TeacherComments
            documentId={documentId}
            outcome={comments.outcome}
            placed={placed}
            draft={draft}
            current={current}
            onReload={() => void comments.load()}
            onDraftDone={() => setDraft(null)}
            onShow={show}
          />
        )}
        {stopped ? null : <SummaryCard documentId={documentId} current={current} />}
        <RecordLimits />
      </aside>
    </div>
  );
}
