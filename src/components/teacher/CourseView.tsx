import Link from "next/link";
import { createElement as h } from "react";

import { courseMotif } from "@/components/student/course-motif";
import { countHr } from "@/lib/i18n/hr";
import { messagesHr } from "@/lib/i18n/messages.hr";
import type { AssignmentWork } from "@/server/evidence/assignment-works";
import type { TeacherAssignment, TeacherCourse, TeacherCoursesRead } from "@/server/institution/teacher-courses";

import styles from "./CourseView.module.css";
import { dueHr, yearHr } from "./course-format";

const t = messagesHr.teacherCourse;
const tc = messagesHr.teacherCourses;
const workTypes: Record<string, string> = messagesHr.teacher.assignment.workTypes;

type Works = Readonly<Record<string, readonly AssignmentWork[] | null>>;

/**
 * The course the read returned under this id, or null. The id in the address
 * is only an address: a course the read does not return, whether it does not
 * exist or is another teacher's, is the same null.
 */
export function courseOf(read: TeacherCoursesRead | null, id: string): TeacherCourse | null {
  if (read?.kind !== "ok") return null;
  const wanted = id.toLowerCase();
  return read.courses.find((course) => course.id === wanted) ?? null;
}

/**
 * DAN-344, Archivum T02 on /nastavnik/kolegij/[id] (#923 c.6433823712 §3,
 * sequencing c.6433852901): the course, its assignments in the read's order
 * and the number of available works of each. Until T04 exists every work is a
 * numbered link to its live view and each assignment keeps its fast path.
 * No students tab and no number of students until Backend offers that read
 * (§7 point 2). Written with `createElement`, so unit tests need no JSX compiler.
 */
export default function CourseView({ read, courseId, works }: {
  /** null: no session cookie. */
  read: TeacherCoursesRead | null;
  courseId: string;
  /** Per assignment id: its works, or null when they could not be read. */
  works: Works;
}) {
  if (read === null) {
    return page(h("h1", { className: styles.title }, tc.title),
      h("div", { className: styles.state },
        h("p", { role: "status" }, messagesHr.teacher.signedOut),
        // An OIDC login: a real navigation, not a prefetchable Link.
        h("p", null, h("a", { href: `/api/auth/login?returnTo=${encodeURIComponent(`/nastavnik/kolegij/${courseId}`)}` }, messagesHr.teacher.signIn))));
  }
  if (read.kind === "unavailable") {
    return page(h("h1", { className: styles.title }, tc.title),
      h("div", { className: styles.state },
        h("p", { role: "alert", className: styles.alert }, tc.unavailable),
        // A plain reload of the route: the read runs again on the server.
        h("p", null, h("a", { className: styles.retry, href: `/nastavnik/kolegij/${encodeURIComponent(courseId)}` }, tc.retry))));
  }
  const course = courseOf(read, courseId);
  if (course === null) {
    return page(h("h1", { className: styles.title }, tc.title),
      h("div", { className: styles.state },
        h("p", { role: "status" }, t.notFound),
        h("p", null, h(Link, { href: "/nastavnik" }, tc.title))));
  }
  return page(
    h("div", { className: styles.heading, "data-motif": courseMotif(course.id) },
      h("h1", { className: styles.title }, course.name),
      h("p", { className: styles.lede }, t.year.replace("{year}", yearHr(course.academicYear)))),
    h("section", { className: styles.list, "aria-labelledby": "zadaci-kolegija" },
      h("h2", { id: "zadaci-kolegija", className: styles.tab }, t.assignments),
      course.assignments.length === 0
        ? h("p", { className: styles.none }, tc.noAssignments)
        : h("div", null,
          h("div", { className: styles.columns, "aria-hidden": "true" },
            h("span", null, t.columns.assignment), h("span", null, t.columns.typeDue), h("span", null, t.columns.works)),
          h("ul", { className: styles.rows },
            course.assignments.map((assignment) => row(assignment, works[assignment.id])))),
      h("p", { className: styles.note }, t.worksNote)));
}

function page(...children: ReturnType<typeof h>[]) {
  return h("div", { className: styles.page }, ...children);
}

function row(assignment: TeacherAssignment, works: readonly AssignmentWork[] | null | undefined) {
  return h("li", { key: assignment.id, className: styles.row },
    h("h3", { className: styles.assignment }, assignment.title),
    h("p", { className: styles.typeDue },
      workTypes[assignment.workType] ? h("span", { className: styles.type }, workTypes[assignment.workType]) : null,
      h("span", { className: styles.due }, dueHr(assignment.dueAt))),
    h("div", { className: styles.works }, worksOf(works)),
    h(Link, { className: styles.fastPath, href: `/nastavnik/brz-put?zadatak=${encodeURIComponent(assignment.id)}`, prefetch: false },
      messagesHr.shell.nav.fastPath));
}

/**
 * F2 (#711): the count, then each work as a link to its live view, numbered in
 * the order the database returns them. No name and no id is shown. `null` is a
 * failed read, said as such, never as "no works".
 */
function worksOf(works: readonly AssignmentWork[] | null | undefined) {
  if (works === undefined) return null;
  if (works === null) return h("p", { role: "status", className: styles.count }, tc.worksUnavailable);
  if (works.length === 0) return h("p", { className: styles.count }, t.noWorks);
  return [
    h("p", { key: "n", className: styles.count }, countHr(works.length, t.works.one, t.works.few, t.works.many)),
    h("ul", { key: "l", className: styles.workLinks, "aria-label": tc.worksLabel },
      works.map((work, i) =>
        h("li", { key: work.documentId },
          h(Link, { href: `/nastavnik/rad/${encodeURIComponent(work.documentId)}`, prefetch: false }, `${tc.work} ${i + 1}`)))),
  ];
}
