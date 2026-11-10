import { createElement as h, type ReactNode } from "react";

import type { RevisionRequest } from "@/client/revision-requests";
import type { Messages } from "@/lib/i18n/messages.hr";

import styles from "./RevisionPanel.module.css";

/**
 * The student's side of revision requests on /rad (DAN-314, reference N-08
 * states 6 to 10), read only: the student sees each request, its versions and
 * the teacher's closing. The view lives apart from the panel that holds the
 * state, so the unit tests reach every state without a DOM. Written with
 * createElement, like SidePanels.
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

/**
 * Whether a loaded list may still be shown: the panel is mounted, its session
 * has not ended and the watch says so. After unmount the watch is gone, so the
 * mount itself must say no, or a late `list` could show another session's requests.
 */
export type Liveness = {
  readonly mounted: { readonly current: boolean };
  readonly stopped: { readonly current: boolean };
  readonly watch: { readonly current: { ended: () => boolean } | null };
};

export const isLive = ({ mounted, stopped, watch }: Liveness): boolean =>
  mounted.current && !stopped.current && !(watch.current?.ended() ?? false);

export type ListStatus = "loading" | "signedOut" | "forbidden" | "unavailable" | "ok";

export type RevisionListProps = {
  readonly t: RevisionTexts;
  readonly formatDate: (iso: string) => string;
  readonly status: ListStatus;
  readonly requests: readonly RevisionRequest[];
  readonly onRetry: () => void;
};

function RevisionCard({ request, props }: { request: RevisionRequest; props: RevisionListProps }): ReactNode {
  const { t } = props;
  const state = displayState(request);
  const first = request.versions[0]!;
  const last = request.versions.at(-1)!;
  const by = (own: boolean, other: string) => (own ? t.own : other);

  return h("article", {
    className: styles.card,
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
  last.closed?.as === "withdrawn" ? h("p", { className: styles.meta }, t.withdrawnMeta.replace("{date}", props.formatDate(last.closed.window))) : null);
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
    // A request opened or reopened after the list was read appears without reloading the page.
    props.status === "ok"
      ? h("button", { type: "button", className: styles.link, onClick: props.onRetry }, t.refresh)
      : null);
}
