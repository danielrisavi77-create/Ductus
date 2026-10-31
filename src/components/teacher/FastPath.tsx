"use client";

import Link from "next/link";
import { createElement as h, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { startFastPathReader } from "@/client/fast-path";
import { watchSessionEnd, type SessionWatch } from "@/client/session-end";
import type { SessionMark } from "@/client/session-marks";
import { ProcessSummaryView } from "@/components/summary/ProcessSummaryView";
import { messagesHr } from "@/lib/i18n/messages.hr";

import styles from "./FastPath.module.css";
import {
  bySurname,
  fastPathLines,
  fullName,
  textRuns,
  whenText,
  type FastPathLoad,
  type FastPathRecord,
  type FastPathStudent,
  type WorkState,
} from "./fast-path";

const t = messagesHr.fastPath;

/**
 * Screen 11, the teacher's fast path (F-11, D-80 point 2; design demo-tok-v2
 * step 5). Students by surname on the left; for the chosen one the lines,
 * the state of the record, and either the text or the process summary.
 *
 * It only reads: no comment, no revision request, nothing sent to the
 * server but the read. Comments on a paragraph are screen 12. The lines are
 * facts in words, with no percentage, score or order (PRODUCT §5 rule 2),
 * and the summary is the student's own component (rule 5).
 *
 * Written with `createElement`, not JSX, so the unit tests can render it.
 */
export type FastPathProps = { readonly load: FastPathLoad; readonly signInHref?: string };

export function FastPath({ load, signInHref = "/api/auth/login" }: FastPathProps) {
  if (load.state === "loading") return h("p", { className: styles.state, role: "status" }, t.loading);
  if (load.state === "unavailable") return h("p", { className: styles.state, role: "alert" }, t.unavailable);
  if (load.state === "signedOut") {
    // An OIDC login: a real navigation, not a prefetchable Link.
    return h("p", { className: styles.state, role: "status" }, messagesHr.teacher.signedOut, " ", h("a", { href: signInHref }, messagesHr.teacher.signIn));
  }
  if (load.state === "pickAssignment") {
    return h("p", { className: styles.state }, t.pickAssignment, " ", h(Link, { href: "/nastavnik" }, messagesHr.home.openTeacher));
  }
  return h(
    "div",
    null,
    load.stale
      ? h("p", { className: styles.note, role: "status" }, t.stale)
      : h("p", { className: styles.note }, t.refresh),
    // A foreign, a missing and an empty assignment look the same (#757 invariant 4).
    load.students.length === 0
      ? h("p", { className: styles.state }, t.empty)
      : h(Roster, { students: bySurname(load.students) }),
  );
}

/**
 * The fast path of one assignment, read from the route at most once per
 * P-03. Once the session of the page ends in this browser, nothing more is
 * sent and the names and texts leave the screen (F-093, D-118).
 */
export function FastPathLive({ assignmentId, session, signInHref }: {
  readonly assignmentId: string; readonly session: SessionMark | null; readonly signInHref: string;
}) {
  const [load, setLoad] = useState<FastPathLoad>({ state: "loading" });
  const [ended, setEnded] = useState(false);
  const watchRef = useRef<SessionWatch | null>(null);
  const tag = session?.tag ?? null;
  const at = session?.at ?? 0;
  useLayoutEffect(() => {
    const watch = watchSessionEnd(tag === null ? null : { tag, at }, () => setEnded(true));
    watchRef.current = watch;
    return () => {
      watch.close();
      if (watchRef.current === watch) watchRef.current = null;
    };
  }, [tag, at]);
  const current = useCallback(() => !(watchRef.current?.ended() ?? false), []);
  useEffect(() => {
    if (ended) return;
    setLoad({ state: "loading" });
    return startFastPathReader({ assignmentId, onChange: setLoad, current });
  }, [assignmentId, current, ended]);
  return h(FastPath, { load: ended ? { state: "signedOut" } : load, signInHref });
}

function Roster({ students }: { readonly students: readonly FastPathStudent[] }) {
  const [selectedId, setSelectedId] = useState(students[0]!.id);
  const [view, setView] = useState<"text" | "summary">("text");
  // The chosen student stays chosen through a refresh while still on the list.
  const current = students.find((s) => s.id === selectedId) ?? students[0]!;

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
                onClick: () => setSelectedId(s.id),
              },
              h("span", { className: styles.name }, fullName(s)),
              workState(s.work),
              h("span", { className: styles.meta }, whenText(s.lastChangeAt)),
            ),
          ),
        ),
      ),
      h("p", { className: styles.orderNote }, t.orderNote),
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
        ? h(Record, { student: current, record: current.record, view })
        : h("p", { className: styles.state }, t.noRecordYet),
      h("p", { className: styles.open }, t.openWork, " ", h("span", { className: "soon" }, t.soon)),
    ),
  );
}

/**
 * #732 item 17: the state of a work, with a dot in its token colour before the
 * word. The word carries the meaning; the dot only helps the eye find it. It is
 * drawn by CSS (`::before`, empty content), so it adds no element and no text for
 * assistive technology. The list stays in surname order (D-80).
 */
function workState(work: WorkState) {
  return h("span", { className: `${styles.meta} ${styles.dot}`, "data-work": work }, t.work[work]);
}

type RecordProps = {
  readonly student: FastPathStudent;
  readonly record: FastPathRecord;
  readonly view: "text" | "summary";
};

function Record({ student, record, view }: RecordProps) {
  const lines = fastPathLines(student, record);
  return h(
    "div",
    { className: styles.record },
    h(
      "dl",
      { className: styles.lines },
      lines.flatMap((line) => [
        h("dt", { key: `${line.key}-k` }, line.label),
        h("dd", { key: `${line.key}-v`, "data-line": line.key }, line.value),
      ]),
    ),
    view === "summary"
      ? h(ProcessSummaryView, { summary: record.summary })
      : h(
          "article",
          { className: styles.text, "aria-label": t.textLabel },
          textRuns(record.blocks).map((run, i): ReactNode => {
            if (run.kind === "heading") return h("h3", { key: i, className: styles.blockHeading }, run.texts[0]);
            const lines = run.texts.map((text, j) => h(run.kind === "bulletItem" ? "li" : "p", { key: j }, text));
            const body = run.kind === "bulletItem" ? h("ul", null, lines) : run.kind === "quote" ? h("blockquote", null, lines) : lines;
            return h("div", { key: i, className: styles.block }, body);
          }),
        ),
  );
}
