"use client";

import { createElement as h, useState, type ReactNode } from "react";

import { ProcessSummaryView } from "@/components/summary/ProcessSummaryView";
import { messagesHr } from "@/lib/i18n/messages.hr";

import styles from "./FastPath.module.css";
import {
  bySurname,
  fastPathLines,
  fullName,
  whenText,
  type FastPathLoad,
  type FastPathRecord,
  type FastPathStudent,
  type WorkState,
} from "./fast-path";

const t = messagesHr.fastPath;

/**
 * Screen 11, the teacher's fast path (F-11, D-80 point 2; design demo-tok-v2
 * step 5). Students by surname on the left; for the chosen one the four lines,
 * the state of the record, and either the text or the process summary.
 *
 * It only reads: no comment, no revision request, nothing sent to the
 * server. Comments on a paragraph are screen 12. The lines are facts in
 * words, with no percentage, score or order (PRODUCT §5 rule 2), and the
 * summary is the student's own component (rule 5).
 *
 * Written with `createElement`, not JSX, so the unit tests can render it.
 */
export type FastPathProps = { readonly load: FastPathLoad };

export function FastPath({ load }: FastPathProps) {
  if (load.state === "loading") return h("p", { className: styles.state, role: "status" }, t.loading);
  if (load.state === "unavailable") return h("p", { className: styles.state, role: "alert" }, t.unavailable);
  if (load.students.length === 0) return h("p", { className: styles.state }, t.noStudents);
  return h(Roster, { students: bySurname(load.students) });
}

function Roster({ students }: { readonly students: readonly FastPathStudent[] }) {
  const [selectedId, setSelectedId] = useState(students[0]!.id);
  const [view, setView] = useState<"text" | "summary">("text");
  const [marked, setMarked] = useState(false);
  const current = students.find((s) => s.id === selectedId) ?? students[0]!;

  const pick = (id: string) => {
    setSelectedId(id);
    setMarked(false);
  };

  return h(
    "div",
    { className: styles.layout },
    h(
      "nav",
      { className: styles.students, "aria-label": t.studentsLabel },
      h("h2", { className: styles.navTitle }, t.studentsTitle),
      h(
        "ul",
        { className: styles.list },
        students.map((s) =>
          h(
            "li",
            { key: s.id },
            h(
              "button",
              {
                type: "button",
                className: styles.student,
                "aria-current": s.id === current.id ? "true" : undefined,
                onClick: () => pick(s.id),
              },
              h("span", { className: styles.name }, fullName(s)),
              workState(s.work),
              h("span", { className: styles.meta }, whenText(s.lastChangeAt)),
            ),
          ),
        ),
      ),
    ),
    h(
      "section",
      { className: styles.work, "aria-labelledby": "brz-put-student" },
      h(
        "div",
        { className: styles.head },
        h("h2", { id: "brz-put-student", className: styles.studentName }, fullName(current)),
        workState(current.work),
        current.record
          ? h(
              "div",
              { className: styles.toggle, role: "group", "aria-label": t.viewLabel },
              (["text", "summary"] as const).map((v) =>
                h(
                  "button",
                  { key: v, type: "button", "aria-pressed": view === v, onClick: () => setView(v) },
                  t.views[v],
                ),
              ),
            )
          : null,
      ),
      current.record
        ? h(Record, {
            student: current,
            record: current.record,
            view,
            marked,
            onMark: () => {
              setMarked(true);
              setView("text");
            },
          })
        : h("p", { className: styles.state }, t.noRecordYet),
      h("p", { className: styles.open }, t.openWork, " ", h("span", { className: "soon" }, t.soon)),
    ),
  );
}

/**
 * #732 item 17: the state of a work, with a dot in its token colour before the
 * word. The word carries the meaning; the dot only helps the eye find it and is
 * hidden from assistive technology. The list stays in surname order (D-80).
 */
function workState(work: WorkState) {
  return h(
    "span",
    { className: styles.meta },
    h("span", { className: styles.dot, "data-work": work, "aria-hidden": "true" }),
    t.work[work],
  );
}

type RecordProps = {
  readonly student: FastPathStudent;
  readonly record: FastPathRecord;
  readonly view: "text" | "summary";
  readonly marked: boolean;
  readonly onMark: () => void;
};

function Record({ student, record, view, marked, onMark }: RecordProps) {
  const lines = fastPathLines(student, record);
  const pasted = new Set(record.pastesWithoutSource);
  return h(
    "div",
    { className: styles.record },
    h(
      "dl",
      { className: styles.lines },
      lines.flatMap((line) => [
        h("dt", { key: `${line.key}-k` }, line.label),
        h(
          "dd",
          { key: `${line.key}-v`, "data-line": line.key },
          line.key === "pastes" && pasted.size > 0
            ? h("button", { type: "button", className: styles.linkButton, onClick: onMark, "aria-pressed": marked }, line.value)
            : line.value,
        ),
      ]),
    ),
    view === "summary"
      ? h(ProcessSummaryView, { summary: record.summary })
      : h(
          "article",
          { className: styles.text, "aria-label": t.textLabel },
          record.blocks.map((block, i): ReactNode => {
            if (block.kind === "heading") return h("h3", { key: i, className: styles.blockHeading }, block.text);
            const isPasted = pasted.has(i);
            return h(
              "div",
              { key: i, className: styles.block, "data-marked": isPasted && marked ? "true" : undefined },
              h("p", null, block.text),
              isPasted ? h("span", { className: styles.tag }, t.pastedTag) : null,
            );
          }),
        ),
  );
}
