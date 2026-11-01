import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadAuthConfig } from "@/server/auth/config";
import { failurePage, finishLogin, isSameOrigin, LOGIN_COOKIE_NAME, logout, startLogin, type AuthDeps } from "@/server/auth/flow";
import { createOidcClient } from "@/server/auth/oidc";
import { hashSessionToken, SESSION_COOKIE_NAME } from "@/server/auth/session-token";

import { CLIENT_ID, CLIENT_SECRET, createTestIdp, ISSUER } from "./test-idp";

// Branches of flow.ts that flow.test.ts reaches only indirectly or not at all
// (DAN-307): the attempt cookie as untrusted input, provider errors on the
// callback, and failures of the session ports. Values are invented.
const APP = "https://ductus.test";
const CALLBACK = `${APP}/api/auth/callback`;
const config = loadAuthConfig({
  NODE_ENV: "test",
  DUCTUS_AUTH_PROVIDER: "fake-oidc",
  OIDC_ISSUER: ISSUER,
  OIDC_CLIENT_ID: CLIENT_ID,
  OIDC_CLIENT_SECRET: CLIENT_SECRET,
  OIDC_REDIRECT_URI: CALLBACK,
});
const EXPIRES = new Date("2030-01-01T12:00:00Z");
const RANDOM = /^[A-Za-z0-9_-]{43}$/;

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
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const decode = (value: string) => JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;

async function begin(path = "/api/auth/login") {
  const response = await startLogin(new Request(`${APP}${path}`), deps);
  expect(response.status).toBe(303);
  const header = setCookies(response).get(LOGIN_COOKIE_NAME)!;
  return { authorize: new URL(response.headers.get("location")!), header, value: cookieValue(header) };
}

function callback(url: URL | string, cookie?: string) {
  return finishLogin(new Request(url, { headers: cookie ? { cookie } : {} }), deps);
}

async function expectRefused(response: Response, status = 400) {
  expect(response.status).toBe(status);
  expect(deps.openSession).not.toHaveBeenCalled();
  const cookies = setCookies(response);
  expect(cookies.has(SESSION_COOKIE_NAME)).toBe(false);
  expect(cookies.get(LOGIN_COOKIE_NAME)).toMatch(/Max-Age=0/);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
}

describe("startLogin", () => {
  it("keeps in the attempt cookie exactly the values sent to the provider", async () => {
    const { authorize, header, value } = await begin("/api/auth/login?returnTo=%2Frad");
    expect(header).toMatch(/; Max-Age=600$/);
    const attempt = decode(value);
    expect(Object.keys(attempt).sort()).toEqual(["codeVerifier", "nonce", "returnTo", "state", "v"]);
    expect(attempt).toMatchObject({ v: 1, returnTo: "/rad" });
    const p = authorize.searchParams;
    expect(attempt.state).toBe(p.get("state"));
    expect(attempt.nonce).toBe(p.get("nonce"));
    expect(createHash("sha256").update(String(attempt.codeVerifier)).digest("base64url")).toBe(p.get("code_challenge"));
    for (const random of [attempt.state, attempt.nonce, attempt.codeVerifier]) expect(random).toMatch(RANDOM);
    expect(authorize.href).not.toContain(String(attempt.codeVerifier));
  });

  it("gives every attempt new state, nonce and verifier", async () => {
    const first = decode((await begin()).value);
    const second = decode((await begin()).value);
    for (const key of ["state", "nonce", "codeVerifier"]) expect(first[key]).not.toBe(second[key]);
  });

  it("stores the default path for a returnTo it does not accept", async () => {
    const { value } = await begin(`/api/auth/login?returnTo=${encodeURIComponent("https://zlo.test/")}`);
    expect(decode(value).returnTo).toBe("/");
  });
});

describe("finishLogin with an attempt cookie it cannot trust", () => {
  /**
   * One attempt: `cookieOf` turns its own cookie value into the one sent, so
   * the callback, the code and the cookie all belong to the same attempt and
   * only the edit can make it fail. The refusal must come from the cookie,
   * before the client is asked to verify anything.
   */
  async function refusedWith(cookieOf: (value: string) => string) {
    const verify = vi.spyOn(deps.oidc, "verify");
    const { authorize, value } = await begin();
    const response = await callback(idp.approve(authorize, CALLBACK), `${LOGIN_COOKIE_NAME}=${cookieOf(value)}`);
    await expectRefused(response);
    expect(verify).not.toHaveBeenCalled();
    expect(idp.tokenRequests).toHaveLength(0);
  }

  it("signs in through the same helper path when the cookie is left as it was", async () => {
    const verify = vi.spyOn(deps.oidc, "verify");
    const { authorize, value } = await begin();
    const same = encode(decode(value));
    expect(same).toBe(value);
    const response = await callback(idp.approve(authorize, CALLBACK), `${LOGIN_COOKIE_NAME}=${same}`);
    expect(response.status).toBe(303);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(deps.openSession).toHaveBeenCalledTimes(1);
  });

  it("refuses a cookie longer than 1024 characters, even one that would decode", async () => {
    await refusedWith((value) => {
      const padded = encode({ ...decode(value), pad: "x".repeat(1024) });
      expect(padded.length).toBeGreaterThan(1024);
      return padded;
    });
  });

  it.each([
    ["version 2", (a: Record<string, unknown>) => ({ ...a, v: 2 })],
    ["no version", (a: Record<string, unknown>) => ({ ...a, v: undefined })],
    ["version as text", (a: Record<string, unknown>) => ({ ...a, v: "1" })],
    ["a short nonce", (a: Record<string, unknown>) => ({ ...a, nonce: "n" })],
    ["a verifier with padding", (a: Record<string, unknown>) => ({ ...a, codeVerifier: `${String(a.codeVerifier).slice(0, 42)}=` })],
    ["a numeric state", (a: Record<string, unknown>) => ({ ...a, state: 42 })],
    ["no verifier", (a: Record<string, unknown>) => ({ ...a, codeVerifier: undefined })],
  ])("refuses an attempt with %s", async (_name, edit) => {
    await refusedWith((value) => encode(edit(decode(value))));
  });

  it.each([
    ["null", encode(null)],
    ["an array", encode([1])],
    ["a number", encode(1)],
    ["text that is not JSON", Buffer.from("{v:1").toString("base64url")],
  ])("refuses an attempt that decodes to %s", async (_name, attempt) => {
    await refusedWith(() => attempt);
  });

  it("reads the attempt cookie by its exact name only", async () => {
    for (const rename of [(name: string) => `x${name}`, (name: string) => name.toLowerCase()]) {
      const verify = vi.spyOn(deps.oidc, "verify");
      const { authorize, value } = await begin();
      await expectRefused(await callback(idp.approve(authorize, CALLBACK), `${rename(LOGIN_COOKIE_NAME)}=${value}`));
      expect(verify).not.toHaveBeenCalled();
      verify.mockRestore();
    }
    expect(idp.tokenRequests).toHaveLength(0);
  });

  it("returns to the default path when the cookie carries an unsafe returnTo", async () => {
    const { authorize, value } = await begin();
    const forged = encode({ ...decode(value), returnTo: "//zlo.test/" });
    const response = await callback(idp.approve(authorize, CALLBACK), `${LOGIN_COOKIE_NAME}=${forged}`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP}/`);
  });
});

describe("finishLogin when the provider fails", () => {
  it("shows the neutral page for an error the provider sent back, without redeeming anything", async () => {
    const { authorize, value } = await begin();
    const url = new URL(CALLBACK);
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("error_description", "Ana Anić je odbila");
    url.searchParams.set("state", authorize.searchParams.get("state")!);
    const response = await callback(url, `${LOGIN_COOKIE_NAME}=${value}`);
    await expectRefused(response);
    expect(await response.text()).not.toContain("Ana Anić");
    expect(idp.tokenRequests).toHaveLength(0);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("Ana Anić");
  });

  it("refuses a callback without a query", async () => {
    const { value } = await begin();
    await expectRefused(await callback(CALLBACK, `${LOGIN_COOKIE_NAME}=${value}`));
    expect(idp.tokenRequests).toHaveLength(0);
  });

  it.each([
    ["the client is refused", { endpointStatus: { path: "/token", status: 401 } }, 400],
    ["the code has expired", { codeExpired: true }, 400],
    ["the token response has no ID token", { tokenBody: (b: Record<string, unknown>) => ({ ...b, id_token: undefined }) }, 400],
    ["the JWKS cannot be fetched", { reject: { path: "/jwks", error: new TypeError("fetch failed") } }, 503],
    ["userinfo answers 503", { endpointStatus: { path: "/me", status: 503 } }, 503],
    ["the token endpoint times out", { reject: { path: "/token", error: new DOMException("timed out", "TimeoutError") } }, 503],
  ])("refuses with the right status when %s", async (_name, next, status) => {
    const { authorize, value } = await begin();
    idp.state.next = next;
    const response = await callback(idp.approve(authorize, CALLBACK), `${LOGIN_COOKIE_NAME}=${value}`);
    await expectRefused(response, status);
  });
});

describe("finishLogin when the session ports fail", () => {
  async function approvedCallback(extraCookie = "") {
    const { authorize, value } = await begin();
    return callback(idp.approve(authorize, CALLBACK), `${LOGIN_COOKIE_NAME}=${value}${extraCookie}`);
  }

  it("shows the unavailable page when opening the session throws, and logs only a code", async () => {
    deps.openSession.mockRejectedValueOnce(Object.assign(new Error("connect ana@demo.ductus.test"), { code: "ECONNREFUSED" }));
    const response = await approvedCallback();
    expect(response.status).toBe(503);
    expect(setCookies(response).has(SESSION_COOKIE_NAME)).toBe(false);
    expect(setCookies(response).get(LOGIN_COOKIE_NAME)).toMatch(/Max-Age=0/);
    expect(await response.text()).toContain("trenutačno ne odgovara");
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).toContain("Error:ECONNREFUSED");
    expect(logged).not.toContain("ana@demo.ductus.test");
  });

  it("shows the neutral 400 page on a conflict", async () => {
    deps.openSession.mockResolvedValueOnce({ ok: false, reason: "conflict" });
    const response = await approvedCallback();
    expect(response.status).toBe(400);
    expect(setCookies(response).has(SESSION_COOKIE_NAME)).toBe(false);
    expect(await response.text()).toContain("Prijava nije dovršena");
  });

  it("still signs in when the previous session cannot be closed", async () => {
    deps.closeSession.mockRejectedValueOnce(new Error("down"));
    const response = await approvedCallback(`; ${SESSION_COOKIE_NAME}=${"p".repeat(43)}`);
    expect(response.status).toBe(303);
    expect(cookieValue(setCookies(response).get(SESSION_COOKIE_NAME)!)).toMatch(RANDOM);
  });

  it("closes nothing when the browser had no session", async () => {
    expect((await approvedCallback()).status).toBe(303);
    expect(deps.closeSession).not.toHaveBeenCalled();
  });

  it("opens the session with the hash of the token it sets, never the token itself", async () => {
    const response = await approvedCallback();
    const token = cookieValue(setCookies(response).get(SESSION_COOKIE_NAME)!);
    const input = deps.openSession.mock.calls[0][0] as { tokenHash: Buffer };
    expect(Buffer.isBuffer(input.tokenHash)).toBe(true);
    expect(input.tokenHash.equals(hashSessionToken(token))).toBe(true);
    expect(JSON.stringify(deps.openSession.mock.calls)).not.toContain(token);
  });
});

describe("logout", () => {
  it("clears the cookie without calling the database when there is no session", async () => {
    const response = await logout(new Request(`${APP}/api/auth/logout`, { method: "POST", headers: { "sec-fetch-site": "same-origin", origin: APP } }), deps);
    expect(response.status).toBe(303);
    expect(deps.closeSession).not.toHaveBeenCalled();
    expect(setCookies(response).get(SESSION_COOKIE_NAME)).toMatch(/Max-Age=0$/);
  });
});

describe("isSameOrigin", () => {
  const request = (headers: Record<string, string>) => new Request(`${APP}/api/auth/logout`, { method: "POST", headers });

  it.each([
    ["Sec-Fetch-Site same-origin over this Origin", { "sec-fetch-site": "same-origin", origin: APP }, true],
    ["this Origin without Sec-Fetch-Site", { origin: APP }, true],
    ["Sec-Fetch-Site same-origin over a foreign Origin (DAN-302 L2)", { "sec-fetch-site": "same-origin", origin: "https://zlo.test" }, false],
    ["Sec-Fetch-Site same-origin without Origin (DAN-302 L2)", { "sec-fetch-site": "same-origin" }, false],
    ["Sec-Fetch-Site none over this Origin", { "sec-fetch-site": "none", origin: APP }, false],
    ["Sec-Fetch-Site cross-site over this Origin", { "sec-fetch-site": "cross-site", origin: APP }, false],
    ["an empty Sec-Fetch-Site over this Origin", { "sec-fetch-site": "", origin: APP }, false],
    ["Sec-Fetch-Site in capitals", { "sec-fetch-site": "Same-Origin", origin: APP }, false],
    ["this Origin with a trailing slash", { origin: `${APP}/` }, false],
    ["this Origin over http", { origin: APP.replace("https", "http") }, false],
  ])("decides on %s", (_name, headers, expected) => {
    expect(isSameOrigin(request(headers), APP)).toBe(expected);
  });
});

describe("failurePage", () => {
  it("shows one body for 400 and 403, another for 503, and never caches", async () => {
    const [bad, forbidden, down] = [failurePage(400), failurePage(403), failurePage(503)];
    expect(await bad.text()).toBe(await forbidden.text());
    expect(await down.text()).toContain("trenutačno ne odgovara");
    for (const page of [bad, forbidden, down]) {
      expect(page.headers.get("cache-control")).toBe("no-store");
      expect(page.headers.get("referrer-policy")).toBe("no-referrer");
      expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    }
  });

  it("keeps extra headers but not ones that would let the page be cached", () => {
    const page = failurePage(400, new Headers({ "set-cookie": "a=b", "cache-control": "public, max-age=600" }));
    expect(page.headers.getSetCookie()).toEqual(["a=b"]);
    expect(page.headers.get("cache-control")).toBe("no-store");
  });
});
