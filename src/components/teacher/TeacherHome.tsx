import Link from "next/link";
import { createElement as h } from "react";

import { messagesHr } from "@/lib/i18n/messages.hr";
import type { AssignmentWork } from "@/server/evidence/assignment-works";
import type { TeacherCourse, TeacherCoursesRead } from "@/server/institution/teacher-courses";

import TeacherCourses from "./TeacherCourses";
import styles from "./TeacherHome.module.css";

const t = messagesHr.teacherCourses;

/**
 * DAN-344, Archivum T01 on /nastavnik (#923 c.6433823712 §2): the heading and
 * one state of the one courses read. A refused session and a person who is
 * not a teacher both read "no course", without saying which (Z3 A). A failed
 * read is its own alert, never the first-course state. Mentorships, ISVU and
 * links without a target are left out until something stands behind them.
 * Written with `createElement`, so unit tests need no JSX compiler.
 */
export default function TeacherHome({ read, works }: {
  /** null: no session cookie. */
  read: TeacherCoursesRead | null;
  works: Readonly<Record<string, readonly AssignmentWork[] | null>>;
}) {
  const courses = read?.kind === "ok" ? read.courses : read === null || read.kind === "unavailable" ? null : [];
  const listed = courses !== null && courses.length > 0;
  const empty = courses !== null && courses.length === 0;
  return h("div", { className: styles.home },
    h("header", { className: styles.heading },
      h("div", null,
        h("h1", { className: styles.title }, listed ? t.heading : t.title),
        listed ? h("p", { className: styles.lede }, t.lede) : empty ? h("p", { className: styles.lede }, t.emptyLede) : null)),
    body(read, courses, works));
}

function body(
  read: TeacherCoursesRead | null,
  courses: readonly TeacherCourse[] | null,
  works: Readonly<Record<string, readonly AssignmentWork[] | null>>,
) {
  if (read === null) {
    return h("div", { className: styles.state },
      h("p", { role: "status" }, messagesHr.teacher.signedOut),
      // An OIDC login: a real navigation, not a prefetchable Link.
      h("p", null, h("a", { href: "/api/auth/login?returnTo=%2Fnastavnik" }, messagesHr.teacher.signIn)));
  }
  if (courses === null) {
    return h("div", { className: styles.state },
      h("p", { role: "alert", className: styles.alert }, t.unavailable),
      // A plain reload of the route: the read runs again on the server.
      h("p", null, h("a", { className: styles.retry, href: "/nastavnik" }, t.retry)));
  }
  if (courses.length === 0) return firstCourse();
  return h(TeacherCourses, { courses, works });
}

/** T01_prazna: the first arrival. The way on is the existing course and assignment form. */
function firstCourse() {
  return h("div", { className: styles.first },
    h("section", { className: styles.intro, "aria-labelledby": "prvi-kolegij" },
      h("div", { className: styles.text },
        h("p", { className: styles.kicker }, t.firstStep),
        h("h2", { id: "prvi-kolegij", className: styles.firstTitle }, t.empty),
        h("p", { className: styles.firstBody }, t.emptyLead),
        h(Link, { className: "btn", href: "/nastavnik/zadatak/novi" },
          t.newCourse, h("span", { "aria-hidden": "true", className: styles.arrow }, "→")),
        h("p", { className: styles.next }, t.emptyNext)),
      h("div", { className: styles.folio, "aria-hidden": "true" })),
    h("ol", { className: styles.steps },
      t.emptySteps.map((step, i) =>
        h("li", { key: step.title, className: styles.step },
          h("span", { className: styles.number, "aria-hidden": "true" }, String(i + 1).padStart(2, "0")),
          h("span", null,
            h("strong", { className: styles.stepTitle }, step.title),
            h("span", { className: styles.stepBody }, step.body))))),
    h("p", { className: styles.note }, t.emptyNote));
}
