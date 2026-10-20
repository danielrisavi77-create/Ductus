"use client";

/**
 * The "Sažetak procesa" card of the teacher's view of a work (F-10 PR4,
 * contract on #476). The summary itself is drawn only by `ProcessSummaryView`
 * from a summary `fetchProcessSummary` has checked, with no input about who
 * reads it, so for the same answer the region is the same markup the student
 * sees (PRODUCT §5 rule 5, D-80 point 6). Everything the card adds (the state
 * line and the refresh button) stands outside that region.
 *
 * Read once when the card opens and on "Osvježi sažetak", never on the 1 s
 * beat of the live text: every read of the route is logged (DAN-228). Only an
 * `ok` answer is shown; any other answer replaces it, so an old summary never
 * stays beside an error. Written with `createElement` like the view, so the
 * unit test can render it with `renderToStaticMarkup`.
 */

import { createElement as h, useCallback, useEffect, useRef, useState } from "react";

import { fetchProcessSummary, type SummaryOutcome } from "@/client/process-summary";
import { ProcessSummaryView } from "@/components/summary/ProcessSummaryView";
import { messagesHr } from "@/lib/i18n/messages.hr";

import styles from "./LiveWorkView.module.css";

const t = messagesHr.summaryCard;

/** The card for one outcome; `null` while the first read is under way. */
export function SummaryCardBody({ outcome, onReload }: { outcome: SummaryOutcome | null; onReload: () => void }) {
  const refresh = h("button", { type: "button", className: styles.link, onClick: onReload }, t.refresh);
  if (outcome?.kind === "ok") {
    return h("div", { className: styles.summaryCard }, h(ProcessSummaryView, { summary: outcome.summary }), refresh);
  }
  const state = outcome === null ? t.loading : t[outcome.kind];
  return h(
    "section",
    { className: `${styles.summaryCard} ${styles.summaryState}`, "aria-labelledby": "summary-card-title" },
    h("h2", { id: "summary-card-title" }, messagesHr.summary.title),
    h("p", { className: styles.muted, role: "status" }, state),
    refresh,
  );
}

/** Reads the summary while `active`; when it stops (session ended, no access) the summary is dropped (D-118). */
export function useProcessSummary(documentId: string, current: () => boolean, active: boolean) {
  const [outcome, setOutcome] = useState<SummaryOutcome | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    if (!active || !current()) return;
    const mine = ++generation.current;
    const result = await fetchProcessSummary(documentId, current);
    if (mine === generation.current) setOutcome(result);
  }, [documentId, current, active]);
  useEffect(() => {
    if (active) void load();
    else {
      generation.current += 1;
      setOutcome(null);
    }
  }, [load, active]);
  return { outcome, load };
}

export default function SummaryCard({ documentId, current }: { documentId: string; current: () => boolean }) {
  const { outcome, load } = useProcessSummary(documentId, current, true);
  return h(SummaryCardBody, { outcome, onReload: () => void load() });
}
