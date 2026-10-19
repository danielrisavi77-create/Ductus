import { createElement as h, type ReactNode } from "react";

import type { NoticeView } from "@/components/student/assignment-notice-read";
import { zagrebParts } from "@/components/summary/zagreb-time";
import { AI_PURPOSES } from "@/components/teacher/assignment-create";
import { messagesHr } from "@/lib/i18n/messages.hr";

import styles from "./SidePanels.module.css";

/**
 * "Upute" and "Rad" of the right panel (FE-D9, design editor-v11 §5.1). Both
 * render one `PanelLoad`, so each has its loading, error and empty state
 * before any data source is wired: the page passes invented data of the
 * real shape until the reads exist (#476), and only the source changes then.
 *
 * Upute reads the `NoticeView` the S3 notice reads (F-7): the task, its due
 * time in Zagreb wall-clock (the same text on every machine) and the uses of
 * tools article 8 allows. The FPZG form check is not built: its profile is
 * not confirmed (design README §9.4), so the panel says where it will be and
 * shows no invented finding. Rad lists the stages read-only; the actions of
 * the handoff (submit a stage, AI statement, package) are marked "uskoro".
 * Text is rendered as React text, never as HTML. Written with createElement,
 * like ProcessSummaryView, so the unit tests render it without a JSX step.
 */

const t = messagesHr.workspace;
const tools = messagesHr.teacher.tools;

export type PanelLoad<T> =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "empty" }
  | { kind: "ready"; value: T };

export type StageState = keyof typeof t.rad.stageState;

export type WorkStage = {
  id: string;
  name: string;
  state: StageState;
  /** The mentor's note when a stage was returned or approved with one. */
  note?: string;
};

export type WorkOverview = { stages: readonly WorkStage[] };

/** The shared states before the data is ready. */
function notReady(load: Exclude<PanelLoad<unknown>, { kind: "ready" }>, empty: string): ReactNode {
  if (load.kind === "loading") return h("p", { className: "rail-empty", role: "status" }, t.panelLoading);
  if (load.kind === "unavailable") return h("p", { className: styles.error, role: "alert" }, t.panelUnavailable);
  return h("p", { className: "rail-empty" }, empty);
}

const soon = () => h("span", { className: "soon" }, t.soon);

function part(id: string, title: ReactNode, ...children: ReactNode[]): ReactNode {
  return h(
    "section",
    { className: styles.part, "aria-labelledby": id },
    h("h3", { id, className: styles.label }, title),
    ...children,
  );
}

function dueText(iso: string): string | null {
  const parts = zagrebParts(iso);
  return parts ? t.upute.due.replace("{date}", parts.date).replace("{time}", parts.time) : null;
}

export function InstructionsPanel({ load }: { load: PanelLoad<NoticeView> }): ReactNode {
  if (load.kind !== "ready") return notReady(load, t.instructionsEmpty);
  const view = load.value;
  const due = dueText(view.dueAt);
  const allowed = AI_PURPOSES.filter((purpose) => view.aiPurposes.includes(purpose));
  return h(
    "div",
    { className: styles.panel },
    part(
      "upute-task",
      t.upute.task,
      h("p", { className: styles.title }, view.title),
      due ? h("p", { className: styles.meta }, due) : null,
      h("p", { className: styles.text }, view.instructions),
    ),
    part(
      "upute-tools",
      t.upute.toolsAllowed,
      allowed.length > 0
        ? h("ul", { className: styles.list }, ...allowed.map((purpose) => h("li", { key: purpose }, tools.purposes[purpose])))
        : h("p", { className: styles.text }, t.upute.toolsNone),
    ),
    part(
      "upute-checks",
      [t.upute.checks, " ", h("span", { key: "soon", className: "soon" }, t.soon)],
      h("p", { className: "rail-empty" }, t.upute.checksSoon),
      h("p", { className: styles.meta }, t.upute.checksNote),
    ),
  );
}

function stageItem(stage: WorkStage): ReactNode {
  return h(
    "li",
    { key: stage.id, className: styles.stage },
    h("span", { className: styles.stageName }, stage.name),
    h("span", { className: styles.stageState, "data-state": stage.state }, t.rad.stageState[stage.state]),
    stage.note ? h("p", { className: styles.note }, t.rad.mentorNote.replace("{note}", stage.note)) : null,
  );
}

export function WorkPanel({ load }: { load: PanelLoad<WorkOverview> }): ReactNode {
  if (load.kind !== "ready") return notReady(load, t.workEmpty);
  const { stages } = load.value;
  return h(
    "div",
    { className: styles.panel },
    part(
      "rad-stages",
      t.rad.stages,
      stages.length > 0
        ? h("ol", { className: styles.stages }, ...stages.map(stageItem))
        : h("p", { className: "rail-empty" }, t.rad.stagesEmpty),
    ),
    part(
      "rad-attachments",
      t.rad.attachments,
      h(
        "ul",
        { className: styles.actions },
        h("li", null, t.rad.aiStatement, " ", soon()),
        h("li", null, t.rad.package, " ", soon()),
      ),
    ),
  );
}
