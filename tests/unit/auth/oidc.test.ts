import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { loadAuthConfig } from "@/server/auth/config";
import {
  accountIssuer,
  createOidcClient,
  isProviderUnavailable,
  limitedFetch,
  newLoginChecks,
  ProviderUnavailableError,
  type LoginChecks,
  type OidcClient,
} from "@/server/auth/oidc";

import { CLIENT_ID, CLIENT_SECRET, createTestIdp, ISSUER } from "./test-idp";

// Direct tests of oidc.ts (DAN-307): the relying party against the real
// openid-client and the in-process provider, one misbehaviour at a time.
// flow.test.ts drives the same client through the routes. Values are invented.
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

const RANDOM = /^[A-Za-z0-9_-]{43}$/;
const now = () => Math.floor(Date.now() / 1000);
const without = (claims: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(claims).filter(([k]) => k !== key));

let idp: ReturnType<typeof createTestIdp>;
let oidc: OidcClient;

beforeEach(() => {
  idp = createTestIdp();
  oidc = createOidcClient(config, idp.fetch);
});

/** One sign-in at the provider: the checks and the callback URL it redirects to. */
async function approved(): Promise<{ checks: LoginChecks; url: URL }> {
  const checks = newLoginChecks();
  const url = idp.approve(await oidc.authorizationUrl(checks), CALLBACK);
  return { checks, url };
}

async function refused(promise: Promise<unknown>, unavailable = false): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, "verify must reject").toBeInstanceOf(Error);
  expect(isProviderUnavailable(error)).toBe(unavailable);
}

describe("newLoginChecks", () => {
  it("makes state, nonce and verifier of 32 random bytes each, all different", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const { state, nonce, codeVerifier } = newLoginChecks();
      for (const value of [state, nonce, codeVerifier]) {
        expect(value).toMatch(RANDOM);
        expect(seen.has(value)).toBe(false);
        seen.add(value);
      }
    }
  });
});

describe("accountIssuer", () => {
  it.each([
    ["https://idp.test", "https://idp.test"],
    ["https://idp.test/", "https://idp.test"],
    ["HTTPS://IDP.TEST", "https://idp.test"],
    ["https://idp.test:443/", "https://idp.test"],
    ["https://idp.test:8443/", "https://idp.test:8443"],
    ["https://idp.test/realm", "https://idp.test/realm"],
    ["https://idp.test/realm/", "https://idp.test/realm/"],
    ["https://idp.test/?x=1", "https://idp.test/?x=1"],
  ])("writes %s as %s", (input, expected) => {
    expect(accountIssuer(new URL(input))).toBe(expected);
  });
});

describe("isProviderUnavailable", () => {
  const chain = (depth: number, last: Error) => {
    let error = last;
    for (let i = 0; i < depth; i++) error = new Error(`wrap ${i}`, { cause: error });
    return error;
  };
  const timeout = () => Object.assign(new Error("timed out"), { name: "TimeoutError" });

  it.each([
    ["ProviderUnavailableError", new ProviderUnavailableError("x"), true],
    ["a TimeoutError", timeout(), true],
    ["an AbortError DOMException", new DOMException("aborted", "AbortError"), true],
    ["a TimeoutError DOMException", new DOMException("timed out", "TimeoutError"), true],
    ["one wrapped four times", chain(4, new ProviderUnavailableError("x")), true],
    ["one wrapped five times", chain(5, new ProviderUnavailableError("x")), false],
    ["a plain Error", new Error("invalid_grant"), false],
    ["a TypeError", new TypeError("fetch failed"), false],
    ["a string", "ProviderUnavailableError", false],
    ["undefined", undefined, false],
  ])("classifies %s", (_name, error, expected) => {
    expect(isProviderUnavailable(error)).toBe(expected);
  });
});

describe("limitedFetch", () => {
  const LIMIT = 1024;
  const respond = (response: Response | (() => Promise<Response>)) =>
    (async () => (typeof response === "function" ? response() : response)) as typeof fetch;
  const call = (fetchImpl: typeof fetch) => limitedFetch(LIMIT, fetchImpl)("https://idp.test/x", { body: undefined, headers: {}, method: "GET", redirect: "manual" });

  /** A body streamed in chunks without Content-Length; counts what was pulled. */
  function stream(total: number, chunk = 256) {
    const counter = { sent: 0, cancelled: false };
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (counter.sent >= total) return controller.close();
        counter.sent += chunk;
        controller.enqueue(new Uint8Array(chunk).fill(0x61));
      },
      cancel() {
        counter.cancelled = true;
      },
      // No pull before the first read, so `sent` counts only what was read.
    }, { highWaterMark: 0 });
    return { body, counter };
  }

  it("turns a network failure into ProviderUnavailableError and keeps the cause", async () => {
    const cause = new TypeError("fetch failed");
    const error = await call((async () => Promise.reject(cause)) as typeof fetch).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as Error).cause).toBe(cause);
  });

  it.each([500, 502, 503, 599])("turns a %i answer into ProviderUnavailableError and cancels its body", async (status) => {
    const { body, counter } = stream(10 * LIMIT);
    await expect(call(respond(new Response(body, { status })))).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(counter.cancelled).toBe(true);
  });

  it.each([400, 401, 404])("passes a %i answer through with its body", async (status) => {
    const response = await call(respond(new Response('{"error":"invalid_grant"}', { status, statusText: "No" })));
    expect(response.status).toBe(status);
    expect(response.statusText).toBe("No");
    expect(await response.json()).toEqual({ error: "invalid_grant" });
  });

  it("refuses a Content-Length over the limit without reading the body", async () => {
    const { body, counter } = stream(10 * LIMIT);
    const response = new Response(body, { headers: { "content-length": String(LIMIT + 1) } });
    const error = await call(respond(response)).catch((e: unknown) => e);
    expect((error as Error).message).toBe("provider response is too large");
    expect(isProviderUnavailable(error)).toBe(false);
    expect(counter.sent).toBe(0);
    expect(counter.cancelled).toBe(true);
  });

  it("stops reading a body that outgrows the limit, whatever Content-Length said", async () => {
    const { body, counter } = stream(100 * LIMIT);
    const response = new Response(body, { headers: { "content-length": "10" } });
    await expect(call(respond(response))).rejects.toThrow("provider response is too large");
    expect(counter.sent).toBeLessThanOrEqual(LIMIT + 2 * 256);
    expect(counter.cancelled).toBe(true);
  });

  it("returns a body of exactly the limit whole, with status and headers", async () => {
    const response = await call(respond(new Response("a".repeat(LIMIT), { status: 200, headers: { "content-type": "application/json", "x-test": "1" } })));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-test")).toBe("1");
    expect(await response.text()).toBe("a".repeat(LIMIT));
  });

  it("returns a 204 without a body", async () => {
    const response = await call(respond(new Response(null, { status: 204 })));
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });
});

describe("createOidcClient", () => {
  it("sends state, nonce and the S256 challenge of the verifier to the discovered endpoint", async () => {
    const checks = newLoginChecks();
    const url = await oidc.authorizationUrl(checks);
    expect(url.origin + url.pathname).toBe(`${ISSUER}/auth`);
    const p = url.searchParams;
    expect(p.get("response_type")).toBe("code");
    expect(p.get("client_id")).toBe(CLIENT_ID);
    expect(p.get("state")).toBe(checks.state);
    expect(p.get("nonce")).toBe(checks.nonce);
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toBe(createHash("sha256").update(checks.codeVerifier).digest("base64url"));
    expect(url.href).not.toContain(checks.codeVerifier);
    expect(url.href).not.toContain(CLIENT_SECRET);
  });

  it("discovers once for many logins", async () => {
    for (let i = 0; i < 3; i++) {
      const { checks, url } = await approved();
      await oidc.verify(url, checks);
    }
    expect(idp.requests.filter((p) => p === "/.well-known/openid-configuration")).toHaveLength(1);
  });

  it("retries a failed discovery on the next login instead of keeping the failure", async () => {
    idp.state.next = { down: true };
    await refused(oidc.authorizationUrl(newLoginChecks()), true);
    idp.state.next = {};
    const { checks, url } = await approved();
    await expect(oidc.verify(url, checks)).resolves.toMatchObject({ issuer: ISSUER });
  });

  it.each([
    ["a discovery answering 503", { endpointStatus: { path: "/.well-known/openid-configuration", status: 503 } }],
    ["a discovery that times out", { reject: { path: "/.well-known/openid-configuration", error: new DOMException("timed out", "TimeoutError") } }],
  ])("reports %s as unavailable", async (_name, next) => {
    idp.state.next = next;
    await refused(oidc.authorizationUrl(newLoginChecks()), true);
  });

  it("refuses a provider whose discovery names another issuer, and not as unavailable", async () => {
    const other = createTestIdp(undefined, "https://127.0.0.2:9443");
    const client = createOidcClient(config, other.fetch);
    await refused(client.authorizationUrl(newLoginChecks()));
  });

  it("returns the configured issuer and the verified claims", async () => {
    const { checks, url } = await approved();
    const verified = await oidc.verify(url, checks);
    expect(verified.issuer).toBe(ISSUER);
    expect(verified.idToken).toMatchObject({ iss: ISSUER, aud: CLIENT_ID, sub: "sub-demo-1", nonce: checks.nonce });
    expect(verified.userinfo).toMatchObject({ sub: "sub-demo-1", hrEduPersonUniqueID: "ana@demo.ductus.test" });
  });

  describe("refuses the callback before redeeming the code", () => {
    it.each([
      ["another state", (u: URL) => u.searchParams.set("state", "s".repeat(43))],
      ["no state", (u: URL) => u.searchParams.delete("state")],
      ["two states", (u: URL) => u.searchParams.append("state", u.searchParams.get("state")!)],
      ["no code", (u: URL) => u.searchParams.delete("code")],
      ["another iss", (u: URL) => u.searchParams.set("iss", "https://zlo.test")],
      ["an error from the provider", (u: URL) => {
        u.searchParams.delete("code");
        u.searchParams.set("error", "access_denied");
      }],
      ["an error beside a code", (u: URL) => u.searchParams.set("error", "access_denied")],
    ])("with %s", async (_name, edit) => {
      const { checks, url } = await approved();
      edit(url);
      await refused(oidc.verify(url, checks));
      expect(idp.tokenRequests).toHaveLength(0);
    });
  });

  it("refuses a code redeemed with another attempt's verifier", async () => {
    const { checks, url } = await approved();
    await refused(oidc.verify(url, { ...checks, codeVerifier: newLoginChecks().codeVerifier }));
    expect(idp.tokenRequests.at(-1)?.get("code_verifier")).not.toBe(checks.codeVerifier);
  });

  it("refuses a code redeemed a second time", async () => {
    const { checks, url } = await approved();
    await oidc.verify(url, checks);
    await refused(oidc.verify(url, checks));
    expect(idp.tokenRequests).toHaveLength(2);
  });

  it("refuses an expired code", async () => {
    const { checks, url } = await approved();
    idp.state.next = { codeExpired: true };
    await refused(oidc.verify(url, checks));
  });

  it("refuses an ID token whose nonce is another attempt's", async () => {
    const { checks, url } = await approved();
    await refused(oidc.verify(url, { ...checks, nonce: newLoginChecks().nonce }));
  });

  describe("refuses an ID token", () => {
    it.each([
      ["without iss", (c: Record<string, unknown>) => without(c, "iss")],
      ["without aud", (c: Record<string, unknown>) => without(c, "aud")],
      ["without exp", (c: Record<string, unknown>) => without(c, "exp")],
      ["without iat", (c: Record<string, unknown>) => without(c, "iat")],
      ["with an issuer differing in path", (c: Record<string, unknown>) => ({ ...c, iss: `${ISSUER}/other` })],
      ["for two audiences without azp", (c: Record<string, unknown>) => ({ ...c, aud: [CLIENT_ID, "someone-else"] })],
      ["for two audiences with another azp", (c: Record<string, unknown>) => ({ ...c, aud: [CLIENT_ID, "someone-else"], azp: "someone-else" })],
      ["for an audience list without this client", (c: Record<string, unknown>) => ({ ...c, aud: ["someone-else"] })],
      ["with a numeric subject", (c: Record<string, unknown>) => ({ ...c, sub: 42 })],
      ["with an empty subject", (c: Record<string, unknown>) => ({ ...c, sub: "" })],
      ["with a text exp", (c: Record<string, unknown>) => ({ ...c, exp: String(now() + 300) })],
      ["expired just past the 30 s tolerance", (c: Record<string, unknown>) => ({ ...c, exp: now() - 40 })],
    ])("%s", async (_name, claims) => {
      const { checks, url } = await approved();
      idp.state.next = { claims };
      await refused(oidc.verify(url, checks));
    });
  });

  it("accepts an ID token expired within the clock tolerance", async () => {
    const { checks, url } = await approved();
    idp.state.next = { claims: (c) => ({ ...c, exp: now() - 10 }) };
    await expect(oidc.verify(url, checks)).resolves.toMatchObject({ issuer: ISSUER });
  });

  it("refuses a token response without an ID token", async () => {
    const { checks, url } = await approved();
    idp.state.next = { tokenBody: (b) => without(b, "id_token") };
    await refused(oidc.verify(url, checks));
    expect(idp.requests).not.toContain("/me");
  });

  it("refuses a token response without an access token or of another type", async () => {
    for (const tokenBody of [(b: Record<string, unknown>) => without(b, "access_token"), (b: Record<string, unknown>) => ({ ...b, token_type: "MAC" })]) {
      const { checks, url } = await approved();
      idp.state.next = { tokenBody };
      await refused(oidc.verify(url, checks));
    }
  });

  it.each([
    ["the client is refused (401)", { endpointStatus: { path: "/token", status: 401 } }, false],
    ["the token endpoint answers 400", { endpointStatus: { path: "/token", status: 400 } }, false],
    ["the token endpoint answers 503", { endpointStatus: { path: "/token", status: 503 } }, true],
    ["the token endpoint times out", { reject: { path: "/token", error: new DOMException("timed out", "TimeoutError") } }, true],
    ["the JWKS cannot be fetched", { reject: { path: "/jwks", error: new TypeError("fetch failed") } }, true],
    ["the JWKS answers 500", { endpointStatus: { path: "/jwks", status: 500 } }, true],
    ["userinfo answers 401", { endpointStatus: { path: "/me", status: 401 } }, false],
    ["userinfo answers 502", { endpointStatus: { path: "/me", status: 502 } }, true],
    ["userinfo cannot be fetched", { reject: { path: "/me", error: new TypeError("fetch failed") } }, true],
  ])("refuses when %s", async (_name, next, unavailable) => {
    const { checks, url } = await approved();
    idp.state.next = next;
    await refused(oidc.verify(url, checks), unavailable);
  });

  it("refuses userinfo that is not a JSON object", async () => {
    for (const text of ["not json", "[]", '"sub-demo-1"']) {
      const { checks, url } = await approved();
      idp.state.next = { userinfoBody: () => new Response(text).body! };
      await refused(oidc.verify(url, checks));
    }
  });

  it("refuses userinfo without a subject", async () => {
    const { checks, url } = await approved();
    idp.state.next = { userinfo: (u) => without(u, "sub") };
    await refused(oidc.verify(url, checks));
  });
});
