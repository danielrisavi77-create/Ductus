"use client";

/**
 * The open comments of one document, for the tab label "Komentari (1)" of
 * /rad (Archivum S04). The comment panel publishes what it has loaded; the
 * label only reads it. Until a list is loaded, after a failed load and after
 * the session ended, and with no open comment, the label is "Komentari".
 */

import { createElement as h, Fragment, useSyncExternalStore } from "react";

import { messagesHr } from "@/lib/i18n/messages.hr";

const counts = new Map<string, number>();
const listeners = new Set<() => void>();

/** Sets the number of open threads of `documentId`, or clears it with null. */
export function publishCommentCount(documentId: string, open: number | null): void {
  if (open === null ? !counts.has(documentId) : counts.get(documentId) === open) return;
  if (open === null) counts.delete(documentId);
  else counts.set(documentId, open);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** "Komentari" or "Komentari (n)"; exported for the unit test. */
export function commentsTabText(open: number | null): string {
  const t = messagesHr.workspace;
  return open === null || open === 0 ? t.tabComments : t.tabCommentsCount.replace("{n}", String(open));
}

export function CommentsTabLabel({ documentId }: { documentId: string }) {
  const open = useSyncExternalStore(subscribe, () => counts.get(documentId) ?? null, () => null);
  return h(Fragment, null, commentsTabText(open));
}
