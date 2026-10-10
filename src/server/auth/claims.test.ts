import { describe, expect, it } from "vitest";

import { identityFromClaims } from "./claims";

// Plan of attack #154, items 8, 9 and 10. Synthetic identities only.
const ANA = {
  sub: "sub-ana-001",
  hrEduPersonUniqueID: "ana.demo@demo-fakultet.test",
  hrEduPersonHomeOrg: "demo-fakultet.test",
  mail: "ana.demo@demo-fakultet.test",
};

describe("identityFromClaims", () => {
  it("takes the subject, hrEduPersonUniqueID and home organisation, never e-mail", () => {
    const result = identityFromClaims(ANA);
    expect(result).toStrictEqual({
      ok: true,
      identity: { subject: "sub-ana-001", uniqueId: "ana.demo@demo-fakultet.test", homeOrg: "demo-fakultet.test" },
    });
    expect(identityFromClaims({ ...ANA, mail: undefined })).toStrictEqual(result);
    expect(identityFromClaims({ ...ANA, mail: "ivo.demo@demo-fakultet.test" })).toStrictEqual(result);
  });

  it("refuses a login without hrEduPersonUniqueID, subject or home organisation", () => {
    for (const claim of ["sub", "hrEduPersonUniqueID", "hrEduPersonHomeOrg"]) {
      expect(identityFromClaims({ ...ANA, [claim]: undefined })).toStrictEqual({ ok: false, reason: "missing_claim" });
    }
  });

  it("refuses userinfo for another subject and takes attributes from matching userinfo", () => {
    const ivo = { sub: "sub-ivo-002", hrEduPersonUniqueID: "ivo.demo@demo-fakultet.test" };
    expect(identityFromClaims(ANA, ivo)).toStrictEqual({ ok: false, reason: "subject_mismatch" });
    expect(identityFromClaims(ANA, { hrEduPersonUniqueID: "x" })).toStrictEqual({
      ok: false,
      reason: "subject_mismatch",
    });
    const result = identityFromClaims(
      { sub: ANA.sub },
      { sub: ANA.sub, hrEduPersonUniqueID: ANA.hrEduPersonUniqueID, hrEduPersonHomeOrg: ANA.hrEduPersonHomeOrg },
    );
    expect(result.ok && result.identity.uniqueId).toBe(ANA.hrEduPersonUniqueID);
  });

  it.each([
    ["empty", ""],
    ["256 characters", "a".repeat(256)],
    ["256 code points of two UTF-16 units", "😀".repeat(256)],
    ["a NUL byte", "ana\u0000@demo-fakultet.test"],
    ["a zero-width space", "ana\u200b@demo-fakultet.test"],
    ["a bidi override", "ana\u202e@demo-fakultet.test"],
    ["a line break", "ana\n@demo-fakultet.test"],
    ["a lone surrogate", "ana\ud800@demo-fakultet.test"],
    ["a number", 42],
    ["an array", ["ana"]],
  ])("refuses an identifier with %s, without echoing it", (_label, value) => {
    for (const claim of ["sub", "hrEduPersonUniqueID", "hrEduPersonHomeOrg"]) {
      const result = identityFromClaims({ ...ANA, [claim]: value });
      expect(result).toStrictEqual({ ok: false, reason: "invalid_claim" });
    }
  });

  it("accepts 255 code points, the bound of the database", () => {
    expect(identityFromClaims({ ...ANA, hrEduPersonUniqueID: "😀".repeat(255) }).ok).toBe(true);
    expect(identityFromClaims({ ...ANA, sub: "a".repeat(255) }).ok).toBe(true);
  });

  it("refuses a 10 kB subject", () => {
    expect(identityFromClaims({ ...ANA, sub: "s".repeat(10_240) })).toStrictEqual({ ok: false, reason: "invalid_claim" });
  });
});
