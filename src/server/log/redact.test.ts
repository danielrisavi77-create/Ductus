import { describe, expect, it } from "vitest";

import { basic, CANARY, DIGIT_TAIL_TOKEN, inventedJwt, jsonPair, pair, SHORT, SHORT_BEARER, urlWithUser } from "./invented.fixture";
import { redact } from "./redact";

// Invented values only. CANARY stands for any secret, text of a work or
// personal datum that must never reach a log line. Secret-shaped inputs are
// built at run time by invented.fixture.ts, so this source holds none.
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
    ["K4 quoted key", jsonPair("password", CANARY)],
    ["K4 quoted words under a key", new Error(`{"text":"Uvod u kanarinac povijest"}`)],
    ["K4 escaped quote in a value", jsonPair("password", 'a" b kanarinac')],
    ["K4 cookie header line", `Cookie: a=1; b=kanarinac`],
    ["K4 email in text", `sent to kanarinac.student@example.test`],
    ["K4 jwt", `id ${inventedJwt("kanarinac", "kanarinacSig0123")}`],
    ["K4 long token run", `failed for ${CANARY}`],
    // K5 URLs as text and as URL objects
    ["K5 url query", `fetch https://s3.example.test/b/o?X-Amz-Signature=${CANARY}`],
    ["K5 url userinfo", urlWithUser("postgres", "app", CANARY, "db.example.test/ductus")],
    ["K5 url fragment", `https://example.test/a#${CANARY}`],
    ["K5 URL object", new URL(`https://example.test/a?code=${CANARY}`)],
    ["K5 URL object path", { url: new URL(`https://example.test/${CANARY}`) }],
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
    // K13 hostile overrides and quoted work text
    ["K13 own toISOString", Object.assign(new Date(0), { toISOString: () => CANARY })],
    ["K13 own byteLength", Object.defineProperty(new Uint8Array(1), "byteLength", { value: CANARY })],
    ["K13 parser error snippet", new Error(`Unexpected token 'U', "Uvod rada o ${"kanarinac"}" is not valid JSON`)],
    ["K13 typographic quote", `naslov „Uvod u kanarinac rad” ostaje`],
    ["K13 Croatian keys", { lozinka: CANARY, Tekst: CANARY, sadrzaj: CANARY, prezime: CANARY, adresa: CANARY }],
    ["K13 token across the scan limit", `${"a ".repeat(495)}${CANARY}${CANARY}`],
    // K14 Codex round 2: a pair inside a harmless pair, a species array, a token cut by a digit run
    ["K14 pair inside a pair", new Error(`request: ${pair("password", "=", CANARY)}`)],
    ["K14 text inside a pair", `request: text=kanarinac`],
    ["K14 token with a digit run", { stage: DIGIT_TAIL_TOKEN }],
    // K15 Codex round 3: a container under a sensitive key in text, Digest parameters
    ["K15 array under a sensitive key", new Error(`{"text":["Uvod","kanarinac"]}`)],
    ["K15 object under a sensitive key", new Error(jsonPair("password", { value: "kanarinac" }))],
    ["K15 container after a harmless pair", `stage: [x] then ${pair("password", ": ", jsonPair("v", "kanarinac"))}`],
    ["K15 digest parameters", new Error(`request refused: Digest username="kanarinac", realm="example", nonce="abcdef1234"`)],
    // K16 Codex round 4: every shape of a value under a sensitive key in text, Croatian keys, short credentials
    ...k16Rows,
  ];

  it.each(rows)("%s never shows the canary", (_name, value) => {
    expect(leaks(value)).toBe(false);
  });

  it("drops a short secret by its key alone, where no token shape gives it away", () => {
    const short = SHORT;
    for (const value of [{ password: short }, { "X-Api-Key": short }, pair("password", "=", short), `Cookie: ${short}`, jsonPair("email", short), { lozinka: short }, { Prezime: short }, `tekst=${short}`, `request: ${pair("password", "=", short)}`, new Error(`request: text=${short}`)]) {
      expect(JSON.stringify(redact(value))).not.toContain(short);
    }
  });

  it("drops every part of a token that holds a long digit run", () => {
    const out = JSON.stringify(redact({ stage: DIGIT_TAIL_TOKEN }));
    expect(out).not.toContain("ABCDEFGHIJKLMN");
    expect(out).not.toContain("123456789");
  });

  it("builds a plain array, so an array subclass cannot bring back its own toJSON", () => {
    const short = SHORT;
    class WorkArray extends Array {
      toJSON() {
        return { password: short };
      }
    }
    const out = redact({ items: WorkArray.from(["context"]) }) as { items: unknown };
    expect(Object.getPrototypeOf(out.items)).toBe(Array.prototype);
    expect(JSON.stringify(out)).toBe('{"items":["context"]}');
  });

  it("reads a bounded number of values when one object is shared many times", () => {
    let value: unknown = { stage: "context" };
    for (let i = 0; i < 8; i += 1) value = Array(10).fill(value);
    const started = performance.now();
    const out = JSON.stringify(redact(value));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(out).toContain("[budget]");
    expect(out.split('"context"').length - 1).toBeLessThan(2000);
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

  it("keeps a UUID whose last group is all digits, and still masks a bare digit run beside it", () => {
    const id = "6f1c2b0e-3d4a-4f5b-8c6d-123456789012";
    expect(redact({ document_id: id })).toEqual({ document_id: id });
    expect(redact(`document ${id} 1234567890123`)).toBe(`document ${id} [number]`);
    expect(redact("1234567890123")).toBe("[number]");
  });

  it("keeps a quoted single word and a JSON key, and marks a scan-limited text as cut", () => {
    expect(redact('{"stage": "context"}')).toBe('{"stage": "context"}');
    expect(redact(`expected "context"`)).toBe(`expected "context"`);
    expect(redact("Digest mismatch for segment")).toBe("Digest mismatch for segment");
    expect(redact("x ".repeat(600))).toMatch(/\[cut\]$/);
  });

  it("drops a sensitive value only to the end of its line, and a quoted one only to its closing quote", () => {
    expect(redact("text: Uvod u povijest\nstage: context")).toBe("text: [redacted]\nstage: context");
    expect(redact(JSON.stringify({ password: "a b", stage: "context" }))).toBe('{"password":"[redacted]","stage":"context"}');
  });

  it("drops a short credential after Basic or Bearer, where no token shape gives it away", () => {
    for (const credential of [basic("a", "b"), SHORT_BEARER, "x"]) {
      expect(redact(`request refused: Basic ${credential}`)).toBe("request refused: Basic [redacted]");
      expect(redact(new Error(`refused: Bearer ${credential}`))).toEqual({ name: "Error", message: "refused: Bearer [redacted]" });
    }
  });

  it("never touches a number or the logger's own time, only a digit run in a string", () => {
    expect(redact({ bytes: 1234567890123, at: 1762632000000 })).toEqual({ bytes: 1234567890123, at: 1762632000000 });
    expect(redact({ stage: "oib 12345678901" })).toEqual({ stage: "oib [number]" });
  });

  it("keeps the path of a URL and drops only its secret parts", () => {
    expect(redact(`see ${urlWithUser("https", "u", "p", "s3.example.test/bucket/key?sig=1#f")}`)).toBe("see https://s3.example.test/bucket/key?[redacted]");
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

describe("invented.fixture builds the secret shapes the rows rely on", () => {
  // Without this, a helper that stopped producing a secret shape would let a
  // row pass for the wrong reason: nothing to redact instead of redaction.
  it("builds a key=value pair, a JSON pair, a URL with a user, Basic and a JWT", () => {
    expect(pair("k", "=", "v").split("=")).toEqual(["k", "v"]);
    expect(JSON.parse(jsonPair("k", 'a" b'))).toEqual({ k: 'a" b' });
    const url = new URL(urlWithUser("postgres", "app", CANARY, "db.example.test/ductus"));
    expect([url.protocol, url.username, url.password, url.host]).toEqual(["postgres:", "app", CANARY, "db.example.test"]);
    expect(basic("a", "b")).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(basic("a", "b"), "base64").toString()).toBe("a:b");
    const [header = "", claims = "", signature] = inventedJwt("kanarinac", "kanarinacSig0123").split(".");
    expect(header.startsWith("eyJ") && claims.startsWith("eyJ")).toBe(true);
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "HS256" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({ sub: "kanarinac" });
    expect(signature).toBe("kanarinacSig0123");
    expect(DIGIT_TAIL_TOKEN).toMatch(/^kanarinac[A-Z]{14}\d{9}$/);
    expect(CANARY).toMatch(/^kanarinac[A-Za-z0-9]{15}$/);
  });
});

/**
 * K16 input classes for a sensitive key's value in free text (contract
 * w586c on #1091): quoted, unquoted one word, unquoted with spaces,
 * structured, empty, spaces around the separator and a value on the next
 * line; plus Croatian letters in a key. Short credentials after a scheme have
 * their own test below, since they are shorter than the canary word.
 */
const k16Rows: Array<[string, unknown]> = [
  ["K16 quoted", new Error(`text: "Uvod u kanarinac povijest"`)],
  ["K16 single-quoted", new Error(pair("password", "=", "'a b kanarinac'"))],
  ["K16 unquoted one word", new Error(pair("password", "=", "kanarinac"))],
  ["K16 unquoted with spaces", new Error(`text: Uvod u kanarinac povijest`)],
  ["K16 unquoted password of many words", pair("password", "=", `${SHORT} kanarinac konj`)],
  ["K16 unquoted inside a harmless pair", `request: text=Uvod u kanarinac`],
  ["K16 structured", new Error(`text: [Uvod, kanarinac]`)],
  ["K16 empty then words", new Error(`text: , Uvod kanarinac`)],
  ["K16 empty then semicolon", pair("password", "=", "; kanarinac")],
  ["K16 spaces around the separator", new Error(`text   =   Uvod kanarinac`)],
  ["K16 value on the next line", new Error(`text:\n  Uvod u kanarinac povijest`)],
  ["K16 Croatian key in an object", { sadržaj: "Uvod u kanarinac", "e-pošta": "kanarinac", Naslov: "kanarinac" }],
  ["K16 Croatian key in text", new Error(`sadržaj: Uvod u kanarinac`)],
];

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
