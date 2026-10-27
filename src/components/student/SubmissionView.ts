/**
 * The student's submission screen (F-10, #476 contract 6384297464), drawn as
 * the Archivum S05 "Pregled prije predaje" and S06 "Rad je predan." (DAN-344,
 * #923 contract 6430008106 §3): the text on the server, read-only, the
 * button, and after a 200 the receipt. Beside it the same `ProcessSummaryView`
 * the teacher sees (`SummaryCardBody`, PRODUCT §5 rule 5).
 *
 * Pure: everything comes from `SubmissionState` and the page's own read of
 * the assignment (`SubmissionContext`), so each outcome renders with
 * `renderToStaticMarkup` in the unit tests. Written with `createElement` for
 * the same reason as `ProcessSummaryView`. All text is in `messages.hr.ts`.
 * Nothing here says the signature was verified: the browser does not check
 * it before the demo (contract §2). "Rad je predan." and step 3 come only
 * with a receipt, that is only after a 200 of the submission route.
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

import type { CourseMotif } from "./course-motif";
import styles from "./Submission.module.css";

const t = messagesHr.submission;

/** The element that holds the outcome of a submission; the page moves the focus to it. */
export const OUTCOME_ID = "submission-outcome";

/**
 * What the page read of the assignment (`readWorkContext`, the student's own
 * acknowledged current version). Each part is shown only when the read gave
 * it; nothing is filled in.
 */
export type SubmissionContext = {
  readonly course: string | null;
  readonly title: string | null;
  readonly dueAt: string | null;
  readonly motif: CourseMotif | null;
  /** `/rad?zadatak=<id>`; null without a well-formed assignment id. */
  readonly workHref: string | null;
};

export const NO_CONTEXT: SubmissionContext = { course: null, title: null, dueAt: null, motif: null, workHref: null };

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

type Step = "check" | "submit" | "receipt";

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

/** `13. studenoga 2026. u 23:59`, always in Europe/Zagreb. */
function when(iso: string): string {
  const parts = zagrebParts(iso);
  return parts ? `${parts.date} ${messagesHr.summary.at} ${parts.time}` : iso;
}

const arrow = (glyph: string) => h("span", { "aria-hidden": "true", className: styles.arrow }, glyph);

/** The work's text, read-only; the title again over it in small capitals (hidden, the h1 names it). */
function Manuscript(document: CanonicalDocument, title: string | null, scroll: boolean): ReactNode {
  return h(
    "div",
    {
      className: `manuscript ${styles.text}${scroll ? ` ${styles.scroll}` : ""}`,
      role: "document",
      "aria-label": t.textLabel,
      // A box that scrolls must take the keyboard focus (axe scrollable-region-focusable).
      tabIndex: scroll ? 0 : undefined,
    },
    title ? h("p", { className: "sheet-runhead", "aria-hidden": "true" }, title) : null,
    // Consecutive bullet items are one list, quote paragraphs one block quote (E1).
    ...blockRuns(document.nodes).map((run, i) =>
      run.kind === "block" ? Block(run.node, i)
        : h(run.kind === "list" ? "ul" : "blockquote", { key: i }, ...run.items.map(Block))),
  );
}

function Steps(current: Step): ReactNode {
  return h(
    "ol",
    { className: styles.steps, "aria-label": t.title },
    (["check", "submit", "receipt"] as const).map((step, i) =>
      h(
        "li",
        { key: step, "aria-current": step === current ? "step" : undefined },
        h("span", { className: styles.stepNo, "aria-hidden": "true" }, String(i + 1)),
        h("span", null, t.steps[step]),
      )),
  );
}

/**
 * The frame of every state of the page: the way back, the course with its
 * motif, the h1, the assignment's title and, once the text is shown, the
 * steps. The page draws the same frame around its own states (no id, signed
 * out, no access), so the h1 is always one and always here.
 */
export function SubmissionFrame({ context, done = false, step = null, children }: {
  context: SubmissionContext;
  /** Only with a receipt of the server: "Rad je predan." */
  done?: boolean;
  step?: Step | null;
  children?: ReactNode;
}) {
  return h(
    "div",
    { className: styles.frame },
    context.workHref
      ? h("a", { className: styles.back, href: context.workHref }, arrow("←"), h("span", null, t.backToWork))
      : null,
    context.course
      ? h(
        "div",
        { className: styles.course, "data-motif": context.motif ?? undefined },
        h("p", { className: styles.eyebrow }, t.courseLabel),
        h("p", { className: styles.courseName }, context.course),
      )
      : null,
    h("h1", { className: styles.heading }, done ? t.doneHeading : t.reviewHeading),
    done ? h("p", { className: styles.lead }, t.receiptLead) : null,
    context.title ? h("p", { className: styles.subtitle }, context.title) : null,
    step ? Steps(step) : null,
    children,
  );
}

function Receipt(receipt: SignedSubmissionReceiptV2): ReactNode {
  const p = receipt.payload;
  const fact = (label: string, value: ReactNode) => h(
    "div",
    { key: label, className: styles.row },
    h("dt", null, label),
    h("dd", null, value),
  );
  return h(
    "section",
    // The outcome takes the focus after a submission (#385 H8).
    { id: OUTCOME_ID, tabIndex: -1, className: `${styles.card} ${styles.receipt}`, "aria-labelledby": "submission-receipt" },
    h("h2", { id: "submission-receipt" }, t.receiptTitle),
    h(
      "dl",
      { className: styles.table },
      fact(t.requestedAt, when(p.requestedAt)),
      fact(t.receiptRevision, String(p.revision)),
      fact(t.receiptDueAt, when(p.dueAt)),
      fact(t.record, t.records[p.evidenceRecord]),
      fact(t.textHash, h(
        "details",
        { className: styles.reveal },
        h("summary", null, t.hashShow),
        h("code", { className: styles.hash }, p.artifactSha256),
      )),
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

/** The process summary, folded: the same region the teacher gets (rule 5). */
function Summary(state: Extract<SubmissionState, { phase: "ready" }>, handlers: SubmissionHandlers): ReactNode {
  return h(
    "details",
    { className: styles.fold },
    h("summary", null, t.summaryShow),
    h("p", { className: styles.note }, t.summaryNote),
    h(SummaryCardBody, { outcome: state.summary, onReload: handlers.onReloadSummary }),
  );
}

/** S06: the receipt, the submitted text and the summary, each folded where the image folds it. */
function Done(
  state: Extract<SubmissionState, { phase: "ready" }>,
  receipt: SignedSubmissionReceiptV2,
  context: SubmissionContext,
  handlers: SubmissionHandlers,
): ReactNode {
  return h(
    "div",
    { className: styles.done },
    Receipt(receipt),
    h(
      "details",
      { className: styles.fold },
      // The revision this tab submitted and still holds; nothing is read again.
      h("summary", null, h("span", { className: styles.foldTitle }, t.submittedText), h("span", null, t.submittedTextShow)),
      Manuscript(state.document, context.title, false),
    ),
    h(
      "details",
      { className: styles.fold },
      h(
        "summary",
        null,
        h("span", { className: styles.foldTitle }, messagesHr.summary.title),
        h("span", { className: styles.note }, t.summaryNote),
        h("span", null, t.summaryShow),
      ),
      h(SummaryCardBody, { outcome: state.summary, onReload: handlers.onReloadSummary }),
    ),
    h(
      "div",
      { className: styles.bar },
      h("a", { className: "btn", href: "/zadaci" }, t.myAssignments, arrow("→")),
      h("p", { className: styles.note }, t.submittedNote),
    ),
  );
}

export function SubmissionView({ state, handlers, context = NO_CONTEXT, offline = false }: {
  state: SubmissionState;
  handlers: SubmissionHandlers;
  context?: SubmissionContext;
  /** Without a network the button waits and says why (attack plan #385 H7). */
  offline?: boolean;
}) {
  if (state.phase === "loading") {
    return h(SubmissionFrame, { context }, h("p", { className: styles.note, role: "status" }, t.loading));
  }
  if (state.phase === "closed") {
    const text = state.reason === "unreadable" ? t.unreadable
      : state.reason === "unavailable" ? t.openUnavailable
      : t.outcome[state.reason];
    return h(
      SubmissionFrame,
      { context },
      h(
        "div",
        { className: styles.card },
        h("p", { role: "status" }, text),
        state.reason === "unavailable"
          ? h("p", { className: styles.actions }, h("button", { type: "button", className: "btn", onClick: handlers.onReload }, t.reload))
          : null,
      ),
    );
  }

  const { outcome } = state;
  const submitted = outcome?.kind === "submitted" ? outcome.receipt : null;
  if (submitted) {
    return h(SubmissionFrame, { context, done: true, step: "receipt" }, Done(state, submitted, context, handlers));
  }
  const refusal = outcome ? refusalText(outcome) : null;
  const empty = state.revision === 0;

  const facts = [
    context.course ? [t.courseLabel, context.course] : null,
    [t.revision, String(state.revision)],
    context.dueAt ? [t.dueAt, when(context.dueAt)] : null,
  ].filter((fact): fact is string[] => fact !== null);

  return h(
    SubmissionFrame,
    { context, step: state.sending ? "submit" : "check" },
    h(
      "div",
      { className: styles.intro },
      h("p", { className: styles.introLead }, t.serverNote),
      h("p", { className: styles.introNote }, t.unsentNote),
    ),
    h(
      "div",
      { className: styles.layout },
      h(
        "section",
        { className: styles.main, "aria-labelledby": "submission-text" },
        h(
          "div",
          { className: styles.textHead },
          h("h2", { id: "submission-text" }, t.textTitle),
          h("span", { className: styles.note }, t.readOnly),
        ),
        Manuscript(state.document, context.title, true),
      ),
      h(
        "aside",
        { className: styles.aside, "aria-labelledby": "submission-facts" },
        h("h2", { id: "submission-facts" }, t.factsTitle),
        h(
          "dl",
          { className: styles.facts },
          ...facts.map(([label, value]) => h("div", { key: label }, h("dt", null, label), h("dd", null, value))),
        ),
        Summary(state, handlers),
      ),
    ),
    refusal ? h("p", { id: OUTCOME_ID, tabIndex: -1, role: "alert", className: styles.refusal }, refusal) : null,
    h(
      "div",
      { className: styles.bar },
      empty
        ? h("p", { role: "status" }, t.noEvidence)
        : h(
          "div",
          { className: styles.actions },
          h("button", {
            type: "button",
            className: "btn",
            disabled: state.sending || offline,
            onClick: handlers.onSubmit,
          }, state.sending ? t.sending : t.submit, state.sending ? null : arrow("→")),
          offline ? h("span", { role: "status" }, t.offline) : null,
          outcome?.kind === "staleRevision"
            ? h("button", { type: "button", className: "btn", onClick: handlers.onReload }, t.reload)
            : null,
        ),
      context.workHref ? h("a", { className: styles.editorLink, href: context.workHref }, t.backToEditor) : null,
      h("p", { className: styles.note }, t.receiptPending),
    ),
  );
}
