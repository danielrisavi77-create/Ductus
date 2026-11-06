import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";
import type { TeacherRoles } from "@/server/institution/teacher-roles";

import { teacherRolesView } from "./teacher-roles-view";

const UNNAMED = messagesHr.teacherRoles.unnamed;
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NAMED = { givenName: "Osoba", familyName: "A (test)" } as const;
const AT = "2026-11-02T09:15:00.000Z";

// DAN-581 PR 3 (contract #1091 c.6677177709): every input class of a row.
// A name is present or null, a pending row has an earlier revocation or none,
// a confirmed row is for review or not; lists are empty or not.
describe("teacherRolesView", () => {
  it.each([
    [NAMED, "Osoba A (test)"],
    [null, UNNAMED],
  ] as const)("shows the name %o as %s in the nominative", (name, want) => {
    const view = teacherRolesView({
      pending: [{ personId: ID(1), name, revokedAt: null }],
      confirmed: [{ personId: ID(2), name, confirmedAt: AT, forReview: false }],
    });
    expect(view.pending[0]!.name).toBe(want);
    expect(view.confirmed[0]!.name).toBe(want);
  });

  it.each([null, AT])("keeps a pending row's revocation %s", (revokedAt) => {
    const view = teacherRolesView({ pending: [{ personId: ID(1), name: NAMED, revokedAt }], confirmed: [] });
    expect(view.pending).toEqual([{ personId: ID(1), name: "Osoba A (test)", revokedAt }]);
  });

  it.each([true, false])("keeps a confirmed row's review mark %s", (forReview) => {
    const view = teacherRolesView({ pending: [], confirmed: [{ personId: ID(2), name: NAMED, confirmedAt: AT, forReview }] });
    expect(view.confirmed).toEqual([{ personId: ID(2), name: "Osoba A (test)", confirmedAt: AT, forReview }]);
  });

  it("keeps two empty lists empty", () => {
    expect(teacherRolesView({ pending: [], confirmed: [] })).toEqual({ pending: [], confirmed: [] });
  });

  it("keeps the order the server sorted, unnamed people last included", () => {
    const roles: TeacherRoles = {
      pending: [
        { personId: ID(3), name: { givenName: "Osoba", familyName: "C (test)" }, revokedAt: null },
        { personId: ID(1), name: { givenName: "Osoba", familyName: "B (test)" }, revokedAt: AT },
        { personId: ID(2), name: null, revokedAt: null },
      ],
      confirmed: [
        { personId: ID(5), name: { givenName: "Osoba", familyName: "E (test)" }, confirmedAt: AT, forReview: true },
        { personId: ID(4), name: null, confirmedAt: AT, forReview: false },
      ],
    };
    const view = teacherRolesView(roles);
    expect(view.pending.map((row) => row.personId)).toEqual([ID(3), ID(1), ID(2)]);
    expect(view.pending.map((row) => row.name)).toEqual(["Osoba C (test)", "Osoba B (test)", UNNAMED]);
    expect(view.confirmed.map((row) => row.personId)).toEqual([ID(5), ID(4)]);
  });

  it("passes on no field the lists do not show", () => {
    const view = teacherRolesView({
      pending: [{ personId: ID(1), name: NAMED, revokedAt: null }],
      confirmed: [{ personId: ID(2), name: NAMED, confirmedAt: AT, forReview: false }],
    });
    expect(Object.keys(view.pending[0]!).sort()).toEqual(["name", "personId", "revokedAt"]);
    expect(Object.keys(view.confirmed[0]!).sort()).toEqual(["confirmedAt", "forReview", "name", "personId"]);
  });
});
