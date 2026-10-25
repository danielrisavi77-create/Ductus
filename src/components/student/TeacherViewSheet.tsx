"use client";

/**
 * "Kako vidi nastavnik" on `/rad` (#732 item 7, contract 6396547184): the
 * student's own work as the teacher sees it on `/nastavnik/rad/<id>`. The
 * text, the marks of the comments, the connection line, the note, the
 * process summary and what the record cannot show are drawn by the same
 * components as there (`LiveText`, `SummaryCard`, `RecordLimits`), from the
 * same routes, so the student sees exactly what the teacher sees (PRODUCT §5
 * rule 5). Nothing here writes: no editor, no new comment, no request for a
 * revision. `documentId` comes only from the page's plan (B1 read).
 */

import type { ReactNode } from "react";

import type { SessionMark } from "@/client/session-marks";
import LiveText, { useLiveMarks, useLiveView } from "@/components/teacher/LiveText";
import RecordLimits from "@/components/teacher/RecordLimits";
import SummaryCard from "@/components/teacher/SummaryCard";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

export default function TeacherViewSheet({ documentId, session, heading }: {
  documentId: string; session: SessionMark | null; heading: ReactNode;
}) {
  const { view, current } = useLiveView(documentId, session);
  const { marks, stopped } = useLiveMarks(documentId, view, current);
  return (
    <>
      <p className="teacher-view__lead">{t.workspace.teacherViewLead}</p>
      <LiveText view={view} marks={marks} heading={heading} />
      <div className="teacher-view__cards">
        {stopped ? null : <SummaryCard documentId={documentId} current={current} />}
        <RecordLimits />
      </div>
    </>
  );
}
