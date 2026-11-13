import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalizeJcs } from "@/domain/forensics/jcs";
import { withActor as appWithActor } from "@/server/db";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

vi.mock("@/server/db", () => ({ withActor: vi.fn() }));

const { MAX_INTERFACE_LOCALE_BODY_BYTES, handleInterfaceLocaleGet, handleInterfaceLocalePost } =
  await import("./interface-locale-route");
const { GET, POST } = await import("../../../app/api/profile/interface-locale/route");

const ORIGIN = "http://localhost:3000";
const URL_ = `${ORIGIN}/api/profile/interface-locale`;
const TOKEN = "A".repeat(43);
// Invented values standing in for an identity someone might try to send.
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const CANARY = "kanarinac-id-5c1e";
const SET_SQL = "SELECT identity.set_interface_locale($1) AS locale";
const READ_SQL = "SELECT identity.interface_locale() AS locale";

function post(value: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_, {
    method: "POST",
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    body: typeof value === "string" ? value : canonicalizeJcs(value),
  });
}

function get(headers: Record<string, string> = {}): Request {
  return new Request(URL_, { headers: { "sec-fetch-site": "same-origin", ...headers } });
}

type Rows = Record<string, unknown>[];

function port({ code, rows, token = TOKEN }: { code?: string; rows?: Rows; token?: string } = {}) {
  type Query = (sql: string, params?: readonly unknown[]) => Promise<{ rows: Rows; rowCount: number }>;
  const query = vi.fn<Query>(async (_sql, params) => {
    if (code) throw Object.assign(new Error(`do not leak ${CANARY}`), { code });
    const out = rows ?? [{ locale: params?.[0] ?? "en" }];
    return { rows: out, rowCount: out.length };
  });
  const withActor = vi.fn(async (
    _token: string | null | undefined,
    fn: (tx: ActorTransaction) => Promise<unknown>,
  ) => fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
  return { deps: { withActor, expectedOrigin: ORIGIN, sessionToken: token }, withActor, query };
}

async function callPost(value: unknown, options: Parameters<typeof port>[0] = {}, headers: Record<string, string> = {}) {
  const p = port(options);
  const res = await handleInterfaceLocalePost(post(value, headers), p.deps);
  expect(res.headers.get("cache-control")).toBe("no-store");
  return { res, json: await res.json() as Record<string, unknown>, ...p };
}

async function callGet(options: Parameters<typeof port>[0] = {}, headers: Record<string, string> = {}) {
  const p = port(options);
  const res = await handleInterfaceLocaleGet(get(headers), p.deps);
  expect(res.headers.get("cache-control")).toBe("no-store");
  return { res, json: await res.json() as Record<string, unknown>, ...p };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("DAN-427 POST /api/profile/interface-locale", () => {
  it.each(["hr", "en"])("saves %s through one parameterized RPC and answers it", async (locale) => {
    const { res, json, withActor, query } = await callPost({ locale });
    expect(res.status).toBe(200);
    expect(json).toEqual({ locale });
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(SET_SQL, [locale]);
  });

  it.each([
    ["userId", { locale: "en", userId: OTHER_USER }],
    ["institutionId", { locale: "en", institutionId: OTHER_USER }],
    ["subject", { locale: "en", sub: CANARY }],
    ["workLanguage", { locale: "en", workLanguage: "en" }],
    ["language", { language: "en" }],
    ["no key", {}],
  ])("a body with %s is refused before the database", async (_what, body) => {
    const { res, json, withActor } = await callPost(body);
    expect(res.status).toBe(422);
    expect(json).toEqual({ error: "invalid_input" });
    expect(withActor).not.toHaveBeenCalled();
  });

  it.each(["HR", "en-GB", "de", "", " hr", 1, null, ["hr"], { value: "hr" }])(
    "locale %j is refused before the database",
    async (locale) => {
      const { res, withActor } = await callPost({ locale });
      expect(res.status).toBe(422);
      expect(withActor).not.toHaveBeenCalled();
    },
  );

  it("a duplicate key, a second spelling or a non-object is refused", async () => {
    for (const text of ['{"locale":"de","locale":"hr"}', '{"locale": "hr"}', '{ "locale":"hr"}', '{"locale":"\\u0068r"}', "[]", "null", '"hr"']) {
      const { res, withActor } = await callPost(text);
      expect(res.status).toBe(422);
      expect(withActor).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["no origin", { origin: "" }, 403, "origin_missing"],
    ["a foreign origin", { origin: "https://evil.example" }, 403, "origin_mismatch"],
    ["a same-site request", { "sec-fetch-site": "same-site" }, 403, "cross_site"],
    ["a form post", { "content-type": "application/x-www-form-urlencoded" }, 415, "unsupported_media_type"],
  ] as const)("%s is refused", async (_what, headers, status, error) => {
    const { res, json, withActor } = await callPost({ locale: "en" }, {}, headers);
    expect(res.status).toBe(status);
    expect(json).toEqual({ error });
    expect(withActor).not.toHaveBeenCalled();
  });

  it("a missing or malformed session token is 401 and the body is not read", async () => {
    for (const token of [undefined, "", "A".repeat(42), `${"A".repeat(42)}=`]) {
      const p = port();
      const req = post({ locale: "en" });
      const res = await handleInterfaceLocalePost(req, { ...p.deps, sessionToken: token });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
      expect(req.bodyUsed).toBe(false);
      expect(p.withActor).not.toHaveBeenCalled();
    }
  });

  it("a body over the limit is 413, a BOM, invalid UTF-8 or broken JSON is 400", async () => {
    const big = await callPost(`{"locale":"${"x".repeat(MAX_INTERFACE_LOCALE_BODY_BYTES)}"}`);
    expect(big.res.status).toBe(413);
    expect(big.withActor).not.toHaveBeenCalled();
    for (const text of ['﻿{"locale":"hr"}', "{"]) {
      const { res, json, withActor } = await callPost(text);
      expect(res.status).toBe(400);
      expect(json).toEqual({ error: "invalid_json" });
      expect(withActor).not.toHaveBeenCalled();
    }
    const p = port();
    const res = await handleInterfaceLocalePost(new Request(URL_, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: new Blob([new Uint8Array([0x7b, 0xff, 0x7d])]),
    }), p.deps);
    expect(res.status).toBe(400);
    expect(p.withActor).not.toHaveBeenCalled();
  });

  it("a misconfigured expected origin is 503, not a match", async () => {
    const p = port();
    const res = await handleInterfaceLocalePost(post({ locale: "en" }), { ...p.deps, expectedOrigin: "not a url" });
    expect(res.status).toBe(503);
    expect(p.withActor).not.toHaveBeenCalled();
  });

  it.each([
    ["ZD401", 401, { error: "unauthorized" }],
    ["ZD422", 422, { error: "invalid_input" }],
    ["ZD500", 503, { error: "unavailable" }],
    ["40001", 503, { error: "unavailable" }],
  ] as const)("%s is %i", async (code, status, payload) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, json } = await callPost({ locale: "hr" }, { code });
    expect(res.status).toBe(status);
    expect(json).toEqual(payload);
  });

  it.each([
    ["no row", []],
    ["two rows", [{ locale: "hr" }, { locale: "hr" }]],
    ["another value", [{ locale: "en" }]],
    ["a null value", [{ locale: null }]],
  ])("%s from the database is 503", async (_what, rows) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, json } = await callPost({ locale: "hr" }, { rows });
    expect(res.status).toBe(503);
    expect(json).toEqual({ error: "unavailable" });
  });

  it("a log line carries one closed code, never a message or a value", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await callPost({ locale: "hr" }, { code: "40001" });
    await callPost({ locale: "hr" }, { code: CANARY });
    await callPost({ locale: "hr" }, { rows: [{ locale: CANARY }] });
    expect(error.mock.calls).toEqual([
      ["interface locale failed", "40001"],
      ["interface locale failed", "unknown"],
      ["interface locale failed", "row_malformed"],
    ]);
  });
});

describe("DAN-427 GET /api/profile/interface-locale", () => {
  it.each([["hr"], ["en"], [null]])("answers the saved value %j", async (locale) => {
    const { res, json, withActor, query } = await callGet({ rows: [{ locale }] });
    expect(res.status).toBe(200);
    expect(json).toEqual({ locale });
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenCalledWith(READ_SQL, []);
  });

  it("a missing or malformed session token is 401 without the database", async () => {
    for (const token of [undefined, "", "A".repeat(42)]) {
      const p = port();
      const res = await handleInterfaceLocaleGet(get(), { ...p.deps, sessionToken: token });
      expect(res.status).toBe(401);
      expect(p.withActor).not.toHaveBeenCalled();
    }
  });

  it("a cross-site read is 403 and another method is 405", async () => {
    const cross = await callGet({}, { "sec-fetch-site": "cross-site" });
    expect(cross.res.status).toBe(403);
    expect(cross.withActor).not.toHaveBeenCalled();
    const p = port();
    const res = await handleInterfaceLocaleGet(new Request(URL_, { method: "DELETE" }), p.deps);
    expect(res.status).toBe(405);
  });

  it.each([
    ["ZD401", 401],
    ["40001", 503],
  ] as const)("%s is %i", async (code, status) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { res } = await callGet({ code });
    expect(res.status).toBe(status);
  });

  it.each([
    ["no row", []],
    ["an unknown value", [{ locale: "de" }]],
    ["a number", [{ locale: 1 }]],
  ])("%s from the database is 503", async (_what, rows) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { res } = await callGet({ rows });
    expect(res.status).toBe(503);
  });
});

describe("DAN-427: the real route wires the configured origin and the cookie", () => {
  const CALLBACK = `${ORIGIN}/api/auth/callback`;
  const wire = (rows?: Rows) => {
    const p = port({ rows });
    vi.mocked(appWithActor).mockReset().mockImplementation(p.withActor);
    return p;
  };
  const cookie = { cookie: `__Host-ductus_session=${TOKEN}`, host: "evil.example", "x-forwarded-host": "evil.example" };

  it("POST without a configured callback origin is 503 and nothing is read", async () => {
    const { withActor } = wire();
    for (const callback of ["", "invalid"]) {
      vi.stubEnv("OIDC_REDIRECT_URI", callback);
      const req = new NextRequest(post({ locale: "en" }, cookie));
      const res = await POST(req);
      expect(res.status).toBe(503);
      expect(req.bodyUsed).toBe(false);
    }
    expect(withActor).not.toHaveBeenCalled();
  });

  it("POST uses the callback origin, not Host, and the session cookie", async () => {
    const { withActor, query } = wire();
    vi.stubEnv("OIDC_REDIRECT_URI", CALLBACK);
    const res = await POST(new NextRequest(post({ locale: "en" }, cookie)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ locale: "en" });
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query.mock.calls.filter(([sql]) => sql === SET_SQL)).toEqual([[SET_SQL, ["en"]]]);

    const forged = new NextRequest(post({ locale: "en" }, { ...cookie, origin: "https://evil.example" }));
    expect((await POST(forged)).status).toBe(403);
    expect(forged.bodyUsed).toBe(false);
  });

  it("GET reads with the session cookie and does not write", async () => {
    const { withActor, query } = wire([{ locale: "hr" }]);
    const res = await GET(new NextRequest(get(cookie)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ locale: "hr" });
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query.mock.calls).toEqual([[READ_SQL, []]]);
  });

  it("GET without a session cookie is 401", async () => {
    const { withActor } = wire();
    const res = await GET(new NextRequest(get()));
    expect(res.status).toBe(401);
    expect(withActor).not.toHaveBeenCalled();
  });
});
