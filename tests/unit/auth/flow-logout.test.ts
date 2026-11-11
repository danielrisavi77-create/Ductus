import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadAuthConfig } from "@/server/auth/config";
import { logout, type AuthDeps } from "@/server/auth/flow";
import { createOidcClient } from "@/server/auth/oidc";
import { sessionTag } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";

import { CLIENT_ID, CLIENT_SECRET, createTestIdp, ISSUER } from "./test-idp";

// DAN-212: logout ends the session at the provider too (RP-initiated logout),
// plan of attack #1245, items B, C, D and E. Real openid-client against the
// in-process provider; every value is invented.
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
const TOKEN = "t".repeat(43);
const SAME_ORIGIN = { "sec-fetch-site": "same-origin", origin: APP };

let idp: ReturnType<typeof createTestIdp>;
let deps: AuthDeps & { closeSession: ReturnType<typeof vi.fn> };
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
    closeSession: vi.fn(async () => {
      events.push("close");
      return true;
    }),
    closeAllSessions: vi.fn(),
  };
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function post(headers: Record<string, string> = SAME_ORIGIN, { cookie = true, url = `${APP}/api/auth/logout` } = {}) {
  return logout(
    new Request(url, {
      method: "POST",
      headers: cookie ? { cookie: `${SESSION_COOKIE_NAME}=${TOKEN}`, ...headers } : headers,
    }),
    deps,
  );
}

/** The response's cookies: only the cleared session cookie, every time (E1). */
function expectOnlyClearedCookie(response: Response): void {
  const cookies = response.headers.getSetCookie();
  expect(cookies).toHaveLength(1);
  expect(cookies[0]).toMatch(/^__Host-ductus_session=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0$/);
}

describe("logout at the provider", () => {
  it("closes the Ductus session first, then sends the browser to the provider's logout", async () => {
    const response = await post();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(PROVIDER_LOGOUT);
    expect(deps.closeSession).toHaveBeenCalledWith(TOKEN);
    expect(events[0]).toBe("close");
    expect(events.slice(1).every((event) => event === "provider")).toBe(true);
    expectOnlyClearedCookie(response);
  });

  it("C5: the redirect is not stored and sends no Referer", async () => {
    const response = await post();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("C6, E1: the provider address holds client_id and the return address, no secret, token or hint", async () => {
    const response = await post();
    const location = new URL(response.headers.get("location")!);
    expect([...location.searchParams.keys()].sort()).toEqual(["client_id", "post_logout_redirect_uri"]);
    const everything = JSON.stringify([...response.headers]);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(CLIENT_SECRET);
    expect(everything).not.toContain("id_token_hint");
  });

  it("C1: nothing from the request reaches either address", async () => {
    const response = await post(
      {
        ...SAME_ORIGIN,
        host: "napadac.test",
        "x-forwarded-host": "napadac.test",
        "x-forwarded-proto": "http",
        referer: "https://napadac.test/",
      },
      { url: `${APP}/api/auth/logout?post_logout_redirect_uri=https://napadac.test/&client_id=drugi&state=x` },
    );
    expect(response.headers.get("location")).toBe(PROVIDER_LOGOUT);
  });

  it("B4: goes to the provider without a session cookie, without touching the database", async () => {
    const response = await post(SAME_ORIGIN, { cookie: false });
    expect(response.headers.get("location")).toBe(PROVIDER_LOGOUT);
    expect(deps.closeSession).not.toHaveBeenCalled();
    expectOnlyClearedCookie(response);
  });

  it("B4: goes to the provider when the session was already closed or had expired", async () => {
    deps.closeSession.mockResolvedValueOnce(false);
    const response = await post();
    expect(response.headers.get("location")).toBe(PROVIDER_LOGOUT);
  });

  it("B3: when closing fails, still clears the cookie and goes to the provider", async () => {
    deps.closeSession.mockRejectedValueOnce(Object.assign(new Error("down"), { code: "ECONNREFUSED" }));
    const response = await post();
    expect(response.headers.get("location")).toBe(PROVIDER_LOGOUT);
    expectOnlyClearedCookie(response);
  });

  it("B2: without an end_session_endpoint the local logout stands and / follows", async () => {
    idp.state.next = {};
    const response = await post();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(HOME);
    expect(deps.closeSession).toHaveBeenCalledWith(TOKEN);
    expectOnlyClearedCookie(response);
    expect(errors).not.toHaveBeenCalled();
  });

  it("C4: an endpoint without TLS is not used", async () => {
    idp.state.next = { endSessionEndpoint: "http://127.0.0.1:9443/session/end" };
    expect((await post()).headers.get("location")).toBe(HOME);
  });

  const MARKER = "napadac.test/provider-detail";
  it.each([
    ["is unreachable", { down: true }],
    ["answers discovery with 503", { endpointStatus: { path: "/.well-known/openid-configuration", status: 503 } }],
    [
      "times out",
      {
        reject: {
          path: "/.well-known/openid-configuration",
          error: new DOMException(`timeout ${MARKER}`, "TimeoutError"),
        },
      },
    ],
    ["fails with a detailed message", { reject: { path: "/.well-known/openid-configuration", error: new Error(MARKER) } }],
  ])("B1, E2: when the provider %s, the local logout stands and / follows", async (_name, next) => {
    idp.state.next = { endSessionEndpoint: ENDPOINT, ...next };
    const response = await post();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(HOME);
    expect(deps.closeSession).toHaveBeenCalledWith(TOKEN);
    expect(events[0]).toBe("close");
    expectOnlyClearedCookie(response);
    // Only the stage and an error code: nothing from the request or the provider.
    expect(errors).toHaveBeenCalledWith("login failed", "end_session", expect.any(String));
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).not.toContain(MARKER);
    expect(logged).not.toContain(TOKEN);
  });

  it("D1: a logout from another origin is refused before the session or the provider", async () => {
    const response = await post({ "sec-fetch-site": "cross-site", origin: "https://napadac.test" });
    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
    expect(deps.closeSession).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("D2: the logout route answers POST alone", async () => {
    const route = await import("../../../app/api/auth/logout/route");
    expect(Object.keys(route).filter((name) => /^[A-Z]+$/.test(name))).toEqual(["POST"]);
  });
});

// DAN-99 (#1929, cxcr1929 / cxcq1929): the native POST that follows a
// successful fetch carries the tag of the session the click ended. The route
// closes and clears only the session whose cookie has that tag; a newer
// session signed in meanwhile in another tab stays, cookie and all.
describe("logout with the tag of the click's session", () => {
  const OTHER = "u".repeat(43);
  const TAG = sessionTag(TOKEN)!;
  const OTHER_TAG = sessionTag(OTHER)!;
  const form = (body: string) => ({ "content-type": "application/x-www-form-urlencoded", ...SAME_ORIGIN, body });

  function send(cookieValue: string | null, init: { body?: string; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...SAME_ORIGIN, ...init.headers };
    if (cookieValue !== null) headers.cookie = `${SESSION_COOKIE_NAME}=${cookieValue}`;
    return logout(new Request(`${APP}/api/auth/logout`, { method: "POST", headers, body: init.body }), deps);
  }
  const formBody = (body: string) => {
    const { body: text, ...headers } = form(body);
    return { body: text, headers };
  };

  // (t1) No field: as before, for the fetch and the form without script.
  const absent: [string, { body?: string; headers?: Record<string, string> }][] = [
    ["no body", {}],
    ["an empty body", formBody("")],
    ["a body without the field", formBody("other=1")],
  ];
  // (t3)-(t7) A field that names no session of this cookie.
  const foreign: [string, { body?: string; headers?: Record<string, string> }][] = [
    ["the click's tag under a newer cookie", formBody(`session=${TAG}`)],
    ["an empty tag", formBody("session=")],
    ["the tag in capitals", formBody(`session=${TAG.toUpperCase()}`)],
    ["a shortened tag", formBody(`session=${TAG.slice(0, 63)}`)],
    ["a lengthened tag", formBody(`session=${TAG}0`)],
    ["a tag that is not hex", formBody(`session=${"z".repeat(64)}`)],
    ["the field twice", formBody(`session=${TAG}&session=${TAG}`)],
    ["a body of another type", { body: `session=${TAG}`, headers: { "content-type": "text/plain" } }],
    ["a body over the limit", formBody(`session=${TAG}&pad=${"x".repeat(400)}`)],
    ["a malformed Content-Length", { ...formBody(`session=${TAG}`), headers: { ...formBody("").headers, "content-length": "-1" } }],
  ];

  it.each(absent)("t1 × cookie: %s closes and clears the cookie's session as before", async (_name, init) => {
    const response = await send(TOKEN, init);
    expect(deps.closeSession).toHaveBeenCalledWith(TOKEN);
    expect(response.headers.get("location")).toBe(PROVIDER_LOGOUT);
    expectOnlyClearedCookie(response);
  });

  it("t2 × cookie: the click's tag closes and clears that session, then the provider", async () => {
    const response = await send(TOKEN, formBody(`session=${TAG}`));
    expect(deps.closeSession).toHaveBeenCalledWith(TOKEN);
    expect(response.headers.get("location")).toBe(PROVIDER_LOGOUT);
    expectOnlyClearedCookie(response);
  });

  it.each(foreign)("Istodobnost, t3-t7 × newer cookie: %s touches nothing and goes to /", async (_name, init) => {
    const response = await send(OTHER, init);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(HOME);
    expect(deps.closeSession).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(events).toEqual([]);
  });

  it.each([["the tag of another cookie", `session=${TAG}`], ["an empty tag", "session="]])(
    "k3, malformed cookie with %s: touches nothing and goes to /",
    async (_name, body) => {
      const response = await send("kratko", formBody(body));
      expect(response.headers.get("location")).toBe(HOME);
      expect(deps.closeSession).not.toHaveBeenCalled();
      expect(response.headers.getSetCookie()).toEqual([]);
    },
  );

  it.each([["the click's tag", `session=${TAG}`], ["an empty tag", "session="], ["another tag", `session=${OTHER_TAG}`]])(
    "Istodobnost, k1 × %s: goes to the provider and clears no cookie set meanwhile",
    async (_name, body) => {
      const response = await send(null, formBody(body));
      expect(response.headers.get("location")).toBe(PROVIDER_LOGOUT);
      expect(deps.closeSession).not.toHaveBeenCalled();
      expect(response.headers.getSetCookie()).toEqual([]);
    },
  );

  it("a tag from another origin is still refused before anything", async () => {
    const response = await send(TOKEN, {
      ...formBody(`session=${TAG}`),
      headers: { ...formBody("").headers, "sec-fetch-site": "cross-site", origin: "https://napadac.test" },
    });
    expect(response.status).toBe(403);
    expect(deps.closeSession).not.toHaveBeenCalled();
  });
});
