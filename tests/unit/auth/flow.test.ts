import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadAuthConfig } from "@/server/auth/config";
import { finishLogin, LOGIN_COOKIE_NAME, logout, startLogin, type AuthDeps } from "@/server/auth/flow";
import { createOidcClient, MAX_PROVIDER_RESPONSE_BYTES } from "@/server/auth/oidc";
import { hashSessionToken, SESSION_COOKIE_NAME } from "@/server/auth/session-token";

import { CLIENT_ID, CLIENT_SECRET, createTestIdp, ISSUER } from "./test-idp";

// Attacks 1 to 7, 11 to 13, 16 to 18 and 20 of the B-6 plan (#154), against
// the real openid-client and an in-process provider. Values are invented.
const APP = "https://ductus.test";
const config = loadAuthConfig({
  NODE_ENV: "test",
  DUCTUS_AUTH_PROVIDER: "fake-oidc",
  OIDC_ISSUER: ISSUER,
  OIDC_CLIENT_ID: CLIENT_ID,
  OIDC_CLIENT_SECRET: CLIENT_SECRET,
  OIDC_REDIRECT_URI: `${APP}/api/auth/callback`,
});
const EXPIRES = new Date("2030-01-01T12:00:00Z");

let idp: ReturnType<typeof createTestIdp>;
let deps: AuthDeps & { openSession: ReturnType<typeof vi.fn>; closeSession: ReturnType<typeof vi.fn> };
let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  idp = createTestIdp();
  deps = {
    config,
    oidc: createOidcClient(config, idp.fetch),
    openSession: vi.fn(async () => ({ ok: true as const, expires: EXPIRES })),
    closeSession: vi.fn(async () => true),
  };
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function setCookies(response: Response): Map<string, string> {
  return new Map(response.headers.getSetCookie().map((c) => [c.slice(0, c.indexOf("=")), c]));
}
const cookieValue = (header: string) => header.slice(header.indexOf("=") + 1, header.indexOf(";"));

/** Starts a login and returns the attempt cookie and the provider redirect. */
async function begin(path = "/api/auth/login") {
  const response = await startLogin(new Request(`${APP}${path}`), deps);
  expect(response.status).toBe(303);
  const attempt = setCookies(response).get(LOGIN_COOKIE_NAME);
  expect(attempt).toBeDefined();
  return { authorize: new URL(response.headers.get("location")!), cookie: `${LOGIN_COOKIE_NAME}=${cookieValue(attempt!)}` };
}

function callback(url: URL, cookie?: string, extra: Record<string, string> = {}) {
  return finishLogin(new Request(url, { headers: { ...(cookie ? { cookie } : {}), ...extra } }), deps);
}

async function login() {
  const { authorize, cookie } = await begin();
  return callback(idp.approve(authorize, `${APP}/api/auth/callback`), cookie);
}

async function expectRefused(response: Response, status = 400) {
  expect(response.status).toBe(status);
  expect(deps.openSession).not.toHaveBeenCalled();
  const cookies = setCookies(response);
  expect(cookies.has(SESSION_COOKIE_NAME)).toBe(false);
  expect(cookies.get(LOGIN_COOKIE_NAME)).toMatch(/Max-Age=0/);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toContain("Prijava nije dovršena");
}

const without = (claims: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(claims).filter(([k]) => k !== key));

describe("login", () => {
  it("opens a session for the identity in the verified tokens", async () => {
    const response = await login();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP}/`);
    expect(deps.openSession).toHaveBeenCalledTimes(1);
    const input = deps.openSession.mock.calls[0][0];
    expect(input).toMatchObject({ issuer: ISSUER, subject: "sub-demo-1", uniqueId: "ana@demo.ductus.test", homeOrg: "demo.ductus.test" });

    const session = setCookies(response).get(SESSION_COOKIE_NAME)!;
    expect(hashSessionToken(cookieValue(session)).equals(input.tokenHash)).toBe(true);
  });

  it("#13 sets __Host- cookies: HttpOnly, Secure, SameSite=Lax, Path=/, no Domain", async () => {
    const { authorize, cookie } = await begin();
    const attempt = cookie;
    expect(attempt.startsWith("__Host-")).toBe(true);
    const response = await callback(idp.approve(authorize, `${APP}/api/auth/callback`), attempt);
    const cookies = setCookies(response);
    const session = cookies.get(SESSION_COOKIE_NAME)!;
    for (const header of [session, cookies.get(LOGIN_COOKIE_NAME)!]) {
      expect(header).toMatch(/; Path=\/;/);
      expect(header).toMatch(/; HttpOnly;/);
      expect(header).toMatch(/; Secure;/);
      expect(header).toMatch(/; SameSite=Lax;/);
      expect(header).not.toMatch(/domain=/i);
    }
    expect(session).toContain(`Expires=${EXPIRES.toUTCString()}`);
    expect(cookieValue(session)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("#4 sends a S256 challenge and the matching verifier", async () => {
    const { authorize } = await begin();
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("scope")).toBe("openid profile");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${APP}/api/auth/callback`);
    expect(await login().then((r) => r.status)).toBe(303);
    expect(idp.tokenRequests.at(-1)?.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("#4 refuses when the verifier does not match the challenge", async () => {
    const first = await begin();
    const second = await begin();
    // Code issued for the first attempt, redeemed with the second's cookie (and so its verifier).
    const url = idp.approve(first.authorize, `${APP}/api/auth/callback`);
    url.searchParams.set("state", second.authorize.searchParams.get("state")!);
    await expectRefused(await callback(url, second.cookie));
  });

  it("#1 refuses a callback whose state is not the attempt's", async () => {
    const { authorize, cookie } = await begin();
    const url = idp.approve(authorize, `${APP}/api/auth/callback`);
    url.searchParams.set("state", "x".repeat(43));
    await expectRefused(await callback(url, cookie));
    expect(idp.tokenRequests).toHaveLength(0);
  });

  it("#1 refuses a callback without an attempt cookie, or with a forged one", async () => {
    const { authorize } = await begin();
    const url = idp.approve(authorize, `${APP}/api/auth/callback`);
    await expectRefused(await callback(url));
    for (const forged of ["", "e30", "not-base64!", Buffer.from(JSON.stringify({ v: 1, state: "a" })).toString("base64url")]) {
      await expectRefused(await callback(url, `${LOGIN_COOKIE_NAME}=${forged}`));
    }
    expect(idp.tokenRequests).toHaveLength(0);
  });

  it("#2 a replayed callback opens no second session", async () => {
    const { authorize, cookie } = await begin();
    const url = idp.approve(authorize, `${APP}/api/auth/callback`);
    expect((await callback(url, cookie)).status).toBe(303);
    deps.openSession.mockClear();
    // The browser no longer has the attempt cookie; an attacker who kept it
    // meets a code the provider already redeemed.
    await expectRefused(await callback(url));
    await expectRefused(await callback(url, cookie));
  });

  it("#3 refuses an ID token with another nonce, or none", async () => {
    idp.state.next = { claims: (c) => ({ ...c, nonce: "n".repeat(43) }) };
    await expectRefused(await login());
    idp.state.next = { claims: (c) => without(c, "nonce") };
    await expectRefused(await login());
  });

  it.each([
    ["another issuer", (c: Record<string, unknown>) => ({ ...c, iss: "https://zlo.test" })],
    ["another audience", (c: Record<string, unknown>) => ({ ...c, aud: "someone-else" })],
    ["expired beyond the tolerance", (c: Record<string, unknown>) => ({ ...c, exp: Math.floor(Date.now() / 1000) - 120 })],
    ["not yet valid", (c: Record<string, unknown>) => ({ ...c, nbf: Math.floor(Date.now() / 1000) + 600 })],
    ["no subject", (c: Record<string, unknown>) => without(c, "sub")],
  ])("#5 refuses an ID token from %s", async (_name, claims) => {
    idp.state.next = { claims };
    await expectRefused(await login());
  });

  it.each(["none", "HS256", "foreign-key", "unknown-kid"] as const)("#6 #7 refuses an ID token signed with %s", async (signing) => {
    idp.state.next = { signing };
    await expectRefused(await login());
  });

  it("#8 refuses userinfo for another subject", async () => {
    idp.state.next = { userinfo: (u) => ({ ...u, sub: "sub-other" }) };
    await expectRefused(await login());
  });

  it("refuses a login without hrEduPersonUniqueID with the same page as a refused institution", async () => {
    idp.state.next = { userinfo: (u) => without(u, "hrEduPersonUniqueID") };
    const missing = await login();
    const missingPage = await missing.clone().text();
    await expectRefused(missing, 403);

    idp.state.next = {};
    deps.openSession.mockResolvedValueOnce({ ok: false, reason: "refused" });
    const refused = await login();
    expect(refused.status).toBe(403);
    expect(setCookies(refused).has(SESSION_COOKIE_NAME)).toBe(false);
    expect(await refused.text()).toBe(missingPage);
  });

  it("#11 shows the unavailable page when the provider is down or failing", async () => {
    idp.state.next = { down: true };
    const start = await startLogin(new Request(`${APP}/api/auth/login`), deps);
    expect(start.status).toBe(503);
    expect(setCookies(start).has(LOGIN_COOKIE_NAME)).toBe(false);
    expect(await start.text()).toContain("trenutačno ne odgovara");

    idp.state.next = {};
    const { authorize, cookie } = await begin();
    idp.state.next = { tokenStatus: 502 };
    await expectRefused(await callback(idp.approve(authorize, `${APP}/api/auth/callback`), cookie), 503);
  });

  it("#11 refuses a 5 MB userinfo without reading it whole", async () => {
    let sent = 0;
    idp.state.next = {
      userinfoBody: () =>
        new ReadableStream({
          pull(controller) {
            if (sent >= 5 * 1024 * 1024) return controller.close();
            sent += 64 * 1024;
            controller.enqueue(new Uint8Array(64 * 1024).fill(0x20));
          },
        }),
    };
    await expectRefused(await login());
    expect(sent).toBeLessThanOrEqual(MAX_PROVIDER_RESPONSE_BYTES + 2 * 64 * 1024);
  });

  it("#12 closes a session cookie the browser already had and issues a new token", async () => {
    const planted = "p".repeat(43);
    const { authorize, cookie } = await begin();
    const response = await callback(idp.approve(authorize, `${APP}/api/auth/callback`), `${cookie}; ${SESSION_COOKIE_NAME}=${planted}`);
    expect(response.status).toBe(303);
    expect(deps.closeSession).toHaveBeenCalledWith(planted);
    expect(cookieValue(setCookies(response).get(SESSION_COOKIE_NAME)!)).not.toBe(planted);
  });

  it("#16 takes the identity from the tokens, never from the callback query", async () => {
    const { authorize, cookie } = await begin();
    const url = idp.approve(authorize, `${APP}/api/auth/callback`);
    for (const [k, v] of Object.entries({ sub: "evil", hrEduPersonUniqueID: "evil@zlo.test", hrEduPersonHomeOrg: "zlo.test" })) {
      url.searchParams.append(k, v);
    }
    await callback(url, cookie);
    expect(deps.openSession.mock.calls[0]?.[0]).toMatchObject({ subject: "sub-demo-1", uniqueId: "ana@demo.ductus.test", homeOrg: "demo.ductus.test" });
  });

  it("#17 returns to the path stored with the attempt, never one from the callback", async () => {
    const { authorize, cookie } = await begin("/api/auth/login?returnTo=%2Frad%3Fx%3D1");
    const url = idp.approve(authorize, `${APP}/api/auth/callback`);
    url.searchParams.set("returnTo", "https://zlo.test/");
    const response = await callback(url, cookie);
    expect(response.headers.get("location")).toBe(`${APP}/rad?x=1`);

    for (const evil of ["https://zlo.test/", "//zlo.test", "/.//zlo.test"]) {
      const attempt = await begin(`/api/auth/login?returnTo=${encodeURIComponent(evil)}`);
      const done = await callback(idp.approve(attempt.authorize, `${APP}/api/auth/callback`), attempt.cookie);
      expect(done.headers.get("location")).toBe(`${APP}/`);
    }
  });

  it("uses the configured redirect URI, never the Host of the callback request", async () => {
    const { authorize, cookie } = await begin();
    const url = idp.approve(authorize, `${APP}/api/auth/callback`);
    const spoofed = new URL(url.pathname + url.search, "https://zlo.test");
    const response = await callback(spoofed, cookie, { host: "zlo.test" });
    expect(response.status).toBe(303);
    expect(idp.tokenRequests.at(-1)?.get("redirect_uri")).toBe(`${APP}/api/auth/callback`);
    expect(response.headers.get("location")).toBe(`${APP}/`);
  });

  it("logs a stage and a code, never a value from the provider or the request", async () => {
    idp.state.next = { claims: (c) => ({ ...c, nonce: "n".repeat(43) }) };
    await login();
    idp.state.next = { userinfo: (u) => ({ ...u, hrEduPersonUniqueID: "‮ana@demo.ductus.test" }) };
    await login();
    const logged = JSON.stringify(errors.mock.calls);
    expect(errors).toHaveBeenCalled();
    for (const value of ["ana@demo.ductus.test", "sub-demo-1", "demo.ductus.test", "n".repeat(43), CLIENT_SECRET]) {
      expect(logged).not.toContain(value);
    }
  });
});

describe("logout", () => {
  const token = "t".repeat(43);
  const post = (headers: Record<string, string>) =>
    logout(new Request(`${APP}/api/auth/logout`, { method: "POST", headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, ...headers } }), deps);

  it("#20 closes the session of the cookie and clears it", async () => {
    const response = await post({ "sec-fetch-site": "same-origin", origin: APP });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP}/`);
    expect(deps.closeSession).toHaveBeenCalledWith(token);
    const cleared = setCookies(response).get(SESSION_COOKIE_NAME)!;
    expect(cleared).toMatch(/^__Host-ductus_session=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0$/);
  });

  it("#18 accepts a matching Origin when the browser sends no Sec-Fetch-Site", async () => {
    expect((await post({ origin: APP })).status).toBe(303);
  });

  it.each([
    ["cross-site", { "sec-fetch-site": "cross-site", origin: "https://zlo.test" }],
    ["same-site", { "sec-fetch-site": "same-site", origin: "https://sub.ductus.test" }],
    ["none (typed or bookmarked)", { "sec-fetch-site": "none" }],
    ["another Origin", { origin: "https://zlo.test" }],
    ["Origin null", { origin: "null" }],
    ["neither header", {}],
  ])("#18 refuses a logout from %s", async (_name, headers) => {
    const response = await post(headers);
    expect(response.status).toBe(403);
    expect(deps.closeSession).not.toHaveBeenCalled();
    expect(setCookies(response).has(SESSION_COOKIE_NAME)).toBe(false);
  });

  it("clears the cookie even when the database is unavailable", async () => {
    deps.closeSession.mockRejectedValueOnce(Object.assign(new Error("down"), { code: "ECONNREFUSED" }));
    const response = await post({ "sec-fetch-site": "same-origin" });
    expect(response.status).toBe(303);
    expect(setCookies(response).get(SESSION_COOKIE_NAME)).toMatch(/Max-Age=0$/);
  });
});
