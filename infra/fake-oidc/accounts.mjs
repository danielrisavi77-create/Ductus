// The invented demo accounts of the fake OIDC provider (local and CI only,
// D-09). They carry the attribute names AAI@EduHr releases, in its shape
// (DAN-483): hrEduPersonUniqueID and hrEduPersonHomeOrg as one-member
// arrays, hrEduPersonAffiliation as an array of hrEdu004 values. Given and
// family name are the OIDC `profile` claims `given_name` and `family_name`
// (#757 D1); the surnames include Croatian digraphs and diacritics for
// sorting tests. Every person, name and organisation here is invented.
export const DEMO_HOME_ORG = "demo.ductus.test";
// The second invented institution of db/local/seed.sql ("Demo fakultet B").
export const DEMO_HOME_ORG_B = "b.demo.ductus.test";

// hrEdu004 values (NEPROVJERENO, see TEACHER_AFFILIATIONS in
// src/server/auth/claims.ts). A teacher affiliation is the right to have a
// teacher role confirmed, never the role itself.
const STUDENT = "student";
const STAFF = "djelatnik";

export const ACCOUNTS = Object.freeze({
  "demo-student": Object.freeze({
    name: "Demo studentica",
    givenName: "Lucija",
    familyName: "Đaković",
    affiliation: STUDENT,
    homeOrg: DEMO_HOME_ORG,
  }),
  "demo-student-2": Object.freeze({
    name: "Demo student 2",
    givenName: "Marko",
    familyName: "Ljubić",
    affiliation: STUDENT,
    homeOrg: DEMO_HOME_ORG,
  }),
  "demo-teacher": Object.freeze({
    name: "Demo nastavnik",
    givenName: "Petar",
    familyName: "Kranjčec",
    affiliation: STAFF,
    homeOrg: DEMO_HOME_ORG,
  }),
  // K-4d (#655): a second teacher of the same institution who teaches none of
  // the first teacher's courses. The name never contains "Demo nastavnik".
  "demo-teacher-2": Object.freeze({
    name: "Demo nastavnica",
    givenName: "Maja",
    familyName: "Džombić",
    affiliation: STAFF,
    homeOrg: DEMO_HOME_ORG,
  }),
  // DAN-483: the accounts of the second institution. Their names contain no
  // other account's name, so a button found by name is always one button.
  "demo-b-teacher": Object.freeze({
    name: "Ustanova B: nastavnica",
    givenName: "Nevena",
    familyName: "Ćurlin",
    affiliation: STAFF,
    homeOrg: DEMO_HOME_ORG_B,
  }),
  "demo-b-student": Object.freeze({
    name: "Ustanova B: student",
    givenName: "Dino",
    familyName: "Šimunac",
    affiliation: STUDENT,
    homeOrg: DEMO_HOME_ORG_B,
  }),
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

// The realm of the unique id is the account's own home organisation, so an
// account belongs to exactly one institution.
export function demoAccountClaims(id) {
  const account = findDemoAccount(id);
  if (!account) return undefined;
  return {
    sub: id,
    name: account.name,
    given_name: account.givenName,
    family_name: account.familyName,
    hrEduPersonUniqueID: [`${id}@${account.homeOrg}`],
    hrEduPersonHomeOrg: [account.homeOrg],
    hrEduPersonAffiliation: [account.affiliation],
  };
}
