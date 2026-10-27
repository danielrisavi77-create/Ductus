"use client";

/**
 * The teacher's live view of one work (DAN-86 steps 2b and 2c, D-142; route
 * GET /api/live/<id>, BACKEND 4.12), drawn as the Archivum T05 (DAN-344,
 * #923 contract 6430008106 §4). The text is the last state the student
 * published, read through one `startLiveReader`, which shows only the exact
 * document its ETag names. It is rendered as React text, read-only: nothing
 * here writes to the document (D-34). The connection line speaks about this
 * page's own requests, never about the student (4.12 t. 8). The teacher marks
 * a passage to comment on it (B-10); a comment is shown as a mark over the
 * text, never inside the document. At the foot stands what the record
 * cannot show (K-3, D-80 point 3). The text itself is drawn only by
 * `LiveText`, which the student's "Kako vidi nastavnik" view shares.
 *
 * The header names the course, the assignment and the student only from the
 * page's own reads (`LiveContext`) and the fast path read of the same
 * assignment; without them the page is "Rad uživo", as before.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { fetchFastPath } from "@/client/fast-path";
import type { SessionMark } from "@/client/session-marks";
import type { TextAnchor } from "@/domain/collaboration";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { anchorForSelection, placeThreads, type TextRange } from "./comment-place";
import { liveOutline, sectionHeading, studentName, submittedParts, type LiveContext } from "./live-context";
import { LiveHeader, LiveRail } from "./LiveHeader";
import LiveText, { LiveStatus, liveStopped, liveSubmitted, openMarks, useLiveView } from "./LiveText";
import styles from "./LiveWorkView.module.css";
import RecordLimits from "./RecordLimits";
import { selectedRange, selectInBlock } from "./selection";
import SummaryCard from "./SummaryCard";
import TeacherComments, { useComments, type PlacedThread } from "./TeacherComments";

const t = messagesHr.liveView;

type Tab = "text" | "summary";
const TABS: readonly Tab[] = ["text", "summary"];

/** The student's name, read once from the fast path of the assignment; gone once the view stops (D-118). */
function useStudentName(context: LiveContext | null, current: () => boolean, active: boolean): string | null {
  const [name, setName] = useState<string | null>(null);
  const assignmentId = context?.assignmentId ?? null;
  const studentId = context?.studentId ?? null;
  useEffect(() => {
    if (!assignmentId || !studentId || !active) {
      setName(null);
      return;
    }
    let live = true;
    void fetchFastPath(assignmentId, current).then((read) => {
      if (live) setName(read.kind === "ok" ? studentName(read.students, studentId) : null);
    });
    return () => { live = false; };
  }, [assignmentId, studentId, current, active]);
  return name;
}

export default function LiveWorkView({ documentId, session, context = null }: {
  documentId: string; session: SessionMark | null; context?: LiveContext | null;
}) {
  const { view, current } = useLiveView(documentId, session);
  const stopped = liveStopped(view);
  const comments = useComments(documentId, current, !stopped);
  const [draft, setDraft] = useState<TextAnchor | null>(null);
  const [tab, setTab] = useState<Tab>("text");
  const textRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ text: null, summary: null });
  const name = useStudentName(context, current, !stopped);

  const threads = !stopped && comments.outcome?.kind === "ok" ? comments.outcome.threads : [];
  // Placed again against every new state of the text: an edited paragraph never keeps a stale place.
  const placed: PlacedThread[] = placeThreads(view.document, threads);
  const marks = openMarks(placed);
  const outline = stopped ? [] : liveOutline(view.document);
  // T06: only the live route's own "submitted" makes this the submitted revision (D-169 t. 2).
  const submitted = liveSubmitted(view);
  const recorded = submitted ? submittedParts(context) : null;

  // The anchor is made from the text on screen, so it never carries text the teacher has not seen (attack 8).
  const takeSelection = () => {
    const root = textRef.current;
    if (!root || !view.document) return;
    const range = selectedRange(root, window.getSelection());
    const anchor = range && anchorForSelection(view.document, range.nodeId, range.start, range.end);
    if (anchor) setDraft(anchor);
  };
  const show = (range: TextRange) => {
    setTab("text");
    if (textRef.current) selectInBlock(textRef.current, range.nodeId, range.start, range.end);
  };
  // Arrow keys move between the tabs (WAI-ARIA tabs pattern).
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  const tabLabel: Record<Tab, string> = { text: t.documentLabel, summary: t.tabSummary };

  return (
    <div className={styles.frame}>
      <LiveHeader context={context} name={name} submitted={submitted} />
      <div className={styles.layout}>
        <LiveRail context={context} outline={outline} onPick={() => setTab("text")} />
        <div className={styles.main}>
          <div className={styles.tabsRow}>
            <div role="tablist" aria-label={t.tabsLabel} className={styles.tabs}>
              {TABS.map((id) => (
                <button key={id} type="button" role="tab" id={`live-tab-${id}`} aria-controls={`live-panel-${id}`}
                  aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} className={styles.tab}
                  ref={(el) => { tabRefs.current[id] = el; }} onClick={() => setTab(id)} onKeyDown={onTabKey}>
                  {tabLabel[id]}
                </button>
              ))}
            </div>
            <LiveStatus view={view} label={t.liveLabel} />
          </div>
          <div role="tabpanel" id="live-panel-text" aria-labelledby="live-tab-text" hidden={tab !== "text"}>
            <LiveText view={view} marks={marks} textRef={textRef} onSelect={takeSelection} bare />
          </div>
          <div role="tabpanel" id="live-panel-summary" aria-labelledby="live-tab-summary" hidden={tab !== "summary"}>
            {stopped ? null : <SummaryCard documentId={documentId} current={current} />}
          </div>
        </div>
        <aside className={styles.aside} aria-label={t.sidePanel}>
          {stopped ? null : (
            <TeacherComments
              documentId={documentId}
              outcome={comments.outcome}
              placed={placed}
              draft={draft}
              draftSection={draft ? sectionHeading(view.document, draft.nodeId) : null}
              current={current}
              onReload={() => void comments.load()}
              onDraftDone={() => setDraft(null)}
              onShow={show}
            />
          )}
        </aside>
      </div>
      <footer className={styles.foot}>
        {/* The note speaks about a shown text, so it stands only beside one. */}
        {!stopped && view.document
          ? <p className={styles.note}>{submitted ? recorded?.note ?? t.submittedText : t.note}</p>
          : <span />}
        <RecordLimits folded />
      </footer>
    </div>
  );
}
