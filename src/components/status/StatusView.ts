import { createElement as h } from "react";

import { formatDateTimeHr } from "@/lib/i18n/hr";
import { messagesHr } from "@/lib/i18n/messages.hr";
import { COMPONENTS, type PublicStatus } from "@/lib/status/public-status";

import styles from "./Status.module.css";

const t = messagesHr.statusPage;

/** What the board shows: waiting for the first answer, no answer yet, or the last answer. */
export type StatusPhase =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "filled"; status: PublicStatus; stale: boolean };

/** The summary line of an answer: any part down wins over a part not enabled. */
export function statusSummary(status: PublicStatus): string {
  const states = COMPONENTS.map((name) => status.components[name]);
  if (states.includes("ne_radi")) return t.someNotWorking;
  if (states.includes("nije_ukljuceno")) return t.someNotEnabled;
  return t.allWorking;
}

/**
 * The public status panel (DAN-429). Pure, so each phase renders with
 * renderToStaticMarkup in the unit tests; written with createElement like the
 * other screens tested that way. It shows only the closed words of
 * /api/status and the time of the check: no person, work or address. A state
 * is told apart by its mark's shape as well as its colour.
 */
export default function StatusView({ phase, onRetry }: { phase: StatusPhase; onRetry: () => void }) {
  const retry = h("button", { type: "button", className: `btn ${styles.quiet}`, onClick: onRetry }, t.retry);
  const head = h("div", { className: styles.top }, h("h2", null, t.partsTitle));
  if (phase.kind === "loading") {
    return h(
      "section",
      { className: styles.panel, "aria-busy": true },
      head,
      h(
        "div",
        { className: styles.body },
        h("p", { className: styles.note, role: "status" }, t.loading),
        ...["w80", "w60", "w40"].map((w) => h("div", { key: w, className: `${styles.skel} ${styles[w]}`, "aria-hidden": true })),
      ),
    );
  }
  if (phase.kind === "error") {
    return h(
      "section",
      { className: styles.panel },
      head,
      h("div", { className: styles.body }, h("p", { className: styles.note, role: "alert" }, t.error), h("p", null, retry)),
    );
  }
  const { status, stale } = phase;
  return h(
    "section",
    { className: styles.panel },
    head,
    h(
      "div",
      { className: styles.body },
      h("p", { className: styles.note, role: "status" }, statusSummary(status)),
      stale ? h("div", { className: styles.stale, role: "alert" }, h("p", null, t.stale), h("p", null, retry)) : null,
      h(
        "ul",
        { className: styles.list },
        ...COMPONENTS.map((name) =>
          h(
            "li",
            { key: name, className: styles.comp },
            h("span", null, t.components[name]),
            h("span", { className: `${styles.state} ${styles[status.components[name]]}` }, t.states[status.components[name]]),
          ),
        ),
      ),
      h(
        "p",
        { className: styles.meta },
        `${t.lastCheck.replace("{time}", formatDateTimeHr(status.checkedAt))} ${t.scope}`,
      ),
    ),
  );
}
