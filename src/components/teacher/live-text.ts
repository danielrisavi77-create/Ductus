"use client";

/**
 * The text of the live view of one work, shared by the teacher's view
 * (`/nastavnik/rad/<id>`) and the student's "Kako vidi nastavnik" on `/rad`
 * (#732 item 7, PRODUCT §5 rule 5: the same function draws both). Written
 * with `createElement`, so the unit test can render it with
 * `renderToStaticMarkup`. The selection handlers of the teacher are passed in
 * and never reach the markup, so the region is the same for every reader.
 */

import {
  createElement as h, useCallback, useEffect, useLayoutEffect, useRef, useState,
  type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject,
} from "react";

import { startLiveReader, type LiveView } from "@/client/live-reader";
import { watchSessionEnd, type SessionWatch } from "@/client/session-end";
import type { SessionMark } from "@/client/session-marks";
import type { DocumentNode } from "@/domain/document";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { blockSegments, type TextRange } from "./comment-place";
import styles from "./LiveWorkView.module.css";

const t = messagesHr.liveView;

export const INITIAL_LIVE_VIEW: LiveView = { document: null, hash: null, empty: false, connection: "loading" };

const TONE: Record<LiveView["connection"], string> = {
  loading: "progress", live: "ok", retrying: "warn", paused: "warn", signedOut: "error", notFound: "error",
};

/** No text, comments or summary any more: the session ended or the work is not this account's. */
export const liveStopped = (view: LiveView): boolean =>
  view.connection === "signedOut" || view.connection === "notFound";

function Block({ node, ranges }: { node: DocumentNode; ranges: readonly TextRange[] }) {
  const children = blockSegments(node, ranges).map((segment, i) => {
    let content: ReactNode = segment.text;
    if (segment.marks.includes("italic")) content = h("em", null, content);
    if (segment.marks.includes("bold")) content = h("strong", null, content);
    return segment.marked ? h("mark", { key: i, className: styles.mark }, content) : h("span", { key: i }, content);
  });
  if (node.type === "paragraph") return h("p", { "data-node-id": node.id }, ...children);
  // The page has its own h1, so the work's levels 1 to 3 are h2 to h4.
  const heading = node.level === 1 ? "h2" : node.level === 2 ? "h3" : "h4";
  return h(heading, { "data-node-id": node.id }, ...children);
}

/** The connection line: about this page's own requests, never about the student (4.12 t. 8). */
export function LiveChip({ view }: { view: LiveView }) {
  return h(
    "p",
    { className: styles.status },
    h(
      "span",
      { className: "sync-chip", "data-tone": TONE[view.connection], role: "status" },
      h("span", { className: "sync-chip__dot", "aria-hidden": "true" }),
      t.connection[view.connection],
    ),
  );
}

export type LiveDocumentProps = {
  view: LiveView;
  /** Places of the unresolved comments in the shown text. */
  marks: readonly TextRange[];
  textRef?: RefObject<HTMLDivElement | null>;
  /** The teacher's selection of a passage; never part of the markup. */
  onSelect?: (event: MouseEvent | KeyboardEvent) => void;
};

/** The read-only text: only a whole accepted document, never a partial one. */
export function LiveDocument({ view, marks, textRef, onSelect }: LiveDocumentProps) {
  let text: ReactNode;
  if (liveStopped(view)) text = h("p", { className: "manuscript__placeholder" }, t.connection[view.connection]);
  else if (view.document) {
    text = view.document.nodes.map((node) =>
      h(Block, { key: node.id, node, ranges: marks.filter((r) => r.nodeId === node.id) }));
  } else text = h("p", { className: "manuscript__placeholder" }, view.empty ? t.empty : t.loading);
  return h(
    "div",
    {
      ref: textRef,
      className: `manuscript ${styles.text}`,
      role: "document",
      "aria-label": t.documentLabel,
      "aria-busy": view.connection === "loading",
      onMouseUp: onSelect,
      onKeyUp: onSelect,
    },
    text,
  );
}

/** The note speaks about a shown text, so it stands only beside one. */
export function LiveNote({ view }: { view: LiveView }) {
  return !liveStopped(view) && view.document ? h("p", { className: styles.note }, t.note) : null;
}

/** The live state of `documentId` while mounted; stops for good once the session ends here. */
export function useLiveView(documentId: string, session: SessionMark | null) {
  const [view, setView] = useState<LiveView>(INITIAL_LIVE_VIEW);
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
  return { view: ended ? { ...INITIAL_LIVE_VIEW, connection: "signedOut" as const } : view, current };
}
