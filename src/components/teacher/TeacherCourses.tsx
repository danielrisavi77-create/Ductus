import Link from "next/link";
import { createElement as h, Fragment } from "react";

import { zagrebParts } from "@/components/summary/zagreb-time";
import { countHr } from "@/lib/i18n/hr";
import { messagesHr } from "@/lib/i18n/messages.hr";
import type { AssignmentSubmission } from "@/server/evidence/assignment-submissions";
import type { TeacherCourse } from "@/server/institution/teacher-courses";

import styles from "./TeacherCourses.module.css";

const t = messagesHr.teacherCourses;
const workTypes: Record<string, string> = messagesHr.teacher.assignment.workTypes;
const years: Record<string, string> = messagesHr.teacher.course.years;

/** `2026/2027` as `2026./2027.`, the form the course form shows. */
function yearHr(year: string): string {
  return years[year] ?? year.replace(/^(\d{4})\/(\d{4})$/, "$1./$2.");
}

/**
 * `31. listopada 2026. u 23:59`, always in Europe/Zagreb: the page renders on
 * the server, so the clock of neither host nor browser may decide it.
 */
function dueHr(iso: string): string {
  const parts = zagrebParts(iso);
  return parts === null ? iso : `${parts.date} ${t.at} ${parts.time}`;
}

/**
 * DAN-332 PR 4 (#826 c.6427128741): the state of one submission as text.
 * "After the deadline" only for a submitted work; colour never carries it (D-128).
 */
function submissionHr(row: AssignmentSubmission): string {
  if (row.submitted !== true) return t.submission.none;
  return row.afterDeadline === true ? t.submission.afterDeadline : t.submission.onTime;
}

/**
 * F2 (#711): the works of one assignment as links to the live view, numbered
 * in the order the database returns them, each with the state of its
 * submission from the same read (DAN-332 PR 4). A student without a work has
 * no link and is not listed. No name, id, revision or time is shown: the
 * read names no name (names arrive with B-11). `null` is a failed read, said
 * as such, never as "no works" or "not submitted".
 */
function Works({ works }: { works: readonly AssignmentSubmission[] | null | undefined }) {
  if (works === undefined) return null;
  if (works === null) return h("p", { className: styles.works, role: "status" }, t.worksUnavailable);
  const listed = works.flatMap((row) => (row.documentId === null ? [] : [{ row, documentId: row.documentId }]));
  if (listed.length === 0) return h("p", { className: styles.works }, t.noWorks);
  return h("ul", { className: styles.works, "aria-label": t.worksLabel },
    listed.map(({ row, documentId }, i) =>
      h("li", { key: documentId },
        h(Link, { href: `/nastavnik/rad/${encodeURIComponent(documentId)}`, prefetch: false }, `${t.work} ${i + 1}`),
        h("span", { className: styles.submission }, ` · ${submissionHr(row)}`))));
}

/**
 * Z3 (A), design dopuna-faza-a screen 1. The list arrives ordered from the
 * route (year, name; assignments by due time) and is drawn as it comes: the
 * number of students is shown, never used to order or mark anything.
 *
 * Written with `createElement`, not JSX, like ProcessSummaryView: the unit
 * tests render it without the Next.js compiler (`jsx: preserve`).
 */
export default function TeacherCourses({ courses, works = {} }: {
  courses: readonly TeacherCourse[];
  /** Per assignment id: one row per student with the work and its submission, or null when they could not be read. */
  works?: Readonly<Record<string, readonly AssignmentSubmission[] | null>>;
}) {
  if (courses.length === 0) {
    return h("section", { className: styles.empty, "aria-labelledby": "bez-kolegija" },
      h("h2", { id: "bez-kolegija" }, t.empty),
      h("p", null, t.emptyLead),
      h(Link, { className: "btn", href: "/nastavnik/zadatak/novi" }, t.newCourse));
  }
  return h(Fragment, null,
    courses.map((course) =>
      h("section", { key: course.id, className: styles.course, "aria-labelledby": `kolegij-${course.id}` },
        h("header", { className: styles.courseHead },
          h("h2", { id: `kolegij-${course.id}` }, course.name),
          h("span", { className: styles.year }, yearHr(course.academicYear))),
        course.assignments.length === 0
          ? h("p", { className: styles.none }, t.noAssignments)
          : h("ul", { className: styles.assignments },
            course.assignments.map((assignment) =>
              h("li", { key: assignment.id, className: styles.assignment },
                h("span", { className: styles.title }, assignment.title),
                h("span", { className: styles.meta },
                  workTypes[assignment.workType] ? `${workTypes[assignment.workType]} · ` : null,
                  `${t.due} ${dueHr(assignment.dueAt)}`),
                h("span", { className: styles.count },
                  countHr(assignment.enrolledStudents, t.students.one, t.students.few, t.students.many)),
                h(Works, { works: works[assignment.id] })))))),
    h("p", { className: styles.note }, t.countNote));
}
