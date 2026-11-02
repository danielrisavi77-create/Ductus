"use client";

/**
 * The live text of one work as its teacher sees it (DAN-86, D-142; route
 * GET /api/live/<id>, BACKEND 4.12), and the only place that draws it. The
 * teacher's `LiveWorkView` and the student's "Kako vidi nastavnik" view on
 * /rad (#732 item 7) both render it, so the student sees the same text drawn
 * by the same code (PRODUCT §5 rule 5). The text is the last state the
 * student published, read through one `startLiveReader`, which shows only
 * the exact document its ETag names. It is React text, read-only: nothing
 * here writes to the document (D-34). The connection line speaks about this
 * page's own requests, never about the student (4.12 t. 8). Written with
 * `createElement` like `SummaryCard`, so the unit test renders it.
 */

import {
  createElement as h, Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref,
} from "react";

import { startLiveReader, type LiveView } from "@/client/live-reader";
import { watchSessionEnd, type SessionWatch } from "@/client/session-end";
import type { SessionMark } from "@/client/session-marks";
import { blockRuns } from "@/components/shell/manuscript-blocks";
import SheetFrame from "@/components/shell/SheetFrame";
import type { DocumentNode } from "@/domain/document";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { blockSegments, type TextRange } from "./comment-place";
import styles from "./LiveWorkView.module.css";
import type { PlacedThread } from "./TeacherComments";

const t = messagesHr.liveView;

const INITIAL: LiveView = { document: null, hash: null, empty: false, connection: "loading", submitted: false };

const TONE: Record<LiveView["connection"], string> = {
  loading: "progress", live: "ok", retrying: "warn", paused: "warn", signedOut: "error", notFound: "error",
};

/** True once nothing more is shown: the session ended here or the work is not this account's. */
export function liveStopped(view: LiveView): boolean {
  return view.connection === "signedOut" || view.connection === "notFound";
}

/** The ranges marked over the text: every placed comment thread that is not resolved. */
export function openMarks(placed: readonly PlacedThread[]): TextRange[] {
  return placed.flatMap((p) => (p.range && p.thread.state !== "resolved" ? [p.range] : []));
}

function Block({ node, ranges }: { node: DocumentNode; ranges: readonly TextRange[] }) {
  const children = blockSegments(node, ranges).map((segment, i) => {
    let content: ReactNode = segment.text;
    if (segment.marks.includes("italic")) content = h("em", null, content);
    if (segment.marks.includes("bold")) content = h("strong", null, content);
    return segment.marked ? h("mark", { key: i, className: styles.mark }, content) : h("span", { key: i }, content);
  });
  if (node.type === "paragraph" || node.type === "quote") return h("p", { "data-node-id": node.id }, ...children);
  if (node.type === "bulletItem") return h("li", { "data-node-id": node.id }, ...children);
  // The page has its own h1, so the work's levels 1 to 3 are h2 to h4.
  const heading = node.level === 1 ? "h2" : node.level === 2 ? "h3" : "h4";
  return h(heading, { "data-node-id": node.id }, ...children);
}

/** The live state of `documentId` while mounted; stops for good once the session ends here. */
export function useLiveView(documentId: string, session: SessionMark | null) {
  const [view, setView] = useState<LiveView>(INITIAL);
  const [ended, setEnded] = useState(false);
  const watchRef = useRef<SessionWatch | null>(null);
  const tag = session?.tag ?? null;
  const at = session?.at ?? 0;
  // Child passive effects may read immediately, so install the guard first.
  useLayoutEffect(() => {
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

export type LiveTextProps = {
  view: LiveView;
  /** Ranges to mark, from `openMarks`. */
  marks: readonly TextRange[];
  /** Drawn in the sheet above the text; the student's page passes the work's h1. */
  heading?: ReactNode;
  textRef?: Ref<HTMLDivElement>;
  /** The teacher's selection, to comment on it (B-10). Handlers never enter the markup. */
  onSelect?: () => void;
};

/** The connection line, the sheet with the text, and the note beside a shown text. */
export default function LiveText({ view, marks, heading, textRef, onSelect }: LiveTextProps) {
  const stopped = liveStopped(view);
  // DAN-332: the submitted revision is never labelled live, and once shown it
  // keeps its label through this page's own failed requests (#826 A5).
  const submitted = !stopped && view.document !== null && view.submitted;
  const placeholder = (line: string) => h("p", { className: "manuscript__placeholder" }, line);
  let text: ReactNode;
  if (stopped) text = placeholder(t.connection[view.connection]);
  else if (view.document) {
    const block = (node: DocumentNode) =>
      h(Block, { key: node.id, node, ranges: marks.filter((r) => r.nodeId === node.id) });
    // Consecutive bullet items are one list, quote paragraphs one block quote (E1).
    text = blockRuns(view.document.nodes).map((run) =>
      run.kind === "list" ? h("ul", { key: run.items[0]!.id }, ...run.items.map(block))
        : run.kind === "quote" ? h("blockquote", { key: run.items[0]!.id }, ...run.items.map(block))
        : block(run.node));
  } else text = placeholder(view.empty ? t.empty : t.loading);

  return h(
    Fragment,
    null,
    h(
      "p",
      { className: styles.status },
      h(
        "span",
        { className: "sync-chip", "data-tone": submitted ? "ok" : TONE[view.connection], role: "status" },
        h("span", { className: "sync-chip__dot", "aria-hidden": "true" }),
        submitted ? t.submitted : t.connection[view.connection],
      ),
    ),
    h(
      SheetFrame,
      null,
      heading,
      h("div", {
        ref: textRef,
        className: `manuscript ${styles.text}`,
        role: "document",
        "aria-label": t.documentLabel,
        "aria-busy": view.connection === "loading",
        onMouseUp: onSelect,
        onKeyUp: onSelect,
      }, text),
    ),
    // The note speaks about a shown text, so it stands only beside one.
    !stopped && view.document ? h("p", { className: styles.note }, submitted ? t.submittedNote : t.note) : null,
  );
}
