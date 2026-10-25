"use client";

/**
 * The live text of one work in its sheet: the connection line, the text with
 * the marks of the unresolved comments, and the note beside a shown text.
 * The teacher's view and the student's "Kako vidi nastavnik" (#732 item 7)
 * both draw it through this one component, from the same `GET /api/live/<id>`
 * and the same comment list, so the student sees the text exactly as the
 * teacher does (PRODUCT §5 rule 5). Only the teacher passes `onSelect`.
 */

import type { ReactNode } from "react";

import type { LiveView } from "@/client/live-reader";
import SheetFrame from "@/components/shell/SheetFrame";

import { placeThreads } from "./comment-place";
import { LiveChip, LiveDocument, LiveNote, liveStopped, type LiveDocumentProps } from "./live-text";
import { useComments, type PlacedThread } from "./TeacherComments";

export { useLiveView } from "./live-text";

/** The comments of the work, placed again against every new state of the text. */
export function useLiveMarks(documentId: string, view: LiveView, current: () => boolean) {
  const stopped = liveStopped(view);
  const comments = useComments(documentId, current, !stopped);
  const threads = !stopped && comments.outcome?.kind === "ok" ? comments.outcome.threads : [];
  // An edited paragraph never keeps a stale place.
  const placed: PlacedThread[] = placeThreads(view.document, threads);
  const marks = placed.flatMap((p) => (p.range && p.thread.state !== "resolved" ? [p.range] : []));
  return { comments, placed, marks, stopped };
}

/** `heading`: the sheet's own title, outside the text region. */
export default function LiveText({ heading, ...document }: LiveDocumentProps & { heading?: ReactNode }) {
  return (
    <>
      <LiveChip view={document.view} />
      <SheetFrame>
        {heading}
        <LiveDocument {...document} />
      </SheetFrame>
      <LiveNote view={document.view} />
    </>
  );
}
