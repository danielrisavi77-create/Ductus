import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadAuthConfig, type AuthConfig } from "@/server/auth/config";
import { finishLogin, LOGIN_COOKIE_NAME, startLogin, type AuthDeps } from "@/server/auth/flow";
import { createOidcClient, SCOPES } from "@/server/auth/oidc";
import { hashSessionToken, SESSION_COOKIE_NAME } from "@/server/auth/session-token";

import { CLIENT_ID, CLIENT_SECRET, createTestIdp, ISSUER } from "./test-idp";

// DAN-196, plan #1104: the login against a provider in the shape of
// AAI@EduHr, through the real openid-client and the routes. The provider
// releases each hrEdu attribute as an array and only for its own scope, so a
// request for `openid profile` gets no identity. Never Srce; every account
// and value is invented.
const APP = "https://ductus.test";
const CALLBACK = `${APP}/api/auth/callback`;
const env = (provider: AuthConfig["provider"]) =>
  loadAuthConfig({
    NODE_ENV: "test",
    DUCTUS_AUTH_PROVIDER: provider,
    OIDC_ISSUER: ISSUER,
    OIDC_CLIENT_ID: CLIENT_ID,
    OIDC_CLIENT_SECRET: CLIENT_SECRET,
    OIDC_REDIRECT_URI: CALLBACK,
  });
const AAI_CONFIG = env("aai-eduhr");
const ACCOUNT = {
  sub: "sub-aai-7",
  uniqueId: "maja.primjer@aai.ductus.test",
  homeOrg: "aai.ductus.test",
  givenName: "Maja",
  familyName: "Primjerić",
};
const AAI_SCOPES = ["openid", "profile", "hrEduPersonUniqueID", "hrEduPersonAffiliation", "hrEduPersonHomeOrg"];
const without = (scope: string) => AAI_SCOPES.filter((s) => s !== scope).join(" ");
const EXPIRES = new Date("2030-01-01T12:00:00Z");

let idp: ReturnType<typeof createTestIdp>;
let deps: AuthDeps & { openSession: ReturnType<typeof vi.fn>; closeSession: ReturnType<typeof vi.fn> };
let errors: ReturnType<typeof vi.spyOn>;

function use(config: AuthConfig) {
  deps = {
    config,
    oidc: createOidcClient(config, idp.fetch),
    openSession: vi.fn(async () => ({ ok: true as const, expires: EXPIRES })),
    closeSession: vi.fn(async () => true),
  };
}

beforeEach(() => {
  idp = createTestIdp(ACCOUNT, ISSUER, "aai");
  use(AAI_CONFIG);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const cookieOf = (response: Response, name: string) =>
  response.headers.getSetCookie().find((header) => header.startsWith(`${name}=`));

async function begin() {
  const response = await startLogin(new Request(`${APP}/api/auth/login`), deps);
  expect(response.status).toBe(303);
  const attempt = cookieOf(response, LOGIN_COOKIE_NAME)!;
  return { authorize: new URL(response.headers.get("location")!), cookie: attempt.slice(0, attempt.indexOf(";")) };
}

async function complete(attempt: Awaited<ReturnType<typeof begin>>) {
  return finishLogin(new Request(idp.approve(attempt.authorize, CALLBACK), { headers: { cookie: attempt.cookie } }), deps);
}

async function expectRefused(response: Response, status = 403) {
  expect(response.status).toBe(status);
  expect(deps.openSession).not.toHaveBeenCalled();
  expect(cookieOf(response, SESSION_COOKIE_NAME)).toBeUndefined();
  expect(cookieOf(response, LOGIN_COOKIE_NAME)).toMatch(/Max-Age=0/);
}

describe("login against an AAI@EduHr-shaped provider", () => {
  it("A1 A3 asks for profile and the hrEdu scopes of PRODUCT §4, with S256 PKCE, state and nonce", async () => {
    const attempt = await begin();
    const p = attempt.authorize.searchParams;
    expect(p.get("scope")?.split(" ")).toStrictEqual(AAI_SCOPES);
    expect(p.get("scope")).not.toMatch(/email|oib/i);
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await complete(attempt)).status).toBe(303);
    // The provider answered the token request, so client_secret_basic was right.
    const verifier = idp.tokenRequests.at(-1)?.get("code_verifier") ?? "";
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(p.get("code_challenge"));
  });

  it("A2 keeps openid profile for the local fake provider", () => {
    expect(SCOPES["fake-oidc"]).toBe("openid profile");
    expect(SCOPES["aai-eduhr"].split(" ")).toStrictEqual(AAI_SCOPES);
  });

  // DAN-304 (#1181, item 21): of the affiliation only the fact of the right
  // reaches openSession, never a value.
  it("A6 A11 opens the session for the array attributes, and only the teacher right leaves the affiliation", async () => {
    idp.state.account = { ...ACCOUNT, affiliation: ["djelatnik", "student"] };
    const response = await complete(await begin());
    expect(response.status).toBe(303);
    expect(deps.openSession).toHaveBeenCalledTimes(1);
    const token = cookieOf(response, SESSION_COOKIE_NAME)!.split(";")[0].split("=")[1];
    expect(deps.openSession.mock.calls[0][0]).toStrictEqual({
      issuer: ISSUER,
      subject: ACCOUNT.sub,
      uniqueId: ACCOUNT.uniqueId,
      homeOrg: ACCOUNT.homeOrg,
      givenName: ACCOUNT.givenName,
      familyName: ACCOUNT.familyName,
      teacherEligible: true,
      tokenHash: hashSessionToken(token),
    });
    expect(JSON.stringify(deps.openSession.mock.calls)).not.toMatch(/djelatnik|student/);
    expect(deps.closeSession).not.toHaveBeenCalled();
  });

  it("A17 takes the names from profile, and a request without profile loses them", async () => {
    expect((await complete(await begin())).status).toBe(303);
    expect(deps.openSession.mock.calls[0][0]).toMatchObject({ givenName: "Maja", familyName: "Primjerić" });

    deps.openSession.mockClear();
    const attempt = await begin();
    attempt.authorize.searchParams.set("scope", without("profile"));
    expect((await complete(attempt)).status).toBe(303);
    const input = deps.openSession.mock.calls[0][0];
    expect(input).toMatchObject({ uniqueId: ACCOUNT.uniqueId, homeOrg: ACCOUNT.homeOrg });
    expect(input).not.toHaveProperty("givenName");
    expect(input).not.toHaveProperty("familyName");
  });

  it("A4 gets no identity for the old openid profile request: the provider does not hide it", async () => {
    use(env("fake-oidc"));
    const attempt = await begin();
    expect(attempt.authorize.searchParams.get("scope")).toBe("openid profile");
    await expectRefused(await complete(attempt));
  });

  it.each(["hrEduPersonUniqueID", "hrEduPersonHomeOrg"])("A5 refuses when the scope %s is not granted", async (scope) => {
    const attempt = await begin();
    attempt.authorize.searchParams.set("scope", without(scope));
    await expectRefused(await complete(attempt));
  });

  it("A12 signs in the same way when the affiliation scope is not granted, without the teacher right", async () => {
    idp.state.account = { ...ACCOUNT, affiliation: ["djelatnik"] };
    const attempt = await begin();
    attempt.authorize.searchParams.set("scope", without("hrEduPersonAffiliation"));
    expect((await complete(attempt)).status).toBe(303);
    expect(deps.openSession.mock.calls[0][0]).toMatchObject({
      uniqueId: ACCOUNT.uniqueId,
      homeOrg: ACCOUNT.homeOrg,
      teacherEligible: false,
    });
  });

  it("DAN-304 gives the teacher right for djelatnik and none for student (#1181, items 1 and 4)", async () => {
    idp.state.account = { ...ACCOUNT, affiliation: ["djelatnik"] };
    expect((await complete(await begin())).status).toBe(303);
    expect(deps.openSession.mock.calls[0][0]).toMatchObject({ teacherEligible: true });
    idp.state.account = { ...ACCOUNT, affiliation: ["student"] };
    expect((await complete(await begin())).status).toBe(303);
    expect(deps.openSession.mock.calls[1][0]).toMatchObject({ teacherEligible: false });
  });

  it.each([
    ["empty", []],
    ["two values", ["maja.primjer@aai.ductus.test", "ivan.primjer@aai.ductus.test"]],
    ["a nested array", [["maja.primjer@aai.ductus.test"]]],
    ["a null member", [null]],
    ["a NUL byte", ["maja\u0000@aai.ductus.test"]],
  ])("A7 refuses a hrEduPersonUniqueID array with %s before any session", async (_label, value) => {
    idp.state.next = { userinfo: (u) => ({ ...u, hrEduPersonUniqueID: value }) };
    await expectRefused(await complete(await begin()));
  });

  it("A9 does not fall back to the ID token when the userinfo array is ambiguous", async () => {
    idp.state.next = {
      claims: (c) => ({ ...c, hrEduPersonUniqueID: [ACCOUNT.uniqueId], hrEduPersonHomeOrg: [ACCOUNT.homeOrg] }),
      userinfo: (u) => ({ ...u, hrEduPersonHomeOrg: ["aai.ductus.test", "drugi.ductus.test"] }),
    };
    await expectRefused(await complete(await begin()));
  });

  it("A10 refuses userinfo for another subject, or a subject as an array", async () => {
    idp.state.next = { userinfo: (u) => ({ ...u, sub: "sub-aai-8" }) };
    await expectRefused(await complete(await begin()), 400);
    idp.state.next = { userinfo: (u) => ({ ...u, sub: [ACCOUNT.sub] }) };
    await expectRefused(await complete(await begin()), 400);
  });

  it("A13 signs in without a name when the names come as arrays (known limit, #757)", async () => {
    idp.state.next = { userinfo: (u) => ({ ...u, given_name: ["Maja"], family_name: ["Primjerić"] }) };
    expect((await complete(await begin())).status).toBe(303);
    expect(deps.openSession.mock.calls[0][0]).not.toHaveProperty("givenName");
  });

  it("A15 logs a stage and a reason, never a value of the arrays", async () => {
    idp.state.next = { userinfo: (u) => ({ ...u, hrEduPersonUniqueID: ["maja.primjer@aai.ductus.test", "ivan.primjer@aai.ductus.test"] }) };
    await expectRefused(await complete(await begin()));
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).toContain("invalid_claim");
    for (const value of ["maja.primjer", "ivan.primjer", "aai.ductus.test", ACCOUNT.sub, CLIENT_SECRET]) expect(logged).not.toContain(value);
  });
});
