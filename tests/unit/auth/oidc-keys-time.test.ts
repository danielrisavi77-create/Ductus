import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadAuthConfig } from "@/server/auth/config";
import { createOidcClient, isProviderUnavailable, newLoginChecks, type LoginChecks, type OidcClient } from "@/server/auth/oidc";

import { CLIENT_ID, CLIENT_SECRET, createTestIdp, ISSUER, type Misbehaviour } from "./test-idp";

// M1.5b (DAN-491): key rotation at the provider and the time claims of the
// ID token, against the real openid-client and the in-process provider.
// Only Date is faked, so the library's JWKS cache ages with the test clock
// and promises still run. Every value is invented.
const CALLBACK = "https://ductus.test/api/auth/callback";
const TOLERANCE = 30;
const config = loadAuthConfig({
  NODE_ENV: "test",
  DUCTUS_AUTH_PROVIDER: "fake-oidc",
  OIDC_ISSUER: ISSUER,
  OIDC_CLIENT_ID: CLIENT_ID,
  OIDC_CLIENT_SECRET: CLIENT_SECRET,
  OIDC_REDIRECT_URI: CALLBACK,
  OIDC_CLOCK_TOLERANCE_SECONDS: String(TOLERANCE),
});
const START = new Date("2026-11-02T10:00:00Z");

let idp: ReturnType<typeof createTestIdp>;
let oidc: OidcClient;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: START });
  idp = createTestIdp();
  oidc = createOidcClient(config, idp.fetch);
});
afterEach(() => vi.useRealTimers());

const now = () => Math.floor(Date.now() / 1000);
const later = (seconds: number) => vi.setSystemTime(Date.now() + seconds * 1000);
const jwksRequests = () => idp.requests.filter((path) => path === "/jwks").length;

/** One whole login with the provider misbehaving as `next` says. */
async function login(next: Misbehaviour = {}): Promise<"accepted" | "refused"> {
  const checks: LoginChecks = newLoginChecks();
  const url = idp.approve(await oidc.authorizationUrl(checks), CALLBACK);
  idp.state.next = next;
  try {
    await oidc.verify(url, checks);
    return "accepted";
  } catch (error) {
    // A refused token is never mistaken for a provider that is down.
    expect(isProviderUnavailable(error)).toBe(false);
    return "refused";
  } finally {
    idp.state.next = {};
  }
}

describe("JWKS rotation", () => {
  it("accepts a token of the old key while the provider still publishes it beside the new one", async () => {
    await expect(login()).resolves.toBe("accepted");
    later(61);
    idp.rotate("kid-2");
    await expect(login({ signingKid: "test-kid" })).resolves.toBe("accepted");
    await expect(login()).resolves.toBe("accepted");
  });

  it("fetches the key set again for a new kid once the cached one is a minute old", async () => {
    await expect(login()).resolves.toBe("accepted");
    expect(jwksRequests()).toBe(1);
    idp.rotate("kid-2");
    later(61);
    await expect(login()).resolves.toBe("accepted");
    expect(jwksRequests()).toBe(2);
  });

  it("does not fetch the key set again for a new kid within the first minute", async () => {
    // The library's limit on refetching: a kid nobody published cannot make
    // every callback a request to the provider. A rotation shows within 60 s.
    await expect(login()).resolves.toBe("accepted");
    idp.rotate("kid-2");
    later(30);
    await expect(login()).resolves.toBe("refused");
    expect(jwksRequests()).toBe(1);
    later(31);
    await expect(login()).resolves.toBe("accepted");
    expect(jwksRequests()).toBe(2);
  });

  it("refuses a token of a retired key once the key set is fetched again", async () => {
    await expect(login()).resolves.toBe("accepted");
    idp.rotate("kid-2");
    idp.retire("test-kid");
    later(61);
    await expect(login()).resolves.toBe("accepted");
    await expect(login({ signingKid: "test-kid" })).resolves.toBe("refused");
  });

  it("drops a cached key the provider retired once the cache is five minutes old", async () => {
    await expect(login()).resolves.toBe("accepted");
    idp.rotate("kid-2");
    idp.retire("test-kid");
    later(301);
    await expect(login({ signingKid: "test-kid" })).resolves.toBe("refused");
    expect(jwksRequests()).toBe(2);
  });

  it("refuses an unknown kid with at most one refetch, and none within the minute after", async () => {
    await expect(login()).resolves.toBe("accepted");
    later(61);
    await expect(login({ signing: "unknown-kid" })).resolves.toBe("refused");
    expect(jwksRequests()).toBe(2);
    await expect(login({ signing: "unknown-kid" })).resolves.toBe("refused");
    await expect(login({ signing: "unknown-kid" })).resolves.toBe("refused");
    expect(jwksRequests()).toBe(2);
  });

  it("refuses a token without kid when two keys could verify it", async () => {
    idp.rotate("kid-2");
    await expect(login({ noKid: true })).resolves.toBe("refused");
  });

  it("accepts a token without kid when the provider publishes one key", async () => {
    await expect(login({ noKid: true })).resolves.toBe("accepted");
  });
});

describe("time claims of the ID token", () => {
  it.each([
    ["as text", () => String(now())],
    ["as null", () => null],
    ["as a boolean", () => true],
  ])("refuses an iat %s", async (_name, iat) => {
    await expect(login(claims((c) => ({ ...c, iat: iat() })))).resolves.toBe("refused");
  });

  it("accepts an iat a little ahead of this clock, within the tolerance", async () => {
    await expect(login(claims((c) => ({ ...c, iat: now() + TOLERANCE - 1 })))).resolves.toBe("accepted");
  });

  it("accepts an iat exactly at the tolerance ahead of this clock", async () => {
    await expect(login(claims((c) => ({ ...c, iat: now() + TOLERANCE })))).resolves.toBe("accepted");
  });

  // #1327: the library only checks that iat is a number, so an iat beyond
  // the allowed skew (docs/backend/prijava-i-ovlasti.md) is refused here.
  it.each([
    ["one second past the tolerance", TOLERANCE + 1],
    ["an hour ahead", 3600],
    ["a year ahead", 365 * 24 * 3600],
  ] as const)("refuses an iat %s, before asking for userinfo", async (_name, ahead) => {
    await expect(login(claims((c) => ({ ...c, iat: now() + ahead })))).resolves.toBe("refused");
    expect(idp.requests).not.toContain("/me");
  });

  // How old an iat may be is an open owner decision (#1327); exp already
  // bounds the token's life. No test here holds either answer.

  it.each([
    ["exactly at the tolerance", -TOLERANCE, "refused"],
    ["one second inside the tolerance", -TOLERANCE + 1, "accepted"],
    ["now", 0, "accepted"],
  ] as const)("treats an exp %s as %s", async (_name, offset, outcome) => {
    await expect(login(claims((c) => ({ ...c, exp: now() + offset })))).resolves.toBe(outcome);
  });

  it.each([
    ["one second inside the tolerance", TOLERANCE - 1, "accepted"],
    ["one second past the tolerance", TOLERANCE + 1, "refused"],
  ] as const)("treats an nbf %s as %s", async (_name, ahead, outcome) => {
    await expect(login(claims((c) => ({ ...c, nbf: now() + ahead })))).resolves.toBe(outcome);
  });

  it("refuses an nbf as text", async () => {
    await expect(login(claims((c) => ({ ...c, nbf: String(now()) })))).resolves.toBe("refused");
  });
});

describe("the login attempt", () => {
  it("refuses the callback of an earlier attempt checked against a later one", async () => {
    // Two tabs: the cookie holds the later attempt, the provider answers the
    // earlier one. Its state and nonce belong to no attempt the server holds.
    const first = newLoginChecks();
    const firstUrl = idp.approve(await oidc.authorizationUrl(first), CALLBACK);
    const second = newLoginChecks();
    idp.approve(await oidc.authorizationUrl(second), CALLBACK);
    await expect(oidc.verify(firstUrl, second)).rejects.toThrow();
    expect(idp.tokenRequests).toHaveLength(0);
  });

  it("refuses an ID token carrying the nonce of an earlier attempt", async () => {
    const earlier = newLoginChecks();
    await expect(
      login(claims((c) => ({ ...c, nonce: earlier.nonce }))),
    ).resolves.toBe("refused");
  });
});

function claims(edit: (c: Record<string, unknown>) => Record<string, unknown>): Misbehaviour {
  return { claims: edit };
}
