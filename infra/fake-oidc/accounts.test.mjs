import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_ACCOUNTS, DEMO_HOME_ORG, DEMO_HOME_ORG_B, demoAccountClaims } from "./accounts.mjs";

test("fake OIDC provides two distinct synthetic student accounts", () => {
  const students = Object.entries(DEMO_ACCOUNTS).filter(([, account]) => account.affiliation === "student");
  assert.deepEqual(students.map(([id]) => id), ["demo-student", "demo-student-2", "demo-b-student"]);
  assert.equal(new Set(students.map(([, account]) => account.name)).size, students.length);

  for (const [id] of students) {
    assert.deepEqual(demoAccountClaims(id), {
      sub: id,
      name: DEMO_ACCOUNTS[id].name,
      given_name: DEMO_ACCOUNTS[id].givenName,
      family_name: DEMO_ACCOUNTS[id].familyName,
      hrEduPersonUniqueID: [`${id}@${DEMO_ACCOUNTS[id].homeOrg}`],
      hrEduPersonHomeOrg: [DEMO_ACCOUNTS[id].homeOrg],
      hrEduPersonAffiliation: ["student"],
    });
  }
});

test("the synthetic teacher releases the staff affiliation, not an authorized role", () => {
  assert.deepEqual(demoAccountClaims("demo-teacher"), {
    sub: "demo-teacher",
    name: "Demo nastavnik",
    given_name: "Petar",
    family_name: "Kranjčec",
    hrEduPersonUniqueID: [`demo-teacher@${DEMO_HOME_ORG}`],
    hrEduPersonHomeOrg: [DEMO_HOME_ORG],
    hrEduPersonAffiliation: ["djelatnik"],
  });
});

test("the second synthetic teacher is another staff member of the same home organization", () => {
  assert.deepEqual(demoAccountClaims("demo-teacher-2"), {
    sub: "demo-teacher-2",
    name: "Demo nastavnica",
    given_name: "Maja",
    family_name: "Džombić",
    hrEduPersonUniqueID: [`demo-teacher-2@${DEMO_HOME_ORG}`],
    hrEduPersonHomeOrg: [DEMO_HOME_ORG],
    hrEduPersonAffiliation: ["djelatnik"],
  });
  // Playwright matches a button name as a case-insensitive substring: no
  // account name may contain another, or one click would find two buttons.
  const names = Object.values(DEMO_ACCOUNTS).map((account) => account.name.toLowerCase());
  for (const name of names) assert.equal(names.filter((other) => other.includes(name)).length, 1, name);
});

// DAN-483: the AAI@EduHr shape, one institution per account, and a second
// invented institution with its own staff member and student.
test("every demo account belongs to exactly one of the two invented institutions", () => {
  const orgs = new Set();
  for (const [id, account] of Object.entries(DEMO_ACCOUNTS)) {
    const claims = demoAccountClaims(id);
    for (const key of ["hrEduPersonUniqueID", "hrEduPersonHomeOrg", "hrEduPersonAffiliation"]) {
      assert.ok(Array.isArray(claims[key]) && claims[key].length === 1, `${id} ${key}`);
    }
    const [homeOrg] = claims.hrEduPersonHomeOrg;
    assert.ok([DEMO_HOME_ORG, DEMO_HOME_ORG_B].includes(homeOrg), id);
    assert.equal(homeOrg, account.homeOrg, id);
    assert.equal(claims.hrEduPersonUniqueID[0], `${id}@${homeOrg}`, id);
    assert.ok(["student", "djelatnik"].includes(claims.hrEduPersonAffiliation[0]), id);
    orgs.add(homeOrg);
  }
  assert.notEqual(DEMO_HOME_ORG, DEMO_HOME_ORG_B);
  assert.equal(orgs.size, 2);
  assert.deepEqual(demoAccountClaims("demo-b-teacher").hrEduPersonAffiliation, ["djelatnik"]);
  assert.deepEqual(demoAccountClaims("demo-b-teacher").hrEduPersonHomeOrg, [DEMO_HOME_ORG_B]);
  assert.deepEqual(demoAccountClaims("demo-b-student").hrEduPersonAffiliation, ["student"]);
  assert.deepEqual(demoAccountClaims("demo-b-student").hrEduPersonHomeOrg, [DEMO_HOME_ORG_B]);
});

// #757 D1: every demo account releases its given and family name as two
// separate strings under `profile`; the app never splits `name`.
test("every demo account has its own invented given and family name", () => {
  const pairs = [];
  for (const id of Object.keys(DEMO_ACCOUNTS)) {
    const claims = demoAccountClaims(id);
    for (const key of ["given_name", "family_name"]) {
      assert.equal(typeof claims[key], "string", `${id} ${key}`);
      assert.equal(claims[key], claims[key].trim(), `${id} ${key}`);
      assert.ok(claims[key].length > 0 && claims[key].length <= 255, `${id} ${key}`);
      assert.doesNotMatch(claims[key], /\p{Cc}/u, `${id} ${key}`);
    }
    assert.notEqual(claims.name, `${claims.given_name} ${claims.family_name}`, id);
    pairs.push(`${claims.given_name} ${claims.family_name}`);
  }
  assert.equal(new Set(pairs).size, pairs.length);
  const surnames = Object.values(DEMO_ACCOUNTS).map((account) => account.familyName);
  assert.equal(new Set(surnames).size, surnames.length);
  assert.ok(surnames.some((surname) => /dž|lj|nj|[čćđšž]/i.test(surname)));
});

test("unknown and inherited object keys are not demo accounts", () => {
  assert.equal(demoAccountClaims("not-a-demo-account"), undefined);
  assert.equal(demoAccountClaims("constructor"), undefined);
});
