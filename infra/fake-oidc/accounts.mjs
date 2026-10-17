// The invented demo accounts of the fake OIDC provider (local and CI only,
// D-09). They carry the attribute names AAI@EduHr releases.
export const ACCOUNTS = Object.freeze({
  "demo-student": Object.freeze({ name: "Demo studentica", affiliation: "student" }),
  "demo-teacher": Object.freeze({ name: "Demo nastavnik", affiliation: "employee" }),
});

// Only an own, declared key is an account (#184): `in` and a plain index also
// see what every object inherits, such as `toString` or `__proto__`.
export function isDemoAccountId(id) {
  return typeof id === "string" && Object.hasOwn(ACCOUNTS, id);
}

export function findDemoAccount(id) {
  return isDemoAccountId(id) ? ACCOUNTS[id] : undefined;
}
