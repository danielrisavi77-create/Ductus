import { describe, expect, it } from "vitest";

import { identityFromClaims } from "./claims";

// Plan of attack #154, items 8, 9 and 10. Synthetic identities only.
const ANA = {
  sub: "sub-ana-001",
  hrEduPersonUniqueID: "ana.demo@demo-fakultet.test",
  hrEduPersonHomeOrg: "demo-fakultet.test",
  mail: "ana.demo@demo-fakultet.test",
};
const ANA_IDENTITY = { subject: "sub-ana-001", uniqueId: "ana.demo@demo-fakultet.test", homeOrg: "demo-fakultet.test" };

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

  // QA of #191 (mutant cl5): when both carry an attribute, userinfo wins.
  it("prefers the userinfo attributes over the ID token ones", () => {
    const result = identityFromClaims(ANA, {
      sub: ANA.sub,
      hrEduPersonUniqueID: "ana.userinfo@demo-drugi.test",
      hrEduPersonHomeOrg: "demo-drugi.test",
    });
    expect(result).toStrictEqual({
      ok: true,
      identity: { subject: ANA.sub, uniqueId: "ana.userinfo@demo-drugi.test", homeOrg: "demo-drugi.test" },
    });
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
  it("takes givenName and sn as two separate names (#757, O1)", () => {
    const result = identityFromClaims({ ...ANA, givenName: "Ana", sn: "Testić" });
    expect(result).toStrictEqual({
      ok: true,
      identity: { ...ANA_IDENTITY, givenName: "Ana", familyName: "Testić" },
    });
    // Userinfo takes precedence, as for every other attribute.
    const fromUserinfo = identityFromClaims({ ...ANA, givenName: "Ana", sn: "Testić" }, { sub: ANA.sub, sn: "Primjer" });
    expect(fromUserinfo.ok && fromUserinfo.identity.familyName).toBe("Primjer");
  });

  it("takes given_name and family_name first, and never mixes the two pairs", () => {
    const both = identityFromClaims({ ...ANA, given_name: "Ana", family_name: "Oidcić", givenName: "Ana", sn: "Ldapić" });
    expect(both.ok && both.identity.familyName).toBe("Oidcić");
    const oidc = identityFromClaims({ ...ANA, given_name: "Ana", family_name: "Oidcić" });
    expect(oidc).toStrictEqual({ ok: true, identity: { ...ANA_IDENTITY, givenName: "Ana", familyName: "Oidcić" } });
    // A broken OIDC pair falls back to the whole LDAP pair, never half of each.
    const fallback = identityFromClaims({ ...ANA, given_name: "Ana", family_name: "", givenName: "Ana", sn: "Ldapić" });
    expect(fallback.ok && fallback.identity.familyName).toBe("Ldapić");
    expect(identityFromClaims({ ...ANA, given_name: "Ana", sn: "Ldapić" })).toStrictEqual({ ok: true, identity: ANA_IDENTITY });
  });

  it("logs in without a name when the provider sends a name as an array", () => {
    expect(identityFromClaims({ ...ANA, given_name: ["Ana"], family_name: ["Testić"] })).toStrictEqual({
      ok: true,
      identity: ANA_IDENTITY,
    });
  });

  it.each([
    ["no given name", { sn: "Testić" }],
    ["no family name", { givenName: "Ana" }],
    ["an empty given name", { givenName: "", sn: "Testić" }],
    ["a family name with a line break", { givenName: "Ana", sn: "Tes\ntić" }],
    ["a given name with a zero-width space", { givenName: "A\u200bna", sn: "Testić" }],
    ["a 256-character family name", { givenName: "Ana", sn: "t".repeat(256) }],
    ["a number for a name", { givenName: 7, sn: "Testić" }],
    ["one display name only", { name: "Ana Testić" }],
  ])("logs in without a name when there is %s, never refusing", (_label, names) => {
    expect(identityFromClaims({ ...ANA, ...names })).toStrictEqual({ ok: true, identity: ANA_IDENTITY });
  });
});
