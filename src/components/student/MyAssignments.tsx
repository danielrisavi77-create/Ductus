import Link from "next/link";
import { createElement as h } from "react";

import { zagrebParts } from "@/components/summary/zagreb-time";
import { messagesHr } from "@/lib/i18n/messages.hr";

import type { MyCourse } from "./my-assignments-read";
import styles from "./MyAssignments.module.css";

const t = messagesHr.student.assignments;

/** `30. studenoga 2026. u 23:59`, always in Europe/Zagreb, as on the teacher's list. */
function dueHr(iso: string): string {
  const parts = zagrebParts(iso);
  return t.due.replace("{time}", parts === null ? iso : `${parts.date} ${messagesHr.teacherCourses.at} ${parts.time}`);
}

/**
 * #711 contract 6404612273, design S2 "Moji radovi" without the work state.
 * The list arrives ordered from the read and is drawn as it comes; every item
 * links to /rad, which decides access and the notice. Written with
 * `createElement`, like TeacherCourses, so unit tests need no JSX compiler.
 */
export default function MyAssignments({ courses }: { courses: readonly MyCourse[] }) {
  if (courses.length === 0) {
    return h("section", { className: styles.course },
      h("p", { className: styles.none }, t.empty),
      h("p", { className: styles.none }, h(Link, { className: "btn", href: "/upis" }, t.enroll)));
  }
  return courses.map((course) =>
    h("section", { key: course.id, className: styles.course, "aria-labelledby": `kolegij-${course.id}` },
      h("h2", { id: `kolegij-${course.id}`, className: styles.courseHead }, course.name),
      course.assignments.length === 0
        ? h("p", { className: styles.none }, t.noAssignments)
        : h("ul", { className: styles.assignments },
          course.assignments.map((assignment) =>
            h("li", { key: assignment.id },
              h(Link, { className: styles.assignment, href: `/rad?zadatak=${assignment.id}` },
                h("span", { className: styles.title }, assignment.title),
                h("span", { className: styles.meta }, dueHr(assignment.dueAt)),
                assignment.noticeFirst ? h("span", { className: styles.notice }, t.noticeFirst) : null))))));
}
