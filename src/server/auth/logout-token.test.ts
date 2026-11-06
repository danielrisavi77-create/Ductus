import { createHmac, generateKeyPairSync, sign, constants, type KeyObject } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { IdTokenAlg } from "./config";
import { createCachedKeySource, selectKey } from "./logout-keys";
import {
  BACKCHANNEL_LOGOUT_EVENT,
  LogoutTokenError,
  MAX_TOKEN_AGE_SECONDS,
  verifyLogoutToken,
  type LogoutKeySource,
  type LogoutTokenChecks,
} from "./logout-token";

// Attack plan #1620 A1 to A15. Every identifier is invented.
const NOW = 1_800_000_000;
const ISSUER = "http://localhost:8090";
const CLIENT = "ductus-local";
const CHECKS: LogoutTokenChecks = { issuer: ISSUER, clientId: CLIENT, alg: "RS256", clockToleranceSeconds: 30, now: NOW };

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherRsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const ed = generateKeyPairSync("ed25519");

const jwk = (key: KeyObject, kid: string, extra: Record<string, unknown> = {}) => ({
  ...key.export({ format: "jwk" }),
  kid,
  use: "sig",
  ...extra,
});

const JWKS = [jwk(rsa.publicKey, "rsa-1"), jwk(ec.publicKey, "ec-1"), jwk(ed.publicKey, "ed-1")];
const keys: LogoutKeySource = { key: async (kid, alg) => selectKey(JWKS, kid, alg) };

const b64 = (value: unknown) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    iss: ISSUER,
    aud: CLIENT,
    iat: NOW,
    jti: "jti-demo-0001",
    sub: "demo-sub-a",
    sid: "demo-sid-a1",
    events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete base[k];
    else base[k] = v;
  }
  return base;
}

function signToken(
  payload: Record<string, unknown>,
  { alg = "RS256", kid = "rsa-1", key = rsa.privateKey, header = {} as Record<string, unknown> } = {},
): string {
  const head = b64({ alg, kid, typ: "logout+jwt", ...header });
  const body = b64(payload);
  const input = Buffer.from(`${head}.${body}`);
  let signature: Buffer;
  if (alg === "RS256") signature = sign("sha256", input, key);
  else if (alg === "PS256") signature = sign("sha256", input, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 });
  else if (alg === "ES256") signature = sign("sha256", input, { key, dsaEncoding: "ieee-p1363" });
  else signature = sign(null, input, key);
  return `${head}.${body}.${signature.toString("base64url")}`;
}

async function code(token: string, checks: Partial<LogoutTokenChecks> = {}, source = keys): Promise<string> {
  try {
    await verifyLogoutToken(token, { ...CHECKS, ...checks }, source);
    return "ok";
  } catch (error) {
    if (error instanceof LogoutTokenError) return error.code;
    throw error;
  }
}

describe("verifyLogoutToken", () => {
  it("A1: accepts a valid token and returns sub, sid and jti", async () => {
    await expect(verifyLogoutToken(signToken(claims()), CHECKS, keys)).resolves.toEqual({
      sub: "demo-sub-a",
      sid: "demo-sid-a1",
      jti: "jti-demo-0001",
    });
  });

  it.each<[IdTokenAlg, string, KeyObject]>([
    ["PS256", "rsa-1", rsa.privateKey],
    ["ES256", "ec-1", ec.privateKey],
    ["EdDSA", "ed-1", ed.privateKey],
  ])("A1: accepts the pinned %s", async (alg, kid, key) => {
    expect(await code(signToken(claims(), { alg, kid, key }), { alg })).toBe("ok");
  });

  it.each([
    ["two parts", "a.b"],
    ["four parts", "a.b.c.d"],
    ["bad base64url", "a*b.c.d"],
    ["header not JSON", `${b64("not json")}.${b64({})}.c2ln`],
    ["header an array", `${b64([1])}.${b64({})}.c2ln`],
    ["empty signature", `${b64({ alg: "RS256" })}.${b64({})}.`],
    ["too long", "a".repeat(9000)],
  ])("A3: refuses %s", async (_, token) => {
    expect(await code(token)).toBe("malformed");
  });

  it("A3: refuses a payload that is not a JSON object, after the signature", async () => {
    const head = b64({ alg: "RS256", kid: "rsa-1" });
    const body = b64("[1,2]");
    const sig = sign("sha256", Buffer.from(`${head}.${body}`), rsa.privateKey).toString("base64url");
    expect(await code(`${head}.${body}.${sig}`)).toBe("malformed");
  });

  it("A4: refuses alg none", async () => {
    const token = `${b64({ alg: "none" })}.${b64(claims())}.`;
    expect(await code(token)).toBe("malformed");
    expect(await code(`${token}AA`)).toBe("algorithm");
  });

  it("A4: refuses HS256 keyed with the public key", async () => {
    const head = b64({ alg: "HS256", kid: "rsa-1" });
    const body = b64(claims());
    const secret = rsa.publicKey.export({ format: "pem", type: "spki" });
    const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
    expect(await code(`${head}.${body}.${sig}`)).toBe("algorithm");
  });

  it("A4: refuses an asymmetric algorithm other than the pinned one", async () => {
    expect(await code(signToken(claims(), { alg: "ES256", kid: "ec-1", key: ec.privateKey }))).toBe("algorithm");
    expect(await code(signToken(claims(), { alg: "PS256" }))).toBe("algorithm");
  });

  it("A4: refuses a critical header extension", async () => {
    expect(await code(signToken(claims(), { header: { crit: ["exp"] } }))).toBe("algorithm");
  });

  it("A5: refuses a key outside the JWKS, an unknown kid and a changed byte", async () => {
    expect(await code(signToken(claims(), { key: otherRsa.privateKey }))).toBe("signature");
    expect(await code(signToken(claims(), { kid: "rsa-unknown" }))).toBe("key");
    const token = signToken(claims());
    const [h, p, s] = token.split(".") as [string, string, string];
    const tamperedPayload = b64({ ...claims(), sub: "demo-sub-b" });
    expect(await code(`${h}.${tamperedPayload}.${s}`)).toBe("signature");
    const flipped = Buffer.from(s, "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(await code(`${h}.${p}.${flipped.toString("base64url")}`)).toBe("signature");
  });

  it("A5: an EC key never verifies an RS256 header that names it", async () => {
    expect(await code(signToken(claims(), { kid: "ec-1" }))).toBe("key");
  });

  it.each([
    ["another issuer", "http://localhost:8091"],
    ["a trailing slash", `${ISSUER}/`],
    ["another spelling of the host", "http://LOCALHOST:8090"],
    ["missing", undefined],
  ])("A6: refuses iss as %s", async (_, iss) => {
    expect(await code(signToken(claims({ iss })))).toBe("issuer");
  });

  it.each([
    ["another string", "other-client", "audience"],
    ["an array without the client", ["other-client"], "audience"],
    ["an empty array", [], "audience"],
    ["an array with the client alone", [CLIENT], "ok"],
    ["several audiences without azp", [CLIENT, "other-client"], "audience"],
    ["missing", undefined, "audience"],
  ])("A7: aud as %s", async (_, aud, expected) => {
    expect(await code(signToken(claims({ aud })))).toBe(expected);
  });

  it("A7: several audiences pass only when azp is the client", async () => {
    expect(await code(signToken(claims({ aud: [CLIENT, "other-client"], azp: CLIENT })))).toBe("ok");
  });

  it.each([
    ["missing", undefined],
    ["a string", String(NOW)],
    ["ahead beyond skew", NOW + 31],
    ["older than the window", NOW - MAX_TOKEN_AGE_SECONDS - 31],
  ])("A8: refuses iat %s", async (_, iat) => {
    expect(await code(signToken(claims({ iat })))).toBe("iat");
  });

  it("A8: accepts iat within skew and within the window", async () => {
    expect(await code(signToken(claims({ iat: NOW + 30 })))).toBe("ok");
    expect(await code(signToken(claims({ iat: NOW - MAX_TOKEN_AGE_SECONDS })))).toBe("ok");
  });

  it("A9: refuses an expired exp and a future nbf", async () => {
    expect(await code(signToken(claims({ exp: NOW - 31 })))).toBe("exp");
    expect(await code(signToken(claims({ exp: "later" })))).toBe("exp");
    expect(await code(signToken(claims({ exp: NOW + 120 })))).toBe("ok");
    expect(await code(signToken(claims({ nbf: NOW + 31 })))).toBe("nbf");
  });

  it.each([
    ["missing", undefined],
    ["a string", BACKCHANNEL_LOGOUT_EVENT],
    ["an array", [BACKCHANNEL_LOGOUT_EVENT]],
    ["without the member", { "http://schemas.openid.net/event/other": {} }],
    ["with a member that is not an object", { [BACKCHANNEL_LOGOUT_EVENT]: true }],
    ["with a member that is an array", { [BACKCHANNEL_LOGOUT_EVENT]: [] }],
  ])("A10: refuses events %s", async (_, events) => {
    expect(await code(signToken(claims({ events })))).toBe("events");
  });

  it("A11: refuses a token with neither sub nor sid, accepts either alone", async () => {
    expect(await code(signToken(claims({ sub: undefined, sid: undefined })))).toBe("subject");
    await expect(verifyLogoutToken(signToken(claims({ sid: undefined })), CHECKS, keys)).resolves.toMatchObject({ sid: null });
    await expect(verifyLogoutToken(signToken(claims({ sub: undefined })), CHECKS, keys)).resolves.toMatchObject({ sub: null });
  });

  it("A12: refuses a nonce", async () => {
    expect(await code(signToken(claims({ nonce: "demo-nonce" })))).toBe("nonce");
  });

  it.each([
    ["missing", undefined],
    ["a number", 7],
    ["empty", ""],
    ["too long", "j".repeat(256)],
  ])("A13: refuses jti %s", async (_, jti) => {
    expect(await code(signToken(claims({ jti })))).toBe("jti");
  });

  it.each([
    ["a number", 7],
    ["empty", ""],
    ["too long", "s".repeat(256)],
    ["with a control character", "demo\u0000sid"],
    ["with a zero-width character", "demo​sid"],
    ["null", null],
  ])("A14: refuses sub and sid %s", async (_, value) => {
    expect(await code(signToken(claims({ sub: value })))).toBe("subject");
    expect(await code(signToken(claims({ sid: value })))).toBe("subject");
  });

  it("A15: refuses an ID token sent as a logout token", async () => {
    const idToken = claims({ events: undefined, nonce: "demo-nonce", jti: undefined, exp: NOW + 300 });
    expect(await code(signToken(idToken))).toBe("events");
  });
});

describe("selectKey", () => {
  it("needs a kid when more than one key fits", () => {
    const two = [jwk(rsa.publicKey, "a"), jwk(otherRsa.publicKey, "b")];
    expect(selectKey(two, undefined, "RS256")).toBeUndefined();
    expect(selectKey([jwk(rsa.publicKey, "a")], undefined, "RS256")).toBeDefined();
  });

  it("skips encryption keys, other algorithms and keys without verify", () => {
    expect(selectKey([jwk(rsa.publicKey, "a", { use: "enc" })], "a", "RS256")).toBeUndefined();
    expect(selectKey([jwk(rsa.publicKey, "a", { alg: "PS256" })], "a", "RS256")).toBeUndefined();
    expect(selectKey([jwk(rsa.publicKey, "a", { key_ops: ["encrypt"] })], "a", "RS256")).toBeUndefined();
    expect(selectKey([jwk(ec.publicKey, "a")], "a", "EdDSA")).toBeUndefined();
  });

  it("ignores private members of a key", () => {
    const leaked = { ...rsa.privateKey.export({ format: "jwk" }), kid: "a" };
    expect(selectKey([leaked], "a", "RS256")?.type).toBe("public");
  });

  it("ignores members that are not keys", () => {
    expect(selectKey([null, "x", [1], { kty: "RSA", kid: "a" }], "a", "RS256")).toBeUndefined();
  });
});

describe("createCachedKeySource (G3, G4)", () => {
  it("fetches once, then at most once per refresh interval for unknown kids", async () => {
    let now = 0;
    let loads = 0;
    const source = createCachedKeySource({
      load: async () => {
        loads++;
        return JWKS;
      },
      minRefreshSeconds: 60,
      nowMs: () => now,
    });
    expect(await source.key("rsa-1", "RS256")).toBeDefined();
    for (let i = 0; i < 20; i++) expect(await source.key(`unknown-${i}`, "RS256")).toBeUndefined();
    expect(loads).toBe(1);
    now = 61_000;
    expect(await source.key("unknown", "RS256")).toBeUndefined();
    expect(loads).toBe(2);
  });

  it("shares one fetch between concurrent requests", async () => {
    let loads = 0;
    const source = createCachedKeySource({
      load: async () => {
        loads++;
        await new Promise((resolve) => setImmediate(resolve));
        return JWKS;
      },
    });
    await Promise.all(Array.from({ length: 10 }, () => source.key("rsa-1", "RS256")));
    expect(loads).toBe(1);
  });

  it("an unreachable provider is not asked again within the interval", async () => {
    let now = 0;
    let loads = 0;
    const source = createCachedKeySource({
      load: async () => {
        loads++;
        throw new Error("provider down");
      },
      nowMs: () => now,
    });
    await expect(source.key("rsa-1", "RS256")).rejects.toThrow();
    await expect(source.key("rsa-1", "RS256")).rejects.toThrow();
    expect(loads).toBe(1);
    now = 61_000;
    await expect(source.key("rsa-1", "RS256")).rejects.toThrow();
    expect(loads).toBe(2);
  });

  it("finds a rotated key after the interval", async () => {
    let now = 0;
    let current = [jwk(otherRsa.publicKey, "old")];
    const source = createCachedKeySource({ load: async () => current, nowMs: () => now });
    expect(await source.key("rsa-1", "RS256")).toBeUndefined();
    current = JWKS;
    now = 61_000;
    expect(await source.key("rsa-1", "RS256")).toBeDefined();
  });
});
