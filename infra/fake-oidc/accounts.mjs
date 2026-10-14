export const DEMO_HOME_ORG = "demo.ductus.test";

export const DEMO_ACCOUNTS = Object.freeze({
  "demo-student": Object.freeze({ name: "Demo studentica", affiliation: "student" }),
  "demo-student-2": Object.freeze({ name: "Demo student 2", affiliation: "student" }),
  "demo-teacher": Object.freeze({ name: "Demo nastavnik", affiliation: "employee" }),
});

export function demoAccountClaims(id) {
  if (!Object.hasOwn(DEMO_ACCOUNTS, id)) return undefined;
  const account = DEMO_ACCOUNTS[id];
  return {
    sub: id,
    name: account.name,
    hrEduPersonUniqueID: `${id}@${DEMO_HOME_ORG}`,
    hrEduPersonHomeOrg: DEMO_HOME_ORG,
    hrEduPersonAffiliation: account.affiliation,
  };
}
