import Link from "next/link";
import { createElement as h } from "react";

import { zagrebParts } from "@/components/summary/zagreb-time";
import { messagesHr } from "@/lib/i18n/messages.hr";
import type { StudentWorkspaceItem, StudentWorkspaceRead } from "@/server/institution/student-workspace";

import styles from "./StudentWorkspace.module.css";
import { filterWorkspace, itemHref, workState, yearsOf, type WorkspaceFilter } from "./student-workspace-view";

const t = messagesHr.student.works;
const HERE = "/zadaci/radovi";

function whenHr(iso: string): string {
  const parts = zagrebParts(iso);
  return parts === null ? iso : `${parts.date} ${messagesHr.teacherCourses.at} ${parts.time}`;
}

/** The state line and the action of one item, from the server's fields only. */
function stateOf(item: StudentWorkspaceItem): { text: string; tone: string; action: string } {
  const state = workState(item);
  switch (state.kind) {
    case "newVersion":
      return { text: t.state.newVersion.replace("{version}", String(state.version)), tone: "wait", action: t.readNotice };
    case "notice":
      return { text: t.state.notice, tone: "wait", action: t.readNotice };
    case "notStarted":
      return { text: t.state.notStarted, tone: "idle", action: t.start };
    case "inProgress":
      return { text: t.state.inProgress, tone: "idle", action: t.open };
    case "submitted":
      return {
        text: (state.afterDeadline ? t.state.afterDeadline : t.state.submitted).replace("{time}", whenHr(state.at)),
        tone: "done",
        action: t.open,
      };
  }
}

/**
 * DAN-309 (M2.3-P02, contract on #1091, comment 6573005331): "Moji radovi",
 * the row list of docs/design/ductura/pocetna.dc.html in the paper and
 * graphite shell (D-188). One read of app.student_workspace(); the filter is
 * a GET form, so it survives the back button and works without script, and it
 * only narrows what the read returned. Unavailable is its own alert, never an
 * empty list. Written with `createElement`, like StudentHome, so unit tests
 * need no JSX compiler.
 */
export default function StudentWorkspace({ read, filter }: { read: StudentWorkspaceRead; filter: WorkspaceFilter }) {
  return h("div", { className: styles.page },
    h("header", { className: styles.heading },
      h("h1", { className: styles.title }, t.title),
      read.kind === "ok" ? h("p", { className: styles.lede }, t.lede) : null),
    body(read, filter));
}

function body(read: StudentWorkspaceRead, filter: WorkspaceFilter) {
  if (read.kind === "unauthorized") {
    return h("div", { className: styles.state },
      h("p", { role: "status" }, messagesHr.student.assignments.signedOut),
      // An OIDC login (D-09): a real navigation, not a prefetchable Link.
      h("p", null, h("a", { className: "btn", href: `/api/auth/login?returnTo=${encodeURIComponent(HERE)}` },
        messagesHr.student.signIn)));
  }
  if (read.kind !== "ok") {
    return h("section", { className: styles.state, role: "alert", "aria-labelledby": "radovi-nedostupno" },
      h("h2", { id: "radovi-nedostupno", className: styles.stateTitle }, messagesHr.student.home.unavailableHeading),
      h("p", { className: styles.stateBody }, messagesHr.student.home.unavailableBody),
      // A plain reload: the read runs again on the server.
      h("p", null, h("a", { className: styles.secondary, href: HERE }, messagesHr.auth.retry)));
  }
  if (read.items.length === 0) {
    return h("section", { className: styles.state, "aria-labelledby": "radovi-prazno" },
      h("h2", { id: "radovi-prazno", className: styles.stateTitle }, t.emptyHeading),
      h("p", { className: styles.stateBody }, t.emptyBody),
      h("p", null, h(Link, { className: styles.secondary, href: "/upis" }, t.enroll)));
  }
  const shown = filterWorkspace(read.items, filter);
  const years = yearsOf(read.items);
  if (filter.year !== "" && !years.includes(filter.year)) years.push(filter.year);
  return h("div", null,
    // Keyed by the filter: a client navigation (Poništi, back) keeps the form
    // mounted, so its default values would otherwise stay on the old filter.
    // autoComplete off: on back after a GET submit the browser would restore the
    // text typed before submitting, so the fields would not match the list.
    h("form", { key: JSON.stringify([filter.q, filter.year]), className: styles.filter, method: "get", action: HERE, role: "search" },
      h("label", { className: styles.field },
        h("span", { className: styles.label }, t.search),
        h("input", { type: "search", name: "q", defaultValue: filter.q, maxLength: 200, autoComplete: "off", className: styles.input })),
      h("label", { className: styles.field },
        h("span", { className: styles.label }, t.year),
        h("select", { name: "godina", defaultValue: filter.year, autoComplete: "off", className: styles.input },
          h("option", { value: "" }, t.allYears),
          years.map((year) => h("option", { key: year, value: year }, year)))),
      h("button", { type: "submit", className: "btn" }, t.apply),
      filter.q !== "" || filter.year !== "" ? h(Link, { className: styles.reset, href: HERE }, t.reset) : null),
    shown.length === 0
      ? h("p", { className: styles.noMatch, role: "status" }, t.noMatch)
      : h("ul", { className: styles.list, "aria-label": t.list }, shown.map(row)));
}

function row(item: StudentWorkspaceItem) {
  const { text, tone, action } = stateOf(item);
  const id = `rad-${item.assignmentId}`;
  return h("li", { key: item.assignmentId },
    h("article", { className: styles.item, "aria-labelledby": id },
      h("div", { className: styles.meta },
        h("p", { className: styles.eyebrow }, `${item.courseName} · ${item.academicYear}`),
        h("h2", { id, className: styles.itemTitle }, item.title),
        h("p", { className: styles.facts },
          h("span", { className: styles.stateText, "data-tone": tone }, text),
          h("span", { className: styles.due }, t.due.replace("{time}", whenHr(item.dueAt))))),
      h(Link, { className: styles.action, href: itemHref(item), "aria-describedby": id }, action)));
}
