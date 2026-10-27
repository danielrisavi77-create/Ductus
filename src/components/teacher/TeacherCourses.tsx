import Link from "next/link";
import { createElement as h } from "react";

import { courseMotif } from "@/components/student/course-motif";
import { messagesHr } from "@/lib/i18n/messages.hr";
import type { TeacherCourse } from "@/server/institution/teacher-courses";

import { yearHr } from "./course-format";
import styles from "./TeacherCourses.module.css";

const t = messagesHr.teacherCourses;

/**
 * DAN-344, Archivum T01 (#923 c.6433823712 §2): "Moji kolegiji" as course
 * cards with the decorative motif of the course id, each leading to its T02
 * page, where the assignments and works now are (T-b, c.6433852901). Drawn
 * in the order the route gives (year, name). The year sits by the section
 * heading when every course shares it, and on each card otherwise.
 *
 * Written with `createElement`, not JSX, like ProcessSummaryView: the unit
 * tests render it without the Next.js compiler (`jsx: preserve`).
 */
export default function TeacherCourses({ courses }: { courses: readonly TeacherCourse[] }) {
  const shared = courses.every((course) => course.academicYear === courses[0]?.academicYear) ? courses[0]?.academicYear : undefined;
  return h("section", { className: styles.section, "aria-labelledby": "moji-kolegiji" },
    h("div", { className: styles.sectionHead },
      h("h2", { id: "moji-kolegiji", className: styles.sectionTitle }, t.title),
      shared === undefined ? null : h("span", { className: styles.year }, yearHr(shared))),
    h("div", { className: styles.grid },
      courses.map((course) =>
        h("section", { key: course.id, className: styles.course, "aria-labelledby": `kolegij-${course.id}` },
          h("header", { className: styles.head, "data-motif": courseMotif(course.id) },
            h("p", { className: styles.eyebrow }, t.courseLabel),
            h("h3", { id: `kolegij-${course.id}`, className: styles.courseName }, course.name),
            shared === undefined ? h("span", { className: styles.year }, yearHr(course.academicYear)) : null),
          h(Link, { className: styles.open, href: `/nastavnik/kolegij/${encodeURIComponent(course.id)}`, "aria-describedby": `kolegij-${course.id}` },
            t.openCourse, h("span", { "aria-hidden": "true", className: styles.arrow }, "→"))))),
    h("p", { className: styles.inside }, t.inside),
    // Owner, #923 c.6435071376 point 2: the way to a new course, small, under the cards.
    h("p", { className: styles.more }, h(Link, { href: "/nastavnik/zadatak/novi" }, t.newCourseLink)));
}
