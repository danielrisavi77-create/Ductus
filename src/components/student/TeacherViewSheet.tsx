"use client";

/**
 * The student's "Kako vidi nastavnik" view on /rad (#732 item 7, contract
 * 6396547184 §2 and 6404284308). The text, the comment marks, the process
 * summary and what the record cannot show are drawn by the teacher's own
 * components from the same routes (`LiveText`, `SummaryCard`,
 * `RecordLimits`), so the student sees what the teacher sees (PRODUCT §5
 * rule 5). Only reads: no selection, no new comment, nothing written. The
 * teacher has the summary and the limits beside the text; here they stand
 * under it, because the student's right panel stays as in writing.
 */

import { useEffect, useRef, type ReactNode } from "react";

import { handleShowInText, onCommentsLoaded } from "@/client/comments-bridge";
import type { SessionMark } from "@/client/session-marks";
import { placeThreads } from "@/components/teacher/comment-place";
import LiveText, { liveStopped, openMarks, useLiveView } from "@/components/teacher/LiveText";
import RecordLimits from "@/components/teacher/RecordLimits";
import { selectInBlock } from "@/components/teacher/selection";
import SummaryCard from "@/components/teacher/SummaryCard";
import { useComments } from "@/components/teacher/TeacherComments";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import styles from "./TeacherViewSheet.module.css";

export default function TeacherViewSheet({ documentId, session, heading }: {
  /** Only `plan.journal.documentId` of an `assignment` plan (B1), never the address. */
  documentId: string;
  session: SessionMark | null;
  /** The sheet's h1, the same as in writing. */
  heading: ReactNode;
}) {
  const { view, current } = useLiveView(documentId, session);
  const stopped = liveStopped(view);
  const comments = useComments(documentId, current, !stopped);
  // The marks follow the comment panel beside them: when the panel reads the
  // comments again, so do the marks, so the list and the text agree.
  const reload = comments.load;
  useEffect(() => onCommentsLoaded(documentId, () => void reload()), [documentId, reload]);
  const threads = !stopped && comments.outcome?.kind === "ok" ? comments.outcome.threads : [];
  const placed = placeThreads(view.document, threads);
  const marks = openMarks(placed);
  // "Prikaži u tekstu" in the panel shows the passage in this text, placed
  // against what is on screen, as the teacher's own button does; a heading
  // of the outline brings that heading of this text into view.
  const textRef = useRef<HTMLDivElement>(null);
  const placedRef = useRef(placed);
  placedRef.current = placed;
  useEffect(() => handleShowInText(documentId, (target) => {
    const root = textRef.current;
    if (!root) return;
    if ("threadId" in target) {
      const range = placedRef.current.find((p) => p.thread.id === target.threadId)?.range;
      if (range) selectInBlock(root, range.nodeId, range.start, range.end);
      return;
    }
    [...root.querySelectorAll<HTMLElement>("[data-node-id]")]
      .find((el) => el.dataset.nodeId === target.nodeId)?.scrollIntoView({ block: "start" });
  }), [documentId]);

  return (
    <div className="sheet-area">
      <p className={`sheet-note ${styles.lead}`}>{t.workspace.teacherViewLead}</p>
      <LiveText view={view} marks={marks} heading={heading} textRef={textRef} />
      <div className={styles.after}>
        {stopped ? null : <SummaryCard documentId={documentId} current={current} />}
        <RecordLimits />
      </div>
    </div>
  );
}
