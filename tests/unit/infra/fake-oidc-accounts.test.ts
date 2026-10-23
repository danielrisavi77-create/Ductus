import { describe, expect, it } from "vitest";

import { ACCOUNTS, findDemoAccount, isDemoAccountId } from "../../../infra/fake-oidc/accounts.mjs";

// #184: the fake OIDC provider (local and CI only) must know exactly the
// declared demo accounts, never a property every object inherits.
describe("fake OIDC demo accounts (#184)", () => {
  it("knows the declared demo accounts", () => {
    for (const id of Object.keys(ACCOUNTS)) {
      expect(isDemoAccountId(id)).toBe(true);
      expect(findDemoAccount(id)).toBe(ACCOUNTS[id]);
    }
  });

  it.each([
    "toString",
    "constructor",
    "__proto__",
    "hasOwnProperty",
    "valueOf",
    "isPrototypeOf",
    "__defineGetter__",
    "",
    "demo-nobody",
  ])("refuses %j as an account id", (id) => {
    expect(isDemoAccountId(id)).toBe(false);
    expect(findDemoAccount(id)).toBeUndefined();
  });

  it.each([undefined, null, 1, {}, ["demo-student"]])("refuses a non-string id %j", (id) => {
    expect(isDemoAccountId(id)).toBe(false);
    expect(findDemoAccount(id)).toBeUndefined();
  });
});
