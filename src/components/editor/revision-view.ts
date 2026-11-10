import { createElement as h, type ReactNode } from "react";

import type { OpenOutcome } from "@/client/evidence-ingest";
import type { RespondInput, RespondOutcome, RevisionRequest } from "@/client/revision-requests";
import { isRevisionText, REVISION_TEXT_MAX, type RevisionKind } from "@/domain/collaboration/revision-input";
import type { Messages } from "@/lib/i18n/messages.hr";

import styles from "./RevisionPanel.module.css";

/**
 * The student's side of revision requests on /rad (DAN-314, reference N-08
 * states 6 to 10). The logic of an answer and the view of the list live
 * here, apart from the panel that holds the state, so the unit tests reach
 * every state without a DOM. Written with createElement, like SidePanels.
 *
 * Nothing here judges the work: a state is what the teacher or the student
 * said, shown as they said it. Text is rendered as React text, never as HTML.
 */

export type RevisionTexts = Messages["revisions"];

/** What the card shows: `responded` is told apart by the student's answer. */
export type DisplayState = "open" | "done" | "declined" | "accepted" | "reopened" | "withdrawn";

export function displayState(request: RevisionRequest): DisplayState {
  if (request.state !== "responded") return request.state;
  return request.versions.at(-1)?.response?.kind ?? "done";
}

/** The student answers only the current version of an open or reopened request. */
export const canAnswer = (request: RevisionRequest): boolean =>
  request.state === "open" || request.state === "reopened";

export type AnswerError = "signedOut" | "forbidden" | "conflict" | "invalid" | "unavailable" | "submitted";

export type AnswerResult = { kind: "sent" } | { kind: "error"; error: AnswerError; reload: boolean };

/** The revision of the work an answer is given on, read from `openWork`. */
export type RevisionAt = { kind: "ok"; revision: number } | { kind: "signedOut" | "submitted" | "unavailable" };

export function revisionFromOpen(outcome: OpenOutcome): RevisionAt {
  if (outcome.status === "opened") {
    return outcome.work.submitted ? { kind: "submitted" } : { kind: "ok", revision: outcome.work.currentRevision };
  }
  return outcome.status === "unauthenticated" ? { kind: "signedOut" } : { kind: "unavailable" };
}

/**
 * Whether an answer may still go out: the panel is mounted, its session has
 * not ended and the watch says so. After unmount the watch is gone, so the
 * mount itself must say no, or a late `openWork` could send under another session.
 */
export type Liveness = {
  readonly mounted: { readonly current: boolean };
  readonly stopped: { readonly current: boolean };
  readonly watch: { readonly current: { ended: () => boolean } | null };
};

export const isLive = ({ mounted, stopped, watch }: Liveness): boolean =>
  mounted.current && !stopped.current && !(watch.current?.ended() ?? false);

export type AnswerDeps = {
  readonly respond: (input: RespondInput, current: () => boolean) => Promise<RespondOutcome>;
  readonly revision: () => Promise<RevisionAt>;
  readonly current: () => boolean;
};

/** The text an answer would carry, or null while the buttons stay off. */
export function answerText(draft: string): string | null {
  const text = draft.normalize("NFC");
  return isRevisionText(text) ? text : null;
}

export function limitAnswer(value: string): string {
  const points = [...value];
  return points.length <= REVISION_TEXT_MAX ? value : points.slice(0, REVISION_TEXT_MAX).join("");
}

/**
 * One answer, sent once. The counter is the one `list` returned; a 409 is
 * shown with a reload of the list and never sent again with a newer counter,
 * since the teacher may have reopened the request with another instruction.
 */
export async function sendAnswer(
  request: RevisionRequest, kind: RevisionKind, draft: string, deps: AnswerDeps,
): Promise<AnswerResult> {
  const explanation = answerText(draft);
  if (explanation === null || !canAnswer(request)) return { kind: "error", error: "invalid", reload: false };
  if (!deps.current()) return { kind: "error", error: "signedOut", reload: false };
  const at = await deps.revision();
  if (at.kind !== "ok") return { kind: "error", error: at.kind, reload: false };
  // Reading the revision takes time; the session or the panel may be gone by now.
  if (!deps.current()) return { kind: "error", error: "signedOut", reload: false };
  const outcome = await deps.respond({
    requestId: request.id, expectedSeq: request.rowSeq, kind, explanation, responseRevision: at.revision,
  }, deps.current);
  if (outcome.kind === "ok") return { kind: "sent" };
  return { kind: "error", error: outcome.kind, reload: outcome.kind === "conflict" };
}

/** Drafts after a sent answer: the explanation goes only if it is still the one that was sent. */
export function clearSent(
  drafts: Readonly<Record<string, string>>, id: string, sent: string,
): Readonly<Record<string, string>> {
  if (drafts[id] !== sent) return drafts;
  const rest = { ...drafts };
  delete rest[id];
  return rest;
}

export type ListStatus = "loading" | "signedOut" | "forbidden" | "unavailable" | "ok";

export type RevisionListProps = {
  readonly t: RevisionTexts;
  readonly formatDate: (iso: string) => string;
  readonly status: ListStatus;
  readonly requests: readonly RevisionRequest[];
  /** True once the work is submitted: no form is shown, and the panel says why. */
  readonly submitted: boolean;
  readonly drafts: Readonly<Record<string, string>>;
  readonly sending: string | null;
  readonly errors: Readonly<Record<string, AnswerError>>;
  /** The outcome of the last answer, read out once. */
  readonly live: string;
  readonly onDraft: (id: string, value: string) => void;
  readonly onAnswer: (id: string, kind: RevisionKind) => void;
  readonly onRetry: () => void;
};

const errorText = (t: RevisionTexts, error: AnswerError): string =>
  error === "submitted" ? t.submittedNote : t.errors[error];

function RevisionCard({ request, props }: { request: RevisionRequest; props: RevisionListProps }): ReactNode {
  const { t } = props;
  const state = displayState(request);
  const first = request.versions[0]!;
  const last = request.versions.at(-1)!;
  const answerable = canAnswer(request) && !props.submitted;
  const draft = props.drafts[request.id] ?? "";
  const sending = props.sending === request.id;
  const ready = answerText(draft) !== null && props.sending === null;
  const error = props.errors[request.id];
  const by = (own: boolean, other: string) => (own ? t.own : other);
  const field = `revision-${request.id}`;

  return h("article", {
    className: answerable ? `${styles.card} ${styles.on}` : styles.card,
    "data-state": state,
    "aria-label": t.number.replace("{n}", String(request.number)),
  },
  h("div", { className: styles.who },
    h("strong", null, by(first.openedIsOwn, t.teacher)),
    h("span", { className: styles.passage }, `„${request.anchor.quote}”`),
    h("span", { className: styles.chip }, t.state[state])),
  // Every version in order: an earlier answer stays beside its instruction (#1506 D1).
  ...request.versions.flatMap((version) => [
    version === first
      ? h("p", { key: "i1", className: styles.body }, first.instruction)
      : h("p", { key: `i${version.version}`, className: styles.quote }, `${by(version.openedIsOwn, t.teacher)}: ${version.instruction}`),
    version.response
      ? h("p", { key: `r${version.version}`, className: styles.quote }, `${by(version.response.isOwn, t.student)}: ${version.response.explanation}`)
      : null,
  ]),
  last.closed?.as === "accepted" ? h("p", { className: styles.meta }, t.acceptedMeta.replace("{date}", props.formatDate(last.closed.window))) : null,
  last.closed?.as === "withdrawn" ? h("p", { className: styles.meta }, t.withdrawnMeta.replace("{date}", props.formatDate(last.closed.window))) : null,
  answerable ? h("form", {
    className: styles.form,
    onSubmit: (event: { preventDefault: () => void }) => event.preventDefault(),
  },
  h("label", { htmlFor: field, className: styles.label }, t.explanationLabel),
  h("textarea", {
    id: field, rows: 3, value: draft, "aria-describedby": `${field}-hint`, readOnly: sending,
    onChange: (event: { target: { value: string } }) => props.onDraft(request.id, limitAnswer(event.target.value)),
  }),
  h("p", { id: `${field}-hint`, className: styles.hint }, t.explanationHint),
  h("div", { className: styles.controls },
    h("button", { type: "button", className: styles.btn, disabled: !ready, onClick: () => props.onAnswer(request.id, "done") },
      sending ? t.sending : t.done),
    h("button", {
      type: "button", className: `${styles.btn} ${styles.secondary}`, disabled: !ready,
      onClick: () => props.onAnswer(request.id, "declined"),
    }, t.declined)),
  ) : null,
  // An explanation that could not be sent stays readable, so it can be copied.
  !answerable && draft !== "" ? h("div", { className: styles.form },
    h("label", { htmlFor: `${field}-kept`, className: styles.label }, t.keptLabel),
    h("textarea", { id: `${field}-kept`, rows: 3, value: draft, readOnly: true, "aria-describedby": `${field}-kept-hint` }),
    h("p", { id: `${field}-kept-hint`, className: styles.hint }, t.keptHint),
  ) : null,
  error ? h("p", { role: "alert", className: styles.error }, errorText(t, error)) : null);
}

export function RevisionList(props: RevisionListProps): ReactNode {
  const { t } = props;
  let body: ReactNode;
  if (props.status === "loading") body = h("p", { className: "rail-empty" }, t.loading);
  else if (props.status === "signedOut") body = h("p", { className: "rail-empty", role: "status" }, t.signedOut);
  else if (props.status === "forbidden") body = h("p", { className: "rail-empty" }, t.notAvailable);
  else if (props.status === "unavailable") {
    body = h("div", { className: styles.failed },
      h("p", { className: "rail-empty", role: "alert" }, t.unavailable),
      h("button", { type: "button", className: `${styles.btn} ${styles.secondary}`, onClick: props.onRetry }, t.retry));
  } else if (props.requests.length === 0) body = h("p", { className: "rail-empty" }, t.empty);
  else body = props.requests.map((request) => h(RevisionCard, { key: request.id, request, props }));

  return h("section", { className: "rail-section", "aria-labelledby": "revisions-title" },
    h("h2", { id: "revisions-title", className: "rail-section__title" }, t.title,
      h("span", { className: "rail-section__count" }, props.status === "ok" && props.requests.length > 0 ? props.requests.length : null)),
    h("div", { className: styles.list }, body),
    // A request opened or reopened after the list was read appears without reloading the page;
    // off while an answer is on its way, whose outcome a newer list would otherwise drop.
    props.status === "ok"
      ? h("button", { type: "button", className: styles.link, disabled: props.sending !== null, onClick: props.onRetry }, t.refresh)
      : null,
    props.submitted && props.status === "ok" && props.requests.some(canAnswer)
      ? h("p", { className: styles.hint }, t.submittedNote) : null,
    h("p", { className: styles.live, role: "status", "aria-live": "polite" }, props.live));
}
