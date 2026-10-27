import Link from "next/link";
import { createElement as h } from "react";

import { messagesHr } from "@/lib/i18n/messages.hr";

import MyAssignments from "./MyAssignments";
import type { MyAssignmentsRead } from "./my-assignments-read";
import styles from "./StudentHome.module.css";

const t = messagesHr.student.assignments;
const home = messagesHr.student.home;

/**
 * DAN-344, Archivum S01 on /zadaci: the page heading and one of the read's
 * states. Unavailable is its own panel, never the empty list and never an
 * older list: the read keeps nothing. Signed out keeps the AAI@EduHr sign-in
 * of #711 (D-09). Written with `createElement`, like MyAssignments, so unit
 * tests need no JSX compiler.
 */
export default function StudentHome({ read }: { read: MyAssignmentsRead }) {
  // Subtitle and enrol action only beside a list that loaded: the
  // unavailable state shows the title alone, as in the package, and the
  // empty list brings its own way to enrol.
  const ready = read.kind === "ready";
  return h("div", { className: styles.home },
    h("header", { className: styles.heading },
      h("div", null,
        h("h1", { className: styles.title }, home.heading),
        ready ? h("p", { className: styles.lede }, home.lede) : null),
      ready && read.courses.length > 0 ? h(Link, { className: styles.enroll, href: "/upis" },
        h("span", { "aria-hidden": "true", className: styles.plus }, "+"), t.enroll) : null),
    body(read));
}

function body(read: MyAssignmentsRead) {
  if (read.kind === "signedOut") {
    return h("div", { className: styles.state },
      h("p", { role: "status" }, t.signedOut),
      // An OIDC login: a real navigation, not a prefetchable Link.
      h("p", null, h("a", { className: "btn", href: "/api/auth/login?returnTo=%2Fzadaci" }, messagesHr.student.signIn)));
  }
  if (read.kind === "unavailable") {
    return h("section", { className: styles.state, role: "alert", "aria-labelledby": "zadaci-nedostupno" },
      h("h2", { id: "zadaci-nedostupno", className: styles.stateTitle }, home.unavailableHeading),
      h("p", { className: styles.stateBody }, home.unavailableBody),
      // A plain reload of the route: the read runs again on the server.
      h("p", null, h("a", { className: styles.enroll, href: "/zadaci" }, messagesHr.auth.retry)));
  }
  if (read.courses.length === 0) {
    return h("div", { className: styles.state },
      h("p", null, t.empty),
      h("p", null, h(Link, { className: "btn", href: "/upis" }, t.enroll)));
  }
  return h("section", { "aria-labelledby": "moji-kolegiji" },
    h("h2", { id: "moji-kolegiji", className: styles.sectionTitle }, home.courses),
    h(MyAssignments, { courses: read.courses }));
}
