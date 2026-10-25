// The invented demo accounts of the fake OIDC provider (local and CI only,
// D-09). They carry the attribute names AAI@EduHr releases.
export const DEMO_HOME_ORG = "demo.ductus.test";

export const ACCOUNTS = Object.freeze({
  "demo-student": Object.freeze({ name: "Demo studentica", affiliation: "student" }),
  "demo-student-2": Object.freeze({ name: "Demo student 2", affiliation: "student" }),
  "demo-teacher": Object.freeze({ name: "Demo nastavnik", affiliation: "employee" }),
  // K-4d (#655): a second teacher of the same institution who teaches none of
  // the first teacher's courses. The name never contains "Demo nastavnik".
  "demo-teacher-2": Object.freeze({ name: "Demo nastavnica", affiliation: "employee" }),
});

export const DEMO_ACCOUNTS = ACCOUNTS;

// Only an own, declared key is an account (#184): `in` and a plain index also
// see what every object inherits, such as `toString` or `__proto__`.
export function isDemoAccountId(id) {
  return typeof id === "string" && Object.hasOwn(ACCOUNTS, id);
}

export function findDemoAccount(id) {
  return isDemoAccountId(id) ? ACCOUNTS[id] : undefined;
}

export function demoAccountClaims(id) {
  const account = findDemoAccount(id);
  if (!account) return undefined;
  return {
    sub: id,
    name: account.name,
    hrEduPersonUniqueID: `${id}@${DEMO_HOME_ORG}`,
    hrEduPersonHomeOrg: DEMO_HOME_ORG,
    hrEduPersonAffiliation: account.affiliation,
  };
}
