import Link from "next/link";
import { createElement as h } from "react";

import { zagrebParts } from "@/components/summary/zagreb-time";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { courseMotif } from "./course-motif";
import type { MyCourse } from "./my-assignments-read";
import styles from "./MyAssignments.module.css";

const t = messagesHr.student.assignments;
const home = messagesHr.student.home;

/** `Rok: 30. studenoga 2026. u 23:59`, always in Europe/Zagreb, as on the teacher's list. */
function dueHr(iso: string): string {
  const parts = zagrebParts(iso);
  return home.due.replace("{time}", parts === null ? iso : `${parts.date} ${messagesHr.teacherCourses.at} ${parts.time}`);
}

/**
 * #711 contract 6404612273 as the Archivum course cards of S01 (DAN-344): one
 * card per own course with its decorative motif, and in it the assignments
 * of the current version. Only what the read returns: no work state, mentor
 * or edit time. "Pročitaj upute" when the current version's notice is not
 * acknowledged, else "Otvori zadatak"; both go to /rad, which decides access
 * and sends an unacknowledged notice to /zadatak/<id> (PRODUCT §5 rule 6).
 * The list arrives ordered from the read and is drawn as it comes. Written
 * with `createElement`, like TeacherCourses, so unit tests need no JSX compiler.
 * `level` is the course name's heading level: h3 under the "Moji kolegiji" h2
 * of S01, h2 right under the page h1 of S02, so no heading level is skipped.
 */
export default function MyAssignments({ courses, level = 3 }: { courses: readonly MyCourse[]; level?: 2 | 3 }) {
  return h("div", { className: styles.grid },
    courses.map((course) =>
      h("section", { key: course.id, className: styles.course, "aria-labelledby": `kolegij-${course.id}` },
        h("header", { className: styles.head, "data-motif": courseMotif(course.id) },
          h("p", { className: styles.eyebrow }, home.courseLabel),
          h(`h${level}`, { id: `kolegij-${course.id}`, className: styles.courseName }, course.name)),
        course.assignments.length === 0
          ? h("p", { className: styles.none }, t.noAssignments)
          : h("ul", { className: styles.assignments },
            course.assignments.map((assignment) =>
              h("li", { key: assignment.id },
                h(Link, { className: styles.assignment, href: `/rad?zadatak=${assignment.id}` },
                  h("span", { className: styles.title }, assignment.title),
                  h("span", { className: styles.bottom },
                    h("span", { className: styles.due }, dueHr(assignment.dueAt)),
                    h("span", { className: styles.action },
                      assignment.noticeFirst ? home.readNotice : home.open,
                      h("span", { "aria-hidden": "true", className: styles.arrow }, "→"))))))))));
}
