import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";
import type { StudentWorkspaceItem, StudentWorkspaceRead } from "@/server/institution/student-workspace";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import StudentWorkspace from "./StudentWorkspace";
import { filterWorkspace, itemHref, paramOf, workState, yearsOf } from "./student-workspace-view";

const t = messagesHr.student.works;

// Invented courses and assignments only.
function item(n: number, over: Partial<StudentWorkspaceItem> = {}): StudentWorkspaceItem {
  return {
    assignmentId: `10000000-0000-4000-8000-00000000000${n}`,
    courseId: "00000000-0000-4000-8000-00000000000a",
    courseName: "Izmišljeni kolegij A",
    academicYear: "2026/2027",
    title: `Izmišljeni esej ${n}`,
    opensAt: "2026-10-01T08:00:00.000Z",
    dueAt: "2026-11-30T22:59:00.000Z",
    currentVersion: 1,
    acknowledged: true,
    documentId: null,
    serverRevision: null,
    submittedRevision: null,
    submittedAt: null,
    afterDeadline: null,
    ...over,
  };
}

const started = { documentId: "doc-1", serverRevision: 4 };
const ITEMS = [
  item(1, { title: "Čitanje naglas", acknowledged: false, currentVersion: 2 }),
  item(2, { courseName: "Izmišljeni kolegij B", academicYear: "2025/2026", ...started }),
  item(3, { ...started, submittedRevision: 4, submittedAt: "2026-11-02T10:15:00.000Z", afterDeadline: false }),
];

describe("filterWorkspace (DAN-309)", () => {
  it("only narrows the received items, keeping their order", () => {
    expect(filterWorkspace(ITEMS, { q: "", year: "" })).toEqual(ITEMS);
    expect(filterWorkspace(ITEMS, { q: "citanje", year: "" }).map((i) => i.title)).toEqual(["Čitanje naglas"]);
    expect(filterWorkspace(ITEMS, { q: "kolegij b", year: "" })).toEqual([ITEMS[1]]);
    expect(filterWorkspace(ITEMS, { q: "esej", year: "2026/2027" })).toEqual([ITEMS[2]]);
    expect(filterWorkspace(ITEMS, { q: "", year: "2019/2020" })).toEqual([]);
    expect(filterWorkspace([], { q: "esej", year: "" })).toEqual([]);
  });

  it("lists only the years the read returned, newest first", () => {
    expect(yearsOf(ITEMS)).toEqual(["2026/2027", "2025/2026"]);
    expect(yearsOf([])).toEqual([]);
  });

  it("reads one plain value from the query", () => {
    expect(paramOf(undefined)).toBe("");
    expect(paramOf("  esej ")).toBe("esej");
    expect(paramOf(["a", "b"])).toBe("a");
    expect(paramOf("x".repeat(300))).toHaveLength(200);
  });
});

describe("workState (DAN-309)", () => {
  it("tells one state from the server's fields, the notice first", () => {
    expect(workState(ITEMS[0]!)).toEqual({ kind: "newVersion", version: 2 });
    expect(workState(item(4, { acknowledged: false }))).toEqual({ kind: "notice" });
    expect(workState(item(4, { acknowledged: false, ...started, submittedAt: "2026-11-02T10:15:00.000Z" })))
      .toEqual({ kind: "notice" });
    expect(workState(item(4))).toEqual({ kind: "notStarted" });
    expect(workState(ITEMS[1]!)).toEqual({ kind: "inProgress" });
    expect(workState(ITEMS[2]!)).toEqual({ kind: "submitted", at: "2026-11-02T10:15:00.000Z", afterDeadline: false });
    expect(workState(item(4, { ...started, submittedRevision: 4, submittedAt: "2026-12-01T10:00:00.000Z", afterDeadline: true })))
      .toMatchObject({ afterDeadline: true });
  });

  it("leads every item through /rad", () => {
    expect(itemHref(ITEMS[0]!)).toBe("/rad?zadatak=10000000-0000-4000-8000-000000000001");
  });
});

const render = (read: StudentWorkspaceRead, q = "", year = "") =>
  renderToStaticMarkup(createElement(StudentWorkspace, { read, filter: { q, year } }));

describe("StudentWorkspace (DAN-309)", () => {
  it("draws one row per item with its state, due time and action through /rad", () => {
    const html = render({ kind: "ok", items: ITEMS });
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html.match(/<article/g)).toHaveLength(3);
    expect(html).toContain(t.state.newVersion.replace("{version}", "2"));
    expect(html).toContain(t.state.inProgress);
    expect(html).toContain("Predano 2. studenoga 2026. u 11:15");
    expect(html).toContain("Rok 30. studenoga 2026. u 23:59");
    expect(html).toContain('href="/rad?zadatak=10000000-0000-4000-8000-000000000001"');
    expect(html).toContain('method="get"');
    expect(html).toContain('<option value="2025/2026">');
    expect(html).not.toContain(t.reset);
  });

  it("says when no item matches, with a way back to all of them", () => {
    const html = render({ kind: "ok", items: ITEMS }, "nepostojeći");
    expect(html).not.toContain("<article");
    expect(html).toContain(t.noMatch);
    expect(html).toContain(t.reset);
    expect(html).not.toContain(t.emptyHeading);
  });

  it("keeps an empty list, an unavailable read and no session apart", () => {
    const empty = render({ kind: "ok", items: [] });
    expect(empty).toContain(t.emptyHeading);
    expect(empty).toContain('href="/upis"');
    expect(empty).not.toContain("<form");
    const unavailable = render({ kind: "unavailable" });
    expect(unavailable).toContain('role="alert"');
    expect(unavailable).not.toContain(t.emptyHeading);
    expect(unavailable).toContain('href="/zadaci/radovi"');
    const signedOut = render({ kind: "unauthorized" });
    expect(signedOut).toContain('href="/api/auth/login?returnTo=%2Fzadaci%2Fradovi"');
    expect(signedOut).not.toContain("<article");
  });

  it("mounts a new filter form for a new filter, so a reset or the back button shows the filter in use", () => {
    // The fields take defaultValue only when they mount and a query change keeps
    // the tree (#1318, review c.6574264038): the form's key must follow the filter.
    const formKey = (filter: { q: string; year: string }): unknown => {
      const find = (node: unknown): ReactElement | null => {
        if (Array.isArray(node)) {
          for (const child of node) {
            const hit = find(child);
            if (hit !== null) return hit;
          }
          return null;
        }
        if (!isValidElement(node)) return null;
        if (node.type === "form") return node;
        return find((node.props as { children?: unknown }).children);
      };
      const form = find(StudentWorkspace({ read: { kind: "ok", items: ITEMS }, filter }));
      expect(form).not.toBeNull();
      return form!.key;
    };
    const none = formKey({ q: "", year: "" });
    const year = formKey({ q: "", year: "2025/2026" });
    expect(none).not.toBeNull();
    expect(year).not.toBe(none);
    expect(formKey({ q: "esej", year: "" })).not.toBe(none);
    expect(formKey({ q: "", year: "" })).toBe(none);
  });

  it("uses no forbidden term", () => {
    for (const read of [{ kind: "ok", items: ITEMS }, { kind: "ok", items: [] }, { kind: "unavailable" }] as const) {
      expect(findForbiddenTerms(render(read as StudentWorkspaceRead).replace(/<[^>]+>/g, " "))).toEqual([]);
    }
  });
});
