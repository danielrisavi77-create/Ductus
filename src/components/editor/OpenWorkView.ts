/**
 * The read-only sheet of the plan `notStarted` on `/rad?zadatak=` (#711 F1,
 * contract 6391402093 §2 and §6). Pure: everything comes from the phase, so
 * each one renders with `renderToStaticMarkup` in the unit tests; written with
 * `createElement` for the same reason as `SubmissionView`. No phase is an
 * editor: the sheet is `aria-disabled`, `aria-busy` while the answer is
 * awaited, and the text is in `role="status"`. All text is in `messages.hr.ts`.
 */

import { createElement as h, Fragment } from "react";

import type { OpenWorkStep } from "@/components/student/work-document-plan";
import { messagesHr } from "@/lib/i18n/messages.hr";

const t = messagesHr.workspace;

/**
 * What the opening sheet shows: `idle` before the click on "Započni rad"
 * (DAN-330), waiting, or the step of the last answer.
 */
export type OpenWorkPhase = { kind: "idle" } | { kind: "loading" } | Exclude<OpenWorkStep, { kind: "refresh" }>;

export const OPEN_WORK_STATUS_ID = "open-work-status";

/** The text of one phase, in the sheet's `role="status"`. */
export function openWorkText(phase: OpenWorkPhase): string {
  switch (phase.kind) {
    case "idle": return t.notStarted;
    case "loading": return t.openLoading;
    case "notAccepting": return t.openNotAccepting;
    case "unavailable": return t.unavailable;
    case "reload": return t.openReload;
    case "offline": return t.openOffline;
    case "error": return t.openError;
  }
}

function action(
  phase: OpenWorkPhase, assignmentId: string, onStart: () => void, onRetry: () => void, onReload: () => void,
  ready: boolean,
) {
  switch (phase.kind) {
    case "idle":
      // Disabled until the page is live in the browser: a click on the server
      // render before hydration would send nothing and look accepted.
      return h("button", { type: "button", className: "btn", onClick: onStart, disabled: !ready }, t.startWork);
    case "loading":
      // Stays in the DOM so the focus is not lost; aria-disabled, not disabled.
      return h("button", { type: "button", className: "btn", "aria-disabled": "true" }, t.startWork);
    case "error":
      return h("button", { type: "button", className: "btn", onClick: onRetry }, t.openRetry);
    case "notAccepting":
      return h("a", { className: "btn", href: `/zadatak/${encodeURIComponent(assignmentId)}` }, t.openNoticeLink);
    case "unavailable": {
      if (!phase.signIn) return null;
      const back = `/rad?zadatak=${encodeURIComponent(assignmentId)}`;
      return h("a", { className: "btn", href: `/api/auth/login?returnTo=${encodeURIComponent(back)}` }, messagesHr.auth.signIn);
    }
    case "reload":
      return h("button", { type: "button", className: "btn", onClick: onReload }, t.openReloadButton);
    default:
      return null;
  }
}

export function OpenWorkView({ phase, assignmentId, onStart, onRetry, onReload, ready = true }: {
  phase: OpenWorkPhase;
  assignmentId: string;
  onStart: () => void;
  onRetry: () => void;
  onReload: () => void;
  /** False only in the server render, before the page is hydrated. */
  ready?: boolean;
}) {
  return h(Fragment, null,
    h("div", {
      className: "manuscript",
      role: "textbox",
      "aria-multiline": "true",
      "aria-disabled": "true",
      "aria-busy": phase.kind === "loading" ? "true" : "false",
      "aria-label": t.documentLabel,
      "aria-describedby": OPEN_WORK_STATUS_ID,
    }, h("p", { className: "manuscript__placeholder" }, t.documentNotEditable)),
    h("p", { id: OPEN_WORK_STATUS_ID, role: "status" }, openWorkText(phase)),
    action(phase, assignmentId, onStart, onRetry, onReload, ready),
  );
}
