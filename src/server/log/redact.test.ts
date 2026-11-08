import { describe, expect, it } from "vitest";

import { redact } from "./redact";

// Invented values only. CANARY stands for any secret, text of a work or
// personal datum that must never reach a log line.
const CANARY = "kanarinac7Qx9Lm2Pz4Rt8Vw";
const leaks = (value: unknown): boolean => JSON.stringify(redact(value)).includes("kanarinac");

describe("redact: one row per input class of the DAN-586 contract", () => {
  const rows: Array<[string, unknown]> = [
    // K1 sensitive key in every letter case and separator
    ["K1 Authorization", { Authorization: `Bearer ${CANARY}` }],
    ["K1 AUTHORIZATION", { AUTHORIZATION: CANARY }],
    ["K1 set_cookie", { set_cookie: `ductus_session=${CANARY}` }],
    ["K1 Set-Cookie array", { "Set-Cookie": [CANARY, CANARY] }],
    ["K1 sessionToken", { sessionToken: CANARY }],
    ["K1 SESSION-TOKEN", { "SESSION-TOKEN": CANARY }],
    ["K1 access_token object", { access_token: { raw: CANARY } }],
    ["K1 password", { password: CANARY }],
    ["K1 apiKey", { apiKey: CANARY }],
    ["K1 x-api-key", { "x-api-key": CANARY }],
    ["K1 privateKey", { privateKey: CANARY }],
    ["K1 idempotencyKey", { idempotencyKey: CANARY }],
    ["K1 client secret", { client_secret: CANARY }],
    // K2 text of a work and document content by key
    ["K2 text", { text: `Uvod rada ${CANARY}` }],
    ["K2 body", { body: CANARY }],
    ["K2 html", { html: `<p>${CANARY}</p>` }],
    ["K2 document", { document: { type: "doc", content: [{ text: CANARY }] } }],
    ["K2 snapshot", { Snapshot: CANARY }],
    ["K2 payload bytes", { payload: CANARY }],
    ["K2 instruction", { instruction: CANARY }],
    ["K2 anchor", { anchor: CANARY }],
    // K3 personal data by key
    ["K3 email", { email: CANARY }],
    ["K3 first_name", { first_name: CANARY }],
    ["K3 surname", { Surname: CANARY }],
    ["K3 oib", { OIB: CANARY }],
    ["K3 jmbag", { jmbag: CANARY }],
    ["K3 phone", { phoneNumber: CANARY }],
    ["K3 ip", { ip: CANARY }],
    ["K3 userAgent", { "user-agent": CANARY }],
    // K4 values in free text
    ["K4 bearer in text", `request refused: Bearer ${CANARY}`],
    ["K4 basic in text", `basic auth Basic ${CANARY}`],
    ["K4 key=value", `retry with token=${CANARY}&x=1`],
    ["K4 key: value", `cookie: ${CANARY}`],
    ["K4 quoted key", `{"password":"${CANARY}"}`],
    ["K4 email in text", `sent to kanarinac.student@example.test`],
    // Joined at run time so the secret scanner does not read an invented JWT as a real one.
    ["K4 jwt", `id ${["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJrYW5hcmluYWMifQ", "kanarinacSig0123"].join(".")}`],
    ["K4 long token run", `failed for ${CANARY}`],
    // K5 URLs as text and as URL objects
    ["K5 url query", `fetch https://s3.example.test/b/o?X-Amz-Signature=${CANARY}`],
    ["K5 url userinfo", `postgres://app:${CANARY}@db.example.test/ductus`],
    ["K5 url fragment", `https://example.test/a#${CANARY}`],
    ["K5 URL object", new URL(`https://example.test/a?code=${CANARY}`)],
    // K6 headers in every container
    ["K6 Headers", new Headers({ authorization: `Bearer ${CANARY}`, cookie: `a=${CANARY}` })],
    ["K6 Map", new Map([["Cookie", CANARY]])],
    ["K6 plain headers", { headers: { "Proxy-Authorization": CANARY, "X-Session": CANARY } }],
    // K7 errors, causes and aggregates
    ["K7 message", new Error(`could not parse ${CANARY}`)],
    ["K7 cause chain", new Error("outer", { cause: new Error("inner", { cause: { token: CANARY } }) })],
    ["K7 code", Object.assign(new Error("x"), { code: `E_${CANARY}` })],
    ["K7 aggregate", new AggregateError([new Error(`one ${CANARY}`)], "many")],
    ["K7 own field", Object.assign(new Error("x"), { password: CANARY })],
    // K8 nesting
    ["K8 nested array", { a: [{ b: [{ secret: CANARY }] }] }],
    ["K8 deep", deep(40, { token: CANARY })],
    ["K8 deep plain value", deep(40, CANARY)],
    ["K8 wide", Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${i}`, i === 79 ? CANARY : i]))],
    ["K8 wide array", Array.from({ length: 80 }, (_, i) => (i === 79 ? CANARY : i))],
    // K9 keys that carry data themselves
    ["K9 token as key", { [CANARY]: 1 }],
    ["K9 email as key", { "kanarinac@example.test": 1 }],
    ["K9 __proto__ key", JSON.parse(`{"__proto__":{"token":"${CANARY}"}}`)],
    // K10 unusual types
    ["K10 bytes", new TextEncoder().encode(CANARY)],
    ["K10 buffer", Buffer.from(CANARY)],
    ["K10 array buffer", new TextEncoder().encode(CANARY).buffer],
    ["K10 toJSON not called", { toJSON: () => CANARY }],
    ["K10 throwing getter", throwingGetter()],
    ["K10 throwing proxy", new Proxy({}, { ownKeys: () => { throw new Error(CANARY); } })],
    ["K10 function source", { f: function kanarinac() { return 1; } }],
    // K11 long free text
    ["K11 long text", `${"riječ ".repeat(60)}${CANARY}`],
    // K12 canary as a plain value under a harmless key
    ["K12 plain value", { stage: CANARY }],
  ];

  it.each(rows)("%s never shows the canary", (_name, value) => {
    expect(leaks(value)).toBe(false);
  });

  it("drops a short secret by its key alone, where no token shape gives it away", () => {
    const short = "zeleni";
    for (const value of [{ password: short }, { "X-Api-Key": short }, `password=${short}`, `Cookie: ${short}`, `{"email":"${short}"}`]) {
      expect(JSON.stringify(redact(value))).not.toContain(short);
    }
  });

  it("covers a cyclic object and a cyclic cause chain without throwing", () => {
    const a: Record<string, unknown> = { id: "a" };
    a.self = a;
    const outer = new Error("outer");
    const inner = new Error("inner", { cause: outer });
    (outer as { cause?: unknown }).cause = inner;
    expect(redact(a)).toEqual({ id: "a", self: "[cycle]" });
    expect(() => JSON.stringify(redact(outer))).not.toThrow();
    expect(JSON.stringify(redact(outer))).toContain("[cycle]");
  });
});

describe("redact keeps what an operator needs", () => {
  it("keeps closed codes, stages, numbers, booleans and UUIDs", () => {
    const id = "6f1c2b0e-3d4a-4f5b-8c6d-7e8f9a0b1c2d";
    expect(redact({ stage: "context", code: "42501", outcome: "duplicate", bytes: 1024, ok: true, document_id: id })).toEqual({
      stage: "context",
      code: "42501",
      outcome: "duplicate",
      bytes: 1024,
      ok: true,
      document_id: id,
    });
  });

  it("keeps the path of a URL and drops only its secret parts", () => {
    expect(redact("see https://u:p@s3.example.test/bucket/key?sig=1#f")).toBe("see https://s3.example.test/bucket/key?[redacted]");
  });

  it("keeps an error's name, message and code, never its stack", () => {
    const error = Object.assign(new TypeError("bad input"), { code: "ZD422" });
    expect(redact(error)).toEqual({ name: "TypeError", message: "bad input", code: "ZD422" });
  });

  it("writes NaN, Infinity, undefined, bigint and dates as valid JSON", () => {
    expect(redact({ a: NaN, b: Infinity, c: undefined, d: 10n, e: new Date(0) })).toEqual({
      a: null,
      b: null,
      c: null,
      d: "10",
      e: "1970-01-01T00:00:00.000Z",
    });
  });
});

function deep(levels: number, leaf: unknown): unknown {
  let value = leaf;
  for (let i = 0; i < levels; i += 1) value = { next: value };
  return value;
}

function throwingGetter(): object {
  const value = {};
  Object.defineProperty(value, "boom", {
    enumerable: true,
    get() {
      throw new Error(CANARY);
    },
  });
  return value;
}
