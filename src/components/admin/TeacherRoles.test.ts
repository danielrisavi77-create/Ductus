import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";

import TeacherRoles, { type TeacherRolesView } from "./TeacherRoles";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

// DAN-581 (A-02): invented people and dates only.
const t = messagesHr.teacherRoles;
const VIEW: TeacherRolesView = {
  pending: [
    { personId: "00000000-0000-4000-8000-000000000001", name: "Osoba A (test)", revokedAt: null },
    { personId: "00000000-0000-4000-8000-000000000002", name: "Osoba B (test)", revokedAt: "2026-10-19T08:00:00Z" },
  ],
  confirmed: [
    { personId: "00000000-0000-4000-8000-000000000003", name: "Osoba C (test)", confirmedAt: "2026-09-01T10:00:00Z", forReview: false },
    { personId: "00000000-0000-4000-8000-000000000004", name: "Osoba D (test)", confirmedAt: "2026-09-02T23:30:00Z", forReview: true },
  ],
};
const render = (view: TeacherRolesView) => renderToStaticMarkup(h(TeacherRoles, { view }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const count = (html: string, s: string) => html.split(s).length - 1;

describe("TeacherRoles", () => {
  it("offers confirmation to each waiting person and revocation to each confirmed one", () => {
    const html = render(VIEW);
    expect(count(html, `>${t.confirmAction}</button>`)).toBe(2);
    expect(count(html, `>${t.revokeAction}</button>`)).toBe(2);
    for (const p of [...VIEW.pending, ...VIEW.confirmed]) expect(html).toContain(p.name);
  });

  it("dates in Europe/Zagreb, the same on the server and in the browser", () => {
    const body = text(render(VIEW));
    expect(body).toContain(`${t.pending.revokedOn} 19. listopada 2026.`);
    expect(body).toContain(`${t.confirmed.confirmedOn} 3. rujna 2026.`);
  });

  it("marks only the person whose last sign-in gave no right, and as review, not revocation (P7)", () => {
    const html = render(VIEW);
    expect(count(html, t.review.mark)).toBe(1);
    const flagged = html.slice(html.indexOf("Osoba D (test)"));
    expect(flagged).toContain(t.review.note);
    expect(html.slice(html.indexOf("Osoba C (test)"), html.indexOf("Osoba D (test)"))).not.toContain(t.review.mark);
  });

  it("shows each empty list as such", () => {
    const body = text(render({ pending: [], confirmed: [] }));
    expect(body).toContain(t.pending.empty);
    expect(body).toContain(t.confirmed.empty);
    expect(body).not.toContain(t.confirmAction);
  });

  it("renders the live regions empty, before any outcome, and the dialog closed", () => {
    const html = render(VIEW);
    expect(html).toContain('<div role="status"></div><div role="alert"></div>');
    expect(html).toMatch(/<dialog[^>]*><\/dialog>/);
  });

  it("shows no forbidden term", () => {
    expect(findForbiddenTerms(text(render(VIEW)))).toEqual([]);
  });
});
