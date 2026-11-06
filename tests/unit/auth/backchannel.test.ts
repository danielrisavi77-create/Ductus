import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backchannelLogout, MAX_BACKCHANNEL_BODY_BYTES, type BackchannelDeps } from "@/server/auth/backchannel";
import { loadAuthConfig } from "@/server/auth/config";
import { createCachedKeySource } from "@/server/auth/logout-keys";
import { BACKCHANNEL_LOGOUT_EVENT } from "@/server/auth/logout-token";
import { createOidcClient } from "@/server/auth/oidc";
import type { BackchannelLogout } from "@/server/db";

import { CLIENT_ID, CLIENT_SECRET, createTestIdp, ISSUER } from "./test-idp";

// DAN-474: the back-channel logout route (attack plan #1620: A1, A2, A5, B1, E4, G2 to G5).
// Real openid-client discovery and JWKS against the in-process provider;
// every identifier is invented.
const APP = "https://ductus.test";
const config = loadAuthConfig({
  NODE_ENV: "test",
  DUCTUS_AUTH_PROVIDER: "fake-oidc",
  OIDC_ISSUER: ISSUER,
  OIDC_CLIENT_ID: CLIENT_ID,
  OIDC_CLIENT_SECRET: CLIENT_SECRET,
  OIDC_REDIRECT_URI: `${APP}/api/auth/callback`,
});
const URL_ = `${APP}/api/auth/backchannel-logout`;
const SUB = "sub-demo-bc";
const SID = "sid-demo-bc-1";
const JTI = "jti-demo-bc-1";

let idp: ReturnType<typeof createTestIdp>;
let port: ReturnType<typeof vi.fn<BackchannelLogout>>;
let deps: BackchannelDeps;
let errors: ReturnType<typeof vi.spyOn>;

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: CLIENT_ID,
    iat: Math.floor(Date.now() / 1000),
    jti: JTI,
    sub: SUB,
    sid: SID,
    events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
    ...overrides,
  };
}

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
  });
}

const form = (token: string) => new URLSearchParams({ logout_token: token }).toString();

beforeEach(() => {
  idp = createTestIdp();
  const oidc = createOidcClient(config, idp.fetch);
  port = vi.fn<BackchannelLogout>(async () => ({ ok: true, closed: 1 }));
  deps = {
    config,
    discoveredIssuer: () => oidc.discoveredIssuer(),
    keys: createCachedKeySource({ load: () => oidc.jwks() }),
    backchannelLogout: port,
  };
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errors.mockRestore();
});

function logged(): string {
  return JSON.stringify(errors.mock.calls);
}

describe("backchannel logout route", () => {
  it("A1: closes what a valid token names and answers 200 with no-store and no body", async () => {
    const response = await backchannelLogout(post(form(idp.logoutToken(claims()))), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(port).toHaveBeenCalledWith({ issuer: ISSUER, subject: SUB, sid: SID, jti: JTI });
  });

  it("C5, C6: answers 200 when nothing matched (§2.8)", async () => {
    port.mockResolvedValueOnce({ ok: true, closed: 0 });
    expect((await backchannelLogout(post(form(idp.logoutToken(claims()))), deps)).status).toBe(200);
  });

  it("G2: trusts no cookie, origin or session named by the caller", async () => {
    const request = post(form(idp.logoutToken(claims())), {
      cookie: "__Host-ductus_session=" + "x".repeat(43),
      origin: "https://elsewhere.test",
      "sec-fetch-site": "cross-site",
    });
    expect((await backchannelLogout(request, deps)).status).toBe(200);
    expect(port).toHaveBeenCalledTimes(1);
    expect(port.mock.calls[0]![0]).toEqual({ issuer: ISSUER, subject: SUB, sid: SID, jti: JTI });
  });

  it.each([
    ["no content type", () => new Request(URL_, { method: "POST", body: "logout_token=a.b.c" })],
    ["JSON", () => post(JSON.stringify({ logout_token: "a.b.c" }), { "content-type": "application/json" })],
    ["no token", () => post("other=1")],
    ["an empty token", () => post("logout_token=")],
    ["two tokens", () => post(`${form(idp.logoutToken(claims()))}&${form(idp.logoutToken(claims()))}`)],
    ["a declared body over the limit", () => post("logout_token=a", { "content-length": String(MAX_BACKCHANNEL_BODY_BYTES + 1) })],
    ["a streamed body over the limit", () => post(`logout_token=${"a".repeat(MAX_BACKCHANNEL_BODY_BYTES)}`)],
    ["a body that is not UTF-8", () => new Request(URL_, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new Uint8Array([0x6c, 0x3d, 0xff, 0xfe]),
    })],
  ])("A2: refuses %s with 400 before anything is closed", async (_name, request) => {
    const response = await backchannelLogout(request(), deps);
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(port).not.toHaveBeenCalled();
  });

  it("A5: refuses a token the provider did not sign with 400", async () => {
    idp.state.next = { signing: "foreign-key" };
    const response = await backchannelLogout(post(form(idp.logoutToken(claims()))), deps);
    expect(response.status).toBe(400);
    expect(port).not.toHaveBeenCalled();
  });

  it("B1: refuses a replayed jti with 400", async () => {
    port.mockResolvedValueOnce({ ok: false, reason: "replayed" });
    expect((await backchannelLogout(post(form(idp.logoutToken(claims()))), deps)).status).toBe(400);
    expect(logged()).toContain("replayed");
  });

  it("G3: answers 503 when the provider keys are unavailable", async () => {
    idp.state.next = { down: true };
    const response = await backchannelLogout(post(form("e30.e30.c2ln")), deps);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(port).not.toHaveBeenCalled();
  });

  it("G5: answers 503 when the database fails", async () => {
    port.mockRejectedValueOnce(Object.assign(new Error("connection terminated"), { code: "57P01" }));
    expect((await backchannelLogout(post(form(idp.logoutToken(claims()))), deps)).status).toBe(503);
  });

  it("G4: tokens with unknown kids do not make it fetch the JWKS each time", async () => {
    idp.state.next = { signing: "unknown-kid" };
    for (let i = 0; i < 5; i++) {
      expect((await backchannelLogout(post(form(idp.logoutToken(claims()))), deps)).status).toBe(400);
    }
    expect(idp.requests.filter((path) => path === "/jwks").length).toBeLessThanOrEqual(1);
  });

  it("E4: logs a stage and a code, never the token, sub, sid or jti", async () => {
    const token = idp.logoutToken(claims({ aud: "someone-else" }));
    await backchannelLogout(post(form(token)), deps);
    port.mockResolvedValueOnce({ ok: false, reason: "replayed" });
    await backchannelLogout(post(form(idp.logoutToken(claims()))), deps);
    const text = logged();
    expect(errors).toHaveBeenCalled();
    for (const secret of [token, token.split(".")[2]!, SUB, SID, JTI]) expect(text).not.toContain(secret);
  });
});
