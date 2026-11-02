import Link from "next/link";
import { createElement as h, type ReactNode } from "react";

import { messagesHr } from "@/lib/i18n/messages.hr";

import EmptyHome from "./EmptyHome";
import MyAssignments from "./MyAssignments";
import type { MyAssignmentsRead } from "./my-assignments-read";
import styles from "./StudentHome.module.css";

const t = messagesHr.student.assignments;
const home = messagesHr.student.home;

/** S01 "Vaš studentski prostor" on /zadaci, or S02 "Moji kolegiji" on /zadaci/kolegiji. */
export type StudentView = "home" | "courses";

const PATH: Record<StudentView, string> = { home: "/zadaci", courses: "/zadaci/kolegiji" };

/**
 * DAN-344, Archivum S01 and S02: the page heading and one of the read's
 * states, from the same read. Unavailable is its own panel, never the empty
 * list and never an older list: the read keeps nothing. Signed out keeps the
 * AAI@EduHr sign-in of #711 (D-09). `enroll` is the existing EnrollForm, shown
 * only in the empty state (S01_prazna). Written with `createElement`, like
 * MyAssignments, so unit tests need no JSX compiler.
 */
export default function StudentHome({ read, enroll, view = "home" }: {
  read: MyAssignmentsRead;
  enroll: ReactNode;
  view?: StudentView;
}) {
  // Subtitle and enrol action only beside a list that loaded: the
  // unavailable state shows the title alone, as in the package, and the
  // empty list brings its own way to enrol. S02 has no enrol action.
  const ready = read.kind === "ready";
  const courses = view === "courses";
  return h("div", { className: styles.home },
    h("header", { className: styles.heading },
      h("div", null,
        h("h1", { className: styles.title }, courses ? home.courses : home.heading),
        ready ? h("p", { className: styles.lede }, courses ? home.coursesLede : home.lede) : null),
      !courses && ready && read.courses.length > 0 ? h(Link, { className: styles.enroll, href: "/upis" },
        h("span", { "aria-hidden": "true", className: styles.plus }, "+"), t.enroll) : null),
    body(read, enroll, view));
}

function body(read: MyAssignmentsRead, enroll: ReactNode, view: StudentView) {
  const here = PATH[view];
  if (read.kind === "signedOut") {
    return h("div", { className: styles.state },
      h("p", { role: "status" }, t.signedOut),
      // An OIDC login: a real navigation, not a prefetchable Link.
      h("p", null, h("a", { className: "btn", href: `/api/auth/login?returnTo=${encodeURIComponent(here)}` }, messagesHr.student.signIn)));
  }
  if (read.kind === "unavailable") {
    return h("section", { className: styles.state, role: "alert", "aria-labelledby": "zadaci-nedostupno" },
      h("h2", { id: "zadaci-nedostupno", className: styles.stateTitle }, home.unavailableHeading),
      h("p", { className: styles.stateBody }, home.unavailableBody),
      // A plain reload of the route: the read runs again on the server.
      h("p", null, h("a", { className: styles.enroll, href: here }, messagesHr.auth.retry)));
  }
  if (read.courses.length === 0) {
    return h(EmptyHome, { enroll });
  }
  // On S02 the page heading already says "Moji kolegiji", so the course names
  // are the h2 right under it.
  if (view === "courses") return h(MyAssignments, { courses: read.courses, level: 2 });
  return h("section", { "aria-labelledby": "moji-kolegiji" },
    h("h2", { id: "moji-kolegiji", className: styles.sectionTitle }, home.courses),
    h(MyAssignments, { courses: read.courses }));
}
