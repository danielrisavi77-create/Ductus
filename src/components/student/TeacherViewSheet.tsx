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

import type { ReactNode } from "react";

import type { SessionMark } from "@/client/session-marks";
import { placeThreads } from "@/components/teacher/comment-place";
import LiveText, { liveStopped, openMarks, useLiveView } from "@/components/teacher/LiveText";
import RecordLimits from "@/components/teacher/RecordLimits";
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
  const threads = !stopped && comments.outcome?.kind === "ok" ? comments.outcome.threads : [];
  const marks = openMarks(placeThreads(view.document, threads));

  return (
    <div className="sheet-area">
      <p className={`sheet-note ${styles.lead}`}>{t.workspace.teacherViewLead}</p>
      <LiveText view={view} marks={marks} heading={heading} />
      <div className={styles.after}>
        {stopped ? null : <SummaryCard documentId={documentId} current={current} />}
        <RecordLimits />
      </div>
    </div>
  );
}
