import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { loadAuthConfig } from "@/server/auth/config";
import { logoutAll, type AuthDeps } from "@/server/auth/flow";
import { createOidcClient } from "@/server/auth/oidc";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";

import { CLIENT_ID, CLIENT_SECRET, createTestIdp, ISSUER } from "./test-idp";

// DAN-296 (D-200 P2, PR2): sign out on every device. The input classes of the
// contract addendum on #1091; real openid-client against the in-process
// provider, every value invented.
const APP = "https://ductus.test";
const config = loadAuthConfig({
  NODE_ENV: "test",
  DUCTUS_AUTH_PROVIDER: "fake-oidc",
  OIDC_ISSUER: ISSUER,
  OIDC_CLIENT_ID: CLIENT_ID,
  OIDC_CLIENT_SECRET: CLIENT_SECRET,
  OIDC_REDIRECT_URI: `${APP}/api/auth/callback`,
});
const ENDPOINT = `${ISSUER}/session/end`;
const PROVIDER_LOGOUT = `${ENDPOINT}?post_logout_redirect_uri=${encodeURIComponent(`${APP}/`)}&client_id=${CLIENT_ID}`;
const HOME = `${APP}/`;
const TOKEN = "a".repeat(43);
const SAME_ORIGIN = { "sec-fetch-site": "same-origin", origin: APP };
const CLEARED = /^__Host-ductus_session=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0$/;

let idp: ReturnType<typeof createTestIdp>;
let deps: AuthDeps & { closeSession: ReturnType<typeof vi.fn>; closeAllSessions: ReturnType<typeof vi.fn> };
let errors: ReturnType<typeof vi.spyOn>;
let events: string[];

beforeEach(() => {
  idp = createTestIdp();
  idp.state.next = { endSessionEndpoint: ENDPOINT };
  events = [];
  const fetchImpl = (async (...args: Parameters<typeof fetch>) => {
    events.push("provider");
    return idp.fetch(...args);
  }) as typeof fetch;
  deps = {
    config,
    oidc: createOidcClient(config, fetchImpl),
    openSession: vi.fn(),
    closeSession: vi.fn(async () => true),
    closeAllSessions: vi.fn(async () => {
      events.push("close_all");
    }),
  };
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function post(headers: Record<string, string> = SAME_ORIGIN, cookie: string | null = TOKEN) {
  return logoutAll(
    new Request(`${APP}/api/auth/logout-all`, {
      method: "POST",
      headers: cookie === null ? headers : { cookie: `${SESSION_COOKIE_NAME}=${cookie}`, ...headers },
    }),
    deps,
  );
}

function expectOnlyClearedCookie(response: Response): void {
  const cookies = response.headers.getSetCookie();
  expect(cookies).toHaveLength(1);
  expect(cookies[0]).toMatch(CLEARED);
}

describe("POST /api/auth/logout-all", () => {
  it("1: closes every session of the account first, then clears the cookie and goes to the provider", async () => {
    const response = await post();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(PROVIDER_LOGOUT);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(deps.closeAllSessions).toHaveBeenCalledExactlyOnceWith(TOKEN);
    expect(deps.closeSession).not.toHaveBeenCalled();
    expect(events[0]).toBe("close_all");
    expect(events.slice(1).every((event) => event === "provider")).toBe(true);
    expectOnlyClearedCookie(response);
    expect(JSON.stringify([...response.headers])).not.toContain(TOKEN);
  });

  it("2: without a session cookie runs no query and answers the same way", async () => {
    const response = await post(SAME_ORIGIN, null);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(PROVIDER_LOGOUT);
    expect(deps.closeAllSessions).not.toHaveBeenCalled();
    expectOnlyClearedCookie(response);
  });

  it.each([
    ["malformed", "nije-token"],
    ["unknown, closed, expired or idle", "b".repeat(43)],
  ])("3: a %s cookie goes to the database, which closes nothing, and the answer does not tell", async (_name, value) => {
    const withNothing = await post(SAME_ORIGIN, null);
    const response = await post(SAME_ORIGIN, value);
    expect(deps.closeAllSessions).toHaveBeenCalledExactlyOnceWith(value);
    expect(response.status).toBe(withNothing.status);
    expect(response.headers.get("location")).toBe(withNothing.headers.get("location"));
    expect(response.headers.getSetCookie()).toEqual(withNothing.headers.getSetCookie());
  });

  it.each([
    ["a cross-site origin", { "sec-fetch-site": "cross-site", origin: "https://napadac.test" }],
    ["a foreign origin", { origin: "https://napadac.test" }],
    ["no Origin", { "sec-fetch-site": "same-origin" }],
    ["a same-site but not same-origin fetch", { "sec-fetch-site": "same-site", origin: APP }],
  ])("4: %s is refused before the database and the provider, the cookie untouched", async (_name, headers) => {
    const response = await post(headers);
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(deps.closeAllSessions).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(errors).toHaveBeenCalledWith("login failed", "logout_all", "cross_origin");
  });

  it("5: the route answers POST alone, so GET is 405 and runs nothing", async () => {
    const route = await import("../../../app/api/auth/logout-all/route");
    expect(Object.keys(route).filter((name) => /^[A-Z]+$/.test(name))).toEqual(["POST"]);
  });

  it("6: when the database fails, answers 503, keeps the cookie and goes nowhere", async () => {
    deps.closeAllSessions.mockRejectedValueOnce(Object.assign(new Error("down"), { code: "40P01" }));
    const response = await post();
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(events).toEqual([]);
    const html = await response.text();
    expect(html).toContain(t.auth.logoutFailedTitle);
    expect(html).toContain(t.auth.logoutFailedBody);
    expect(errors).toHaveBeenCalledWith("login failed", "logout_all", "Error:40P01");
    expect(JSON.stringify(errors.mock.calls)).not.toContain(TOKEN);
  });

  it("when the provider fails, the local sign-out stands and / follows", async () => {
    idp.state.next = { endSessionEndpoint: ENDPOINT, down: true };
    const response = await post();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(HOME);
    expect(deps.closeAllSessions).toHaveBeenCalledWith(TOKEN);
    expectOnlyClearedCookie(response);
    expect(errors).toHaveBeenCalledWith("login failed", "end_session", expect.any(String));
  });
});
