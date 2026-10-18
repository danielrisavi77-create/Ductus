import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_ACCOUNTS, DEMO_HOME_ORG, demoAccountClaims } from "./accounts.mjs";

test("fake OIDC provides two distinct synthetic student accounts", () => {
  const students = Object.entries(DEMO_ACCOUNTS).filter(([, account]) => account.affiliation === "student");
  assert.deepEqual(students.map(([id]) => id), ["demo-student", "demo-student-2"]);
  assert.notEqual(students[0][1].name, students[1][1].name);

  for (const [id] of students) {
    assert.deepEqual(demoAccountClaims(id), {
      sub: id,
      name: DEMO_ACCOUNTS[id].name,
      hrEduPersonUniqueID: `${id}@${DEMO_HOME_ORG}`,
      hrEduPersonHomeOrg: DEMO_HOME_ORG,
      hrEduPersonAffiliation: "student",
    });
  }
});

test("the synthetic teacher identity remains an employee, not an authorized role", () => {
  assert.deepEqual(demoAccountClaims("demo-teacher"), {
    sub: "demo-teacher",
    name: "Demo nastavnik",
    hrEduPersonUniqueID: `demo-teacher@${DEMO_HOME_ORG}`,
    hrEduPersonHomeOrg: DEMO_HOME_ORG,
    hrEduPersonAffiliation: "employee",
  });
});

test("unknown and inherited object keys are not demo accounts", () => {
  assert.equal(demoAccountClaims("not-a-demo-account"), undefined);
  assert.equal(demoAccountClaims("constructor"), undefined);
});
