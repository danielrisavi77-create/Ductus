import { describe, expect, it } from "vitest";

import { displayName, teacherRolesView } from "./teacher-roles-view";

// DAN-581 (A-02): invented people only.
const A = "0b7f3c1e-2d4a-4c5b-9e6f-7a8b9c0d1e2f";
const B = "1c8e4d2f-3e5b-4d6c-8f7a-8b9c0d1e2f3a";

describe("teacherRolesView", () => {
  it("names a person in the nominative, given name first", () => {
    expect(displayName({ givenName: "Lana", familyName: "Probić" })).toBe("Lana Probić");
  });

  it("shows a person without a name as such, never as an empty line or the id", () => {
    expect(displayName(null)).toBe("Ime nije upisano");
    const view = teacherRolesView({ pending: [{ personId: A, name: null, revokedAt: null }], confirmed: [] });
    expect(view.pending[0]!.name).toBe("Ime nije upisano");
    expect(view.pending[0]!.name).not.toContain(A);
  });

  it("keeps the read's order, ids, times and the P7 mark, and adds nothing", () => {
    const view = teacherRolesView({
      pending: [
        { personId: B, name: { givenName: "Petar", familyName: "Uzorak" }, revokedAt: "2026-10-01T08:00:00.000Z" },
        { personId: A, name: null, revokedAt: null },
      ],
      confirmed: [
        { personId: A, name: { givenName: "Iva", familyName: "Modelić" }, confirmedAt: "2026-09-01T10:00:00.000Z", forReview: true },
      ],
    });
    expect(view).toEqual({
      pending: [
        { personId: B, name: "Petar Uzorak", revokedAt: "2026-10-01T08:00:00.000Z" },
        { personId: A, name: "Ime nije upisano", revokedAt: null },
      ],
      confirmed: [{ personId: A, name: "Iva Modelić", confirmedAt: "2026-09-01T10:00:00.000Z", forReview: true }],
    });
  });
});
