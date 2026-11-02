import { describe, expect, it } from "vitest";

import { identityFromClaims, TEACHER_AFFILIATIONS } from "./claims";

// Plan of attack #154, items 8, 9 and 10. Synthetic identities only.
const ANA = {
  sub: "sub-ana-001",
  hrEduPersonUniqueID: "ana.demo@demo-fakultet.test",
  hrEduPersonHomeOrg: "demo-fakultet.test",
  mail: "ana.demo@demo-fakultet.test",
};
const ANA_IDENTITY = {
  subject: "sub-ana-001",
  uniqueId: "ana.demo@demo-fakultet.test",
  homeOrg: "demo-fakultet.test",
  teacherEligible: false,
};

describe("identityFromClaims", () => {
  it("takes the subject, hrEduPersonUniqueID and home organisation, never e-mail", () => {
    const result = identityFromClaims(ANA);
    expect(result).toStrictEqual({
      ok: true,
      identity: ANA_IDENTITY,
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
      identity: { ...ANA_IDENTITY, uniqueId: "ana.userinfo@demo-drugi.test", homeOrg: "demo-drugi.test" },
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
    // A one-member array is AAI's form of the hrEdu claims (below); a nested
    // one is refused for all three, and `sub` refuses any array.
    ["a nested array", [["ana"]]],
  ])("refuses an identifier with %s, without echoing it", (_label, value) => {
    for (const claim of ["sub", "hrEduPersonUniqueID", "hrEduPersonHomeOrg"]) {
      const result = identityFromClaims({ ...ANA, [claim]: value });
      expect(result).toStrictEqual({ ok: false, reason: "invalid_claim" });
    }
  });

  it("refuses a subject given as an array, also of one member", () => {
    expect(identityFromClaims({ ...ANA, sub: [ANA.sub] })).toStrictEqual({ ok: false, reason: "invalid_claim" });
    expect(identityFromClaims(ANA, { sub: [ANA.sub] })).toStrictEqual({ ok: false, reason: "subject_mismatch" });
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

// DAN-196 (plan #1104, A6 to A10): AAI@EduHr releases the hrEdu claims as
// JSON arrays, single-valued ones too (Srce wiki, page 59867172).
describe("identityFromClaims with AAI@EduHr arrays", () => {
  const AAI = { sub: ANA.sub, hrEduPersonUniqueID: [ANA.hrEduPersonUniqueID], hrEduPersonHomeOrg: [ANA.hrEduPersonHomeOrg] };
  const KEYS = ["hrEduPersonUniqueID", "hrEduPersonHomeOrg"] as const;

  it("A6 gives the same identity for one-member arrays as for strings, from either token", () => {
    const expected = { ok: true, identity: ANA_IDENTITY };
    expect(identityFromClaims(AAI)).toStrictEqual(expected);
    expect(identityFromClaims({ sub: ANA.sub }, AAI)).toStrictEqual(expected);
    expect(identityFromClaims({ ...ANA, hrEduPersonHomeOrg: [ANA.hrEduPersonHomeOrg] })).toStrictEqual(expected);
  });

  it.each([
    ["empty", []],
    ["two values", ["ana.demo@demo-fakultet.test", "ivo.demo@demo-fakultet.test"]],
    ["the same value twice", ["ana.demo@demo-fakultet.test", "ana.demo@demo-fakultet.test"]],
    ["a nested array", [["ana.demo@demo-fakultet.test"]]],
    ["a null member", [null]],
    ["an undefined member", [undefined]],
    ["a number member", [42]],
    ["an object member", [{}]],
    ["an empty member", [""]],
    ["a hole", Array(1)],
    ["a NUL byte", ["ana\u0000@demo-fakultet.test"]],
    ["a zero-width space", ["ana​@demo-fakultet.test"]],
    ["a bidi override", ["ana\u202e@demo-fakultet.test"]],
    ["a line break", ["ana\n@demo-fakultet.test"]],
    ["a lone surrogate", ["\ud800"]],
    ["256 code points", ["😀".repeat(256)]],
  ])("A7 A8 refuses an array with %s, from either token", (_label, value) => {
    for (const key of KEYS) {
      expect(identityFromClaims({ ...AAI, [key]: value })).toStrictEqual({ ok: false, reason: "invalid_claim" });
      expect(identityFromClaims({ sub: ANA.sub }, { ...AAI, [key]: value })).toStrictEqual({ ok: false, reason: "invalid_claim" });
    }
  });

  it("A8 accepts one member of 255 code points", () => {
    for (const key of KEYS) expect(identityFromClaims({ ...AAI, [key]: ["😀".repeat(255)] }).ok).toBe(true);
  });

  it("A9 never falls back to a valid ID token when the userinfo array is invalid", () => {
    for (const key of KEYS) {
      for (const bad of [[], ["a.demo@demo-fakultet.test", "b.demo@demo-fakultet.test"], [null]]) {
        expect(identityFromClaims(AAI, { ...AAI, [key]: bad })).toStrictEqual({ ok: false, reason: "invalid_claim" });
        expect(identityFromClaims(ANA, { ...AAI, [key]: bad })).toStrictEqual({ ok: false, reason: "invalid_claim" });
      }
    }
  });

  it("keeps the userinfo value as sent, without changing its case", () => {
    const result = identityFromClaims(AAI, { ...AAI, hrEduPersonUniqueID: ["Ana.Demo@DEMO-fakultet.test"] });
    expect(result.ok && result.identity.uniqueId).toBe("Ana.Demo@DEMO-fakultet.test");
  });

  // DAN-304 replaces "the affiliation stays out of the identity": the
  // identity is the same for every value, and only the fact of the right
  // follows the value.
  it("A11 A12 keeps the identity whatever hrEduPersonAffiliation holds, and only teacherEligible follows it", () => {
    for (const [affiliation, teacherEligible] of [
      [["djelatnik"], true],
      [["employee"], false],
      [["student", "djelatnik"], true],
      [[], false],
      ["djelatnik", true],
      [42, false],
      [undefined, false],
    ] as const) {
      expect(identityFromClaims({ ...AAI, hrEduPersonAffiliation: affiliation })).toStrictEqual({
        ok: true,
        identity: { ...ANA_IDENTITY, teacherEligible },
      });
    }
  });

  it("A13 logs in without a name when the names come as arrays (known limit, #757)", () => {
    expect(identityFromClaims({ ...AAI, givenName: ["Ana"], sn: ["Testić"] })).toStrictEqual({ ok: true, identity: ANA_IDENTITY });
  });
});

// DAN-304 (plan of attack #1181, items 1 to 9): hrEduPersonAffiliation gives
// only the fact that a teacher role may be confirmed (D-171). It never
// refuses a login and its value never leaves claims.ts.
describe("teacherEligible from hrEduPersonAffiliation", () => {
  const AAI = { sub: ANA.sub, hrEduPersonUniqueID: [ANA.hrEduPersonUniqueID], hrEduPersonHomeOrg: [ANA.hrEduPersonHomeOrg] };
  const eligible = (affiliation: unknown, userinfo?: Record<string, unknown>) => {
    const result = identityFromClaims({ ...AAI, hrEduPersonAffiliation: affiliation }, userinfo);
    expect(result.ok).toBe(true);
    return result.ok && result.identity.teacherEligible;
  };

  it("holds the two values of the code list hrEdu004, marked unverified in claims.ts", () => {
    expect(TEACHER_AFFILIATIONS).toStrictEqual(["djelatnik", "vanjski suradnik"]);
    expect(Object.isFrozen(TEACHER_AFFILIATIONS)).toBe(true);
  });

  it("items 1 and 2: djelatnik and vanjski suradnik, as a string or a one-member array", () => {
    for (const value of TEACHER_AFFILIATIONS) {
      expect(eligible(value)).toBe(true);
      expect(eligible([value])).toBe(true);
    }
  });

  it("item 3: a multi-valued attribute in either order", () => {
    expect(eligible(["student", "djelatnik"])).toBe(true);
    expect(eligible(["djelatnik", "student"])).toBe(true);
    expect(eligible(["student", "vanjski suradnik", "alum"])).toBe(true);
  });

  it("item 4: student and other values give no right", () => {
    for (const value of ["student", ["student"], ["student", "alum"], "alum", ["gost"]]) expect(eligible(value)).toBe(false);
  });

  it("item 5: no attribute, in neither token, gives no right and keeps the login", () => {
    expect(identityFromClaims(AAI)).toStrictEqual({ ok: true, identity: ANA_IDENTITY });
    expect(identityFromClaims({ sub: ANA.sub }, AAI)).toStrictEqual({ ok: true, identity: ANA_IDENTITY });
    expect(eligible(null)).toBe(false);
  });

  it.each([
    ["an empty array", []],
    ["a null member", [null]],
    ["a hole", Array(1)],
    ["a hole before djelatnik", [, "djelatnik"]],
    ["a nested array", [["djelatnik"]]],
    ["a number", 42],
    ["an object", { djelatnik: true }],
    ["an object member", [{ value: "djelatnik" }]],
    ["true", true],
    ["an empty string", ""],
    ["an empty member", [""]],
  ])("item 6: %s gives no right and keeps the login", (_label, value) => {
    expect(eligible(value)).toBe(false);
  });

  it.each([
    ["other case", "Djelatnik"],
    ["capitals", "DJELATNIK"],
    ["a leading space", " djelatnik"],
    ["a trailing space", "djelatnik "],
    ["a zero-width space", "djelatnik\u200b"],
    ["a Cyrillic letter", "djelatn\u0438k"],
    ["two spaces", "vanjski  suradnik"],
    ["an underscore", "vanjski_suradnik"],
    ["a non-breaking space", "vanjski\u00a0suradnik"],
    ["several values in one string", "djelatnik;student"],
    ["the fake provider's English value", "employee"],
    ["staff", "staff"],
    ["faculty", "faculty"],
  ])("item 7: a look-alike value with %s gives no right, as a string or a member", (_label, value) => {
    expect(eligible(value)).toBe(false);
    expect(eligible([value])).toBe(false);
    expect(eligible(["student", value])).toBe(false);
  });

  it("item 7: a member that is not a valid string never spoils a valid one", () => {
    expect(eligible([42, "djelatnik"])).toBe(true);
    expect(eligible(["djelatnik\n", "vanjski suradnik"])).toBe(true);
  });

  it("item 8: an oversized attribute gives no right and keeps the login", () => {
    expect(eligible(Array.from({ length: 10_000 }, () => "djelatnik"))).toBe(false);
    expect(eligible([...Array.from({ length: 32 }, () => "student"), "djelatnik"])).toBe(false);
    expect(eligible([...Array.from({ length: 31 }, () => "student"), "djelatnik"])).toBe(true);
    expect(eligible("d".repeat(256))).toBe(false);
    expect(eligible(["djelatnik" + "x".repeat(300)])).toBe(false);
    expect(eligible(["s".repeat(300_000)])).toBe(false);
  });

  it("item 9: userinfo takes precedence over the ID token, and another subject still refuses", () => {
    expect(eligible(["djelatnik"], { sub: ANA.sub, hrEduPersonAffiliation: ["student"] })).toBe(false);
    expect(eligible(["student"], { sub: ANA.sub, hrEduPersonAffiliation: ["djelatnik"] })).toBe(true);
    // Userinfo without the attribute leaves the ID token's, as for every claim.
    expect(eligible(["djelatnik"], { sub: ANA.sub })).toBe(true);
    expect(identityFromClaims({ ...AAI, hrEduPersonAffiliation: ["djelatnik"] }, { sub: "sub-ivo-002", hrEduPersonAffiliation: ["djelatnik"] }))
      .toStrictEqual({ ok: false, reason: "subject_mismatch" });
  });

  it("item 26: a bad affiliation keeps the name, and a bad name keeps the right", () => {
    const named = identityFromClaims({ ...AAI, givenName: "Ana", sn: "Testić", hrEduPersonAffiliation: [["djelatnik"]] });
    expect(named).toStrictEqual({ ok: true, identity: { ...ANA_IDENTITY, givenName: "Ana", familyName: "Testić" } });
    const unnamed = identityFromClaims({ ...AAI, givenName: "", sn: "Testić", hrEduPersonAffiliation: ["djelatnik"] });
    expect(unnamed).toStrictEqual({ ok: true, identity: { ...ANA_IDENTITY, teacherEligible: true } });
  });

  it("item 21: no value of the attribute is kept in the identity", () => {
    for (const value of [["djelatnik"], ["student"], "vanjski suradnik", [["x"]]]) {
      const result = identityFromClaims({ ...AAI, hrEduPersonAffiliation: value });
      expect(JSON.stringify(result)).not.toMatch(/djelatnik|student|suradnik|"x"/);
    }
  });
});
