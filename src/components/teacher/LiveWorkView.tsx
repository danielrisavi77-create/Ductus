"use client";

/**
 * The teacher's live view of one work (DAN-86 step 2b, D-142; route GET
 * /api/live/<id>, BACKEND 4.12). The text is the last state the student
 * published, read through one `startLiveReader`, which shows only the exact
 * document its ETag names. It is rendered as React text, read-only: nothing
 * here writes to the document (D-34). The connection line speaks about this
 * page's own requests, never about the student (4.12 t. 8). Beside the text
 * stands what the record cannot show (K-3, D-80 point 3).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { startLiveReader, type LiveView } from "@/client/live-reader";
import { watchSessionEnd, type SessionWatch } from "@/client/session-end";
import type { SessionMark } from "@/client/session-marks";
import SheetFrame from "@/components/shell/SheetFrame";
import type { DocumentNode, InlineNode } from "@/domain/document";
import { messagesHr } from "@/lib/i18n/messages.hr";

import styles from "./LiveWorkView.module.css";
import RecordLimits from "./RecordLimits";

const t = messagesHr.liveView;

const INITIAL: LiveView = { document: null, hash: null, empty: false, connection: "loading" };

const TONE: Record<LiveView["connection"], string> = {
  loading: "progress", live: "ok", retrying: "warn", paused: "warn", signedOut: "error", notFound: "error",
};

function Inline({ node }: { node: InlineNode }) {
  let content: ReactNode = node.text;
  if (node.marks.includes("italic")) content = <em>{content}</em>;
  if (node.marks.includes("bold")) content = <strong>{content}</strong>;
  return <>{content}</>;
}

function Block({ node }: { node: DocumentNode }) {
  const children = node.children.map((child, i) => <Inline key={i} node={child} />);
  if (node.type === "paragraph") return <p data-node-id={node.id}>{children}</p>;
  // The page has its own h1, so the work's levels 1 to 3 are h2 to h4.
  const Heading = node.level === 1 ? "h2" : node.level === 2 ? "h3" : "h4";
  return <Heading data-node-id={node.id}>{children}</Heading>;
}

/** The live state of `documentId` while mounted; stops for good once the session ends here. */
function useLiveView(documentId: string, session: SessionMark | null): LiveView {
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
  const current = useCallback(() => !(watchRef.current?.ended() ?? false), []);
  useEffect(() => {
    if (ended) return;
    return startLiveReader({ documentId, onChange: setView, current });
  }, [documentId, current, ended]);
  // D-118: once the session has ended in this browser the text is gone from the page.
  return ended ? { ...INITIAL, connection: "signedOut" } : view;
}

export default function LiveWorkView({ documentId, session }: {
  documentId: string; session: SessionMark | null;
}) {
  const view = useLiveView(documentId, session);
  const stopped = view.connection === "signedOut" || view.connection === "notFound";

  let text: ReactNode;
  if (stopped) text = <p className="manuscript__placeholder">{t.connection[view.connection]}</p>;
  else if (view.document) text = view.document.nodes.map((node) => <Block key={node.id} node={node} />);
  else text = <p className="manuscript__placeholder">{view.empty ? t.empty : t.loading}</p>;

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
            className={`manuscript ${styles.text}`}
            role="document"
            aria-label={t.documentLabel}
            aria-busy={view.connection === "loading"}
          >
            {text}
          </div>
        </SheetFrame>
        {/* The note speaks about a shown text, so it stands only beside one. */}
        {!stopped && view.document ? <p className={styles.note}>{t.note}</p> : null}
      </div>
      <aside className={styles.aside} aria-labelledby="record-limits-title">
        <RecordLimits />
      </aside>
    </div>
  );
}
