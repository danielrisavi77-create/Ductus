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
 * cannot show (K-3, D-80 point 3).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { startLiveReader, type LiveView } from "@/client/live-reader";
import { watchSessionEnd, type SessionWatch } from "@/client/session-end";
import type { SessionMark } from "@/client/session-marks";
import SheetFrame from "@/components/shell/SheetFrame";
import type { TextAnchor } from "@/domain/collaboration";
import type { DocumentNode } from "@/domain/document";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { anchorForSelection, blockSegments, placeAnchor, type TextRange } from "./comment-place";
import styles from "./LiveWorkView.module.css";
import RecordLimits from "./RecordLimits";
import { selectedRange, selectInBlock } from "./selection";
import TeacherComments, { useComments, type PlacedThread } from "./TeacherComments";

const t = messagesHr.liveView;

const INITIAL: LiveView = { document: null, hash: null, empty: false, connection: "loading" };

const TONE: Record<LiveView["connection"], string> = {
  loading: "progress", live: "ok", retrying: "warn", paused: "warn", signedOut: "error", notFound: "error",
};

function Block({ node, ranges }: { node: DocumentNode; ranges: readonly TextRange[] }) {
  const children = blockSegments(node, ranges).map((segment, i) => {
    let content: ReactNode = segment.text;
    if (segment.marks.includes("italic")) content = <em>{content}</em>;
    if (segment.marks.includes("bold")) content = <strong>{content}</strong>;
    return segment.marked ? <mark key={i} className={styles.mark}>{content}</mark> : <span key={i}>{content}</span>;
  });
  if (node.type === "paragraph") return <p data-node-id={node.id}>{children}</p>;
  // The page has its own h1, so the work's levels 1 to 3 are h2 to h4.
  const Heading = node.level === 1 ? "h2" : node.level === 2 ? "h3" : "h4";
  return <Heading data-node-id={node.id}>{children}</Heading>;
}

/** The live state of `documentId` while mounted; stops for good once the session ends here. */
function useLiveView(documentId: string, session: SessionMark | null) {
  const [view, setView] = useState<LiveView>(INITIAL);
  const [ended, setEnded] = useState(false);
  const watchRef = useRef<SessionWatch | null>(null);
  const tag = session?.tag ?? null;
  const at = session?.at ?? 0;
  useEffect(() => {
    const watch = watchSessionEnd(tag === null ? null : { tag, at }, () => setEnded(true));
    watchRef.current = watch;
    return () => {
      watch.close();
      if (watchRef.current === watch) watchRef.current = null;
    };
  }, [tag, at]);
  // Asked right before every request: false once the session has ended (F-093).
  const current = useCallback(() => !(watchRef.current?.ended() ?? false), []);
  useEffect(() => {
    if (ended) return;
    return startLiveReader({ documentId, onChange: setView, current });
  }, [documentId, current, ended]);
  // D-118: once the session has ended in this browser the text is gone from the page.
  return { view: ended ? { ...INITIAL, connection: "signedOut" as const } : view, current };
}

export default function LiveWorkView({ documentId, session }: {
  documentId: string; session: SessionMark | null;
}) {
  const { view, current } = useLiveView(documentId, session);
  const stopped = view.connection === "signedOut" || view.connection === "notFound";
  const comments = useComments(documentId, current, !stopped);
  const [draft, setDraft] = useState<TextAnchor | null>(null);
  const textRef = useRef<HTMLDivElement>(null);

  const threads = !stopped && comments.outcome?.kind === "ok" ? comments.outcome.threads : [];
  // Placed again against every new state of the text: an edited paragraph never keeps a stale place.
  const placed: PlacedThread[] = threads.map((thread) => ({ thread, range: placeAnchor(view.document, thread.anchor) }));
  const marks = placed.flatMap((p) => (p.range && p.thread.state !== "resolved" ? [p.range] : []));

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

  let text: ReactNode;
  if (stopped) text = <p className="manuscript__placeholder">{t.connection[view.connection]}</p>;
  else if (view.document) {
    text = view.document.nodes.map((node) => (
      <Block key={node.id} node={node} ranges={marks.filter((r) => r.nodeId === node.id)} />
    ));
  } else text = <p className="manuscript__placeholder">{view.empty ? t.empty : t.loading}</p>;

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <p className={styles.status}>
          <span className="sync-chip" data-tone={TONE[view.connection]} role="status">
            <span className="sync-chip__dot" aria-hidden="true" />
            {t.connection[view.connection]}
          </span>
        </p>
        <SheetFrame>
          <div
            ref={textRef}
            className={`manuscript ${styles.text}`}
            role="document"
            aria-label={t.documentLabel}
            aria-busy={view.connection === "loading"}
            onMouseUp={takeSelection}
            onKeyUp={takeSelection}
          >
            {text}
          </div>
        </SheetFrame>
        {/* The note speaks about a shown text, so it stands only beside one. */}
        {!stopped && view.document ? <p className={styles.note}>{t.note}</p> : null}
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
        <RecordLimits />
      </aside>
    </div>
  );
}
