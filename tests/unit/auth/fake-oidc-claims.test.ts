import { describe, expect, it } from "vitest";

import { identityFromClaims } from "@/server/auth/claims";

import { ACCOUNTS, DEMO_HOME_ORG, DEMO_HOME_ORG_B, demoAccountClaims } from "../../../infra/fake-oidc/accounts.mjs";

// DAN-483: what the fake provider (local and CI only, D-09) releases goes
// through the same claim parsing as an AAI@EduHr login. Every account here
// is invented.
describe("fake OIDC claims in the AAI@EduHr shape (DAN-483)", () => {
  it.each(Object.keys(ACCOUNTS))("%s yields its own identity and institution", (id) => {
    const account = ACCOUNTS[id];
    const claims = demoAccountClaims(id);
    expect(claims).toBeDefined();
    const result = identityFromClaims(claims!);
    expect(result).toEqual({
      ok: true,
      identity: {
        subject: id,
        uniqueId: `${id}@${account.homeOrg}`,
        homeOrg: account.homeOrg,
        givenName: account.givenName,
        familyName: account.familyName,
        teacherEligible: account.affiliation === "djelatnik",
      },
    });
  });

  it("covers a staff member and a student in each of the two institutions", () => {
    const seen = new Set<string>();
    for (const id of Object.keys(ACCOUNTS)) {
      const result = identityFromClaims(demoAccountClaims(id)!);
      if (!result.ok) throw new Error(`${id} was refused`);
      seen.add(`${result.identity.homeOrg} ${result.identity.teacherEligible}`);
    }
    expect([...seen].sort()).toEqual(
      [`${DEMO_HOME_ORG} false`, `${DEMO_HOME_ORG} true`, `${DEMO_HOME_ORG_B} false`, `${DEMO_HOME_ORG_B} true`].sort(),
    );
  });

  it("a student affiliation gives no teacher right in either institution", () => {
    for (const id of ["demo-student", "demo-student-2", "demo-b-student"]) {
      const result = identityFromClaims(demoAccountClaims(id)!);
      expect(result.ok && result.identity.teacherEligible).toBe(false);
    }
  });

  it("an unknown or inherited id has no claims to log in with", () => {
    for (const id of ["not-a-demo-account", "toString", "__proto__", "constructor"]) {
      expect(demoAccountClaims(id)).toBeUndefined();
    }
  });
});
