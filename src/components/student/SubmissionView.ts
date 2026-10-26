/**
 * The student's submission screen (F-10, #476 contract 6384297464; Ductura
 * demo-tok-v2 screen 4): the text on the server, read-only, the button, and
 * after a 200 the receipt. Beside it the same `ProcessSummaryView` the
 * teacher sees (`SummaryCardBody`, PRODUCT §5 rule 5).
 *
 * Pure: everything comes from `SubmissionState`, so each outcome renders with
 * `renderToStaticMarkup` in the unit tests. Written with `createElement` for
 * the same reason as `ProcessSummaryView`. All text is in `messages.hr.ts`.
 * Nothing here says the signature was verified: the browser does not check
 * it before the demo (contract §2).
 */

import { createElement as h, type ReactNode } from "react";

import type { SubmitOutcome } from "@/client/submission";
import type { SummaryOutcome } from "@/client/process-summary";
import { blockRuns } from "@/components/shell/manuscript-blocks";
import { zagrebParts } from "@/components/summary/zagreb-time";
import { SummaryCardBody } from "@/components/teacher/SummaryCard";
import type { CanonicalDocument, DocumentNode } from "@/domain/document";
import type { SignedSubmissionReceiptV2 } from "@/domain/forensics/submission-receipt-v2";
import { messagesHr } from "@/lib/i18n/messages.hr";

import styles from "./Submission.module.css";

const t = messagesHr.submission;

/** The element that holds the outcome of a submission; the page moves the focus to it. */
export const OUTCOME_ID = "submission-outcome";

export type SubmissionState =
  | { phase: "loading" }
  /** Open refused or failed, or the text cannot be shown: nothing can be submitted from here. */
  | { phase: "closed"; reason: "signedOut" | "notFound" | "unavailable" | "unreadable" }
  | {
      phase: "ready";
      document: CanonicalDocument;
      revision: number;
      sending: boolean;
      /** The last answer of the submission route, if any. */
      outcome: SubmitOutcome | null;
      summary: SummaryOutcome | null;
    };

export type SubmissionHandlers = {
  readonly onSubmit: () => void;
  readonly onReload: () => void;
  readonly onReloadSummary: () => void;
};

function Block(node: DocumentNode, index: number): ReactNode {
  const children = node.children.map((child, i) => {
    let content: ReactNode = child.text;
    if (child.marks.includes("italic")) content = h("em", null, content);
    if (child.marks.includes("bold")) content = h("strong", null, content);
    return h("span", { key: i }, content);
  });
  if (node.type === "paragraph" || node.type === "quote") return h("p", { key: index }, ...children);
  if (node.type === "bulletItem") return h("li", { key: index }, ...children);
  // The page has its own h1, so the work's levels 1 to 3 are h2 to h4.
  const tag = node.level === 1 ? "h2" : node.level === 2 ? "h3" : "h4";
  return h(tag, { key: index }, ...children);
}

function when(iso: string): string {
  const parts = zagrebParts(iso);
  return parts ? `${parts.date} ${parts.time}` : iso;
}

function Receipt(receipt: SignedSubmissionReceiptV2): ReactNode {
  const p = receipt.payload;
  const fact = (label: string, value: ReactNode, className?: string) => [
    h("dt", { key: `${label}-t` }, label),
    h("dd", { key: `${label}-d`, className }, value),
  ];
  return h(
    "section",
    // The outcome takes the focus after a submission (#385 H8).
    { id: OUTCOME_ID, tabIndex: -1, className: `${styles.card} ${styles.receipt}`, "aria-labelledby": "submission-receipt" },
    h("h2", { id: "submission-receipt" }, t.receiptTitle),
    h("p", { role: "status" }, t.receiptLead),
    h(
      "dl",
      { className: styles.facts },
      ...fact(t.requestedAt, when(p.requestedAt)),
      ...fact(t.dueAt, when(p.dueAt)),
      ...fact(t.record, t.records[p.evidenceRecord]),
      ...fact(t.revision, String(p.revision)),
      ...fact(t.textHash, p.artifactSha256, styles.hash),
    ),
    p.afterDeadline ? h("p", null, t.afterDeadline) : null,
    h("p", { className: styles.note }, t.receiptNote),
  );
}

/** The text of a refusal; `submitted` and `notAcknowledged` (a redirect) have none. */
function refusalText(outcome: SubmitOutcome): string | null {
  switch (outcome.kind) {
    case "noEvidence": return t.noEvidence;
    case "recordMismatch": return t.outcome.recordMismatch;
    case "blocked": return t.outcome.blocked;
    case "staleRevision": return t.outcome.staleRevision;
    case "alreadyRequested": return t.outcome.alreadyRequested;
    case "notOpen": return t.outcome.notOpen;
    case "notFound": return t.outcome.notFound;
    case "signedOut": return t.outcome.signedOut;
    case "unavailable": return t.outcome.unavailable;
    default: return null;
  }
}

function Steps(current: "check" | "submit" | "receipt"): ReactNode {
  return h(
    "ol",
    { className: styles.steps, "aria-label": t.title },
    (["check", "submit", "receipt"] as const).map((step) =>
      h("li", { key: step, "aria-current": step === current ? "step" : undefined }, t.steps[step])),
  );
}

export function SubmissionView({ state, handlers, offline = false }: {
  state: SubmissionState;
  handlers: SubmissionHandlers;
  /** Without a network the button waits and says why (attack plan #385 H7). */
  offline?: boolean;
}) {
  if (state.phase === "loading") {
    return h("p", { className: styles.muted, role: "status" }, t.loading);
  }
  if (state.phase === "closed") {
    const text = state.reason === "unreadable" ? t.unreadable
      : state.reason === "unavailable" ? t.openUnavailable
      : t.outcome[state.reason];
    return h(
      "div",
      { className: styles.card },
      h("p", { role: "status" }, text),
      state.reason === "unavailable"
        ? h("p", { className: styles.actions }, h("button", { type: "button", className: "btn", onClick: handlers.onReload }, t.reload))
        : null,
    );
  }

  const { outcome } = state;
  const submitted = outcome?.kind === "submitted" ? outcome.receipt : null;
  const refusal = outcome && !submitted ? refusalText(outcome) : null;
  const empty = state.revision === 0;

  let action: ReactNode = null;
  if (submitted) action = Receipt(submitted);
  else if (empty) action = h("p", { role: "status" }, t.noEvidence);
  else {
    action = h(
      "div",
      { className: styles.actions },
      h("button", {
        type: "button",
        className: "btn",
        disabled: state.sending || offline,
        onClick: handlers.onSubmit,
      }, state.sending ? t.sending : t.submit),
      offline ? h("span", { role: "status" }, t.offline) : null,
      outcome?.kind === "staleRevision"
        ? h("button", { type: "button", className: "btn", onClick: handlers.onReload }, t.reload)
        : null,
    );
  }

  return h(
    "div",
    { className: styles.layout },
    h(
      "div",
      { className: styles.main },
      Steps(submitted ? "receipt" : empty ? "check" : "submit"),
      h(
        "section",
        { className: styles.card, "aria-labelledby": "submission-text" },
        h("h2", { id: "submission-text" }, t.textTitle),
        h("p", { className: styles.note }, t.serverNote),
        h(
          "div",
          { className: "manuscript", role: "document", "aria-label": t.textLabel },
          // Consecutive bullet items are one list, quote paragraphs one block quote (E1).
          ...blockRuns(state.document.nodes).map((run, i) =>
            run.kind === "block" ? Block(run.node, i)
              : h(run.kind === "list" ? "ul" : "blockquote", { key: i }, ...run.items.map(Block))),
        ),
      ),
      refusal ? h("p", { id: OUTCOME_ID, tabIndex: -1, role: "alert" }, refusal) : null,
      action,
    ),
    h(
      "aside",
      { className: styles.aside },
      h(SummaryCardBody, { outcome: state.summary, onReload: handlers.onReloadSummary }),
    ),
  );
}
