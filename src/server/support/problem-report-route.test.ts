import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalizeJcs } from "@/domain/forensics/jcs";
import { PROBLEM_REPORT_DESCRIPTION_MAX } from "@/domain/support/problem-report";
import { withActor as appWithActor } from "@/server/db";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

vi.mock("@/server/db", () => ({ withActor: vi.fn() }));

const { MAX_PROBLEM_REPORT_BODY_BYTES, handleProblemReport } = await import("./problem-report-route");
const { POST } = await import("../../../app/api/support/problem-report/route");

const ORIGIN = "http://localhost:3000";
const TOKEN = "A".repeat(43);
// Invented text standing in for a student's work; it must never reach the database or a log.
const CANARY = "kanarinac-rad-7f3d Prvi odlomak rada o regionalnoj politici";
const REFERENCE = "PR-0A1B2C3D4E";
const VALID = {
  appVersion: "1.4.0+0a1b2c3",
  browser: { family: "firefox", major: 132 },
  category: "technical",
  description: "Gumb za predaju ne reagira nakon spremanja.",
  route: "/rad/[assignmentId]/predaja",
  syncState: "SYNCING",
};
const SQL = "SELECT identity.submit_problem_report($1, $2, $3, $4, $5, $6::smallint, $7) AS reference";

function request(value: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/support/problem-report`, {
    method: "POST",
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    body: typeof value === "string" ? value : canonicalizeJcs(value),
  });
}

function port({ code, rows = [{ reference: REFERENCE }], token = TOKEN }:
  { code?: string; rows?: Record<string, unknown>[]; token?: string } = {}) {
  type Query = (sql: string, params?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
  const query = vi.fn<Query>(async () => {
    if (code) throw Object.assign(new Error(`do not leak ${CANARY}`), { code });
    return { rows, rowCount: rows.length };
  });
  const withActor = vi.fn(async (
    _token: string | null | undefined,
    fn: (tx: ActorTransaction) => Promise<unknown>,
  ) => fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
  return { deps: { withActor, expectedOrigin: ORIGIN, sessionToken: token }, withActor, query };
}

async function call(value: unknown, options: Parameters<typeof port>[0] = {}, headers: Record<string, string> = {}) {
  const p = port(options);
  const res = await handleProblemReport(request(value, headers), p.deps);
  expect(res.headers.get("cache-control")).toBe("no-store");
  return { res, json: await res.json() as Record<string, unknown>, ...p };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("DAN-431 problem report API: success", () => {
  it("sends the closed classes through one parameterized RPC and answers only the reference", async () => {
    const { res, json, withActor, query } = await call(VALID);
    expect(res.status).toBe(201);
    expect(json).toEqual({ reference: REFERENCE });
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(SQL, [
      "technical", VALID.description, "/rad/[assignmentId]/predaja", "1.4.0+0a1b2c3", "firefox", 132, "SYNCING",
    ]);
  });

  it("no route, no browser version and no sync state go as null", async () => {
    const { res, query } = await call({ ...VALID, browser: { family: "other", major: null }, route: null, syncState: null });
    expect(res.status).toBe(201);
    expect(query.mock.calls[0]?.[1]).toEqual(["technical", VALID.description, null, "1.4.0+0a1b2c3", "other", null, null]);
  });

  it("the longest description the classes allow fits the body limit", async () => {
    // Four UTF-8 bytes per code point is the most a description can take.
    const description = "\u{1F600}".repeat(PROBLEM_REPORT_DESCRIPTION_MAX);
    const bytes = new TextEncoder().encode(canonicalizeJcs({ ...VALID, description })).byteLength;
    expect(bytes).toBeLessThanOrEqual(MAX_PROBLEM_REPORT_BODY_BYTES);
    const { res } = await call({ ...VALID, description });
    expect(res.status).toBe(201);
  });
});

describe("DAN-431: the text of a work has no way in", () => {
  it.each(["title", "content", "paragraphs", "journal", "text", "document", "assignmentId", "userId", "institutionId"])(
    "a key %s is refused before the database",
    async (key) => {
      const { res, json, withActor } = await call({ ...VALID, [key]: CANARY });
      expect(res.status).toBe(422);
      expect(json).toEqual({ error: "invalid_input" });
      expect(withActor).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["route", { route: `/rad/${CANARY}` }],
    ["route as a real path", { route: "/rad/11111111-1111-4111-8111-111111111111/predaja" }],
    ["app version", { appVersion: CANARY }],
    ["category", { category: CANARY }],
    ["sync state", { syncState: CANARY }],
    ["browser family", { browser: { family: CANARY, major: 1 } }],
    ["browser major as text", { browser: { family: "safari", major: CANARY } }],
    ["a key inside browser", { browser: { family: "safari", major: 1, title: CANARY } }],
    ["a nested object as description", { description: { paragraphs: [CANARY] } }],
    ["an array as description", { description: [CANARY] }],
  ])("work text in the %s is refused before the database", async (_what, change) => {
    const { res, withActor } = await call({ ...VALID, ...change });
    expect(res.status).toBe(422);
    expect(withActor).not.toHaveBeenCalled();
  });

  it("a description over the limit or with only white space is refused", async () => {
    for (const description of ["x".repeat(PROBLEM_REPORT_DESCRIPTION_MAX + 1), " \n\t ", "", "a\u202Eb"]) {
      const { res, withActor } = await call({ ...VALID, description });
      expect(res.status).toBe(422);
      expect(withActor).not.toHaveBeenCalled();
    }
  });

  it("a duplicate key, a second spelling or a non-object is refused", async () => {
    const canonical = canonicalizeJcs(VALID);
    for (const text of [
      canonical.replace('{"appVersion"', `{"description":"${CANARY}","appVersion"`),
      canonical.replace(/,"/g, ', "'),
      JSON.stringify(VALID, null, 2),
      "[]",
      "null",
      `"${CANARY}"`,
    ]) {
      const { res, withActor } = await call(text);
      expect(res.status).toBe(422);
      expect(withActor).not.toHaveBeenCalled();
    }
  });
});

describe("DAN-431: the request is checked before the body and the database", () => {
  it.each([
    ["no origin", { origin: "" }, 403, "origin_missing"],
    ["a foreign origin", { origin: "https://evil.example" }, 403, "origin_mismatch"],
    ["a same-site request", { "sec-fetch-site": "same-site" }, 403, "cross_site"],
    ["a form post", { "content-type": "application/x-www-form-urlencoded" }, 415, "unsupported_media_type"],
  ] as const)("%s is refused", async (_what, headers, status, error) => {
    const { res, json, withActor } = await call(VALID, {}, headers);
    expect(res.status).toBe(status);
    expect(json).toEqual({ error });
    expect(withActor).not.toHaveBeenCalled();
  });

  it("a missing or malformed session token is 401 and the body is not read", async () => {
    for (const token of [undefined, "", "A".repeat(42), `${"A".repeat(42)}=`]) {
      const p = port();
      const req = request(VALID);
      const res = await handleProblemReport(req, { ...p.deps, sessionToken: token });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
      expect(req.bodyUsed).toBe(false);
      expect(p.withActor).not.toHaveBeenCalled();
    }
  });

  it("GET is 405", async () => {
    const p = port();
    const res = await handleProblemReport(new Request(`${ORIGIN}/api/support/problem-report`, {
      headers: { origin: ORIGIN },
    }), p.deps);
    expect(res.status).toBe(405);
  });

  it("a body over the limit is 413, invalid UTF-8 or a BOM is 400", async () => {
    const big = await call({ ...VALID, description: "x".repeat(MAX_PROBLEM_REPORT_BODY_BYTES) });
    expect(big.res.status).toBe(413);
    expect(big.withActor).not.toHaveBeenCalled();
    for (const text of ["\uFEFF" + canonicalizeJcs(VALID), "{"]) {
      const { res, withActor } = await call(text);
      expect(res.status).toBe(400);
      expect(withActor).not.toHaveBeenCalled();
    }
    const p = port();
    const bytes = new Uint8Array([0x7b, 0xff, 0x7d]);
    const res = await handleProblemReport(new Request(`${ORIGIN}/api/support/problem-report`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: new Blob([bytes]),
    }), p.deps);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("a misconfigured expected origin is 503, not a match", async () => {
    const p = port();
    const res = await handleProblemReport(request(VALID), { ...p.deps, expectedOrigin: "not a url" });
    expect(res.status).toBe(503);
    expect(p.withActor).not.toHaveBeenCalled();
  });
});

describe("DAN-431: database answers", () => {
  it.each([
    ["ZD401", 401, { error: "unauthorized" }],
    ["ZD422", 422, { error: "invalid_input" }],
    ["ZD429", 429, { error: "too_many_reports" }],
    ["ZD500", 503, { error: "unavailable" }],
    ["ZD503", 503, { error: "unavailable" }],
    ["40001", 503, { error: "unavailable" }],
  ] as const)("%s is %i", async (code, status, payload) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, json } = await call(VALID, { code });
    expect(res.status).toBe(status);
    expect(json).toEqual(payload);
  });

  it("a log line carries one closed code, never the description, the message or a value", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await call({ ...VALID, description: CANARY }, { code: "40001" });
    await call({ ...VALID, description: CANARY }, { code: "not a sqlstate" });
    await call({ ...VALID, description: CANARY }, { rows: [{ reference: CANARY }] });
    expect(error.mock.calls).toEqual([
      ["problem report failed", "40001"],
      ["problem report failed", "unknown"],
      ["problem report failed", "row_malformed"],
    ]);
  });

  it.each([
    ["no row", []],
    ["two rows", [{ reference: REFERENCE }, { reference: "PR-1111111111" }]],
    ["a lower-case reference", [{ reference: "pr-0a1b2c3d4e" }]],
    ["a null reference", [{ reference: null }]],
  ])("%s is 503", async (_what, rows) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, json } = await call(VALID, { rows });
    expect(res.status).toBe(503);
    expect(json).toEqual({ error: "unavailable" });
  });
});

describe("DAN-431: the real POST route wires the configured origin and the cookie", () => {
  const CALLBACK = `${ORIGIN}/api/auth/callback`;
  const routeRequest = (headers: Record<string, string> = {}) => new NextRequest(request(VALID, {
    cookie: `__Host-ductus_session=${TOKEN}`,
    host: "evil.example",
    "x-forwarded-host": "evil.example",
    ...headers,
  }));
  const wire = () => {
    const p = port();
    vi.mocked(appWithActor).mockImplementation(p.withActor);
    return p;
  };

  it("without a configured callback origin it is 503 and nothing is read", async () => {
    const { withActor } = wire();
    for (const callback of ["", "invalid", "file:///tmp/callback"]) {
      vi.stubEnv("OIDC_REDIRECT_URI", callback);
      const req = routeRequest();
      const res = await POST(req);
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(req.bodyUsed).toBe(false);
    }
    expect(withActor).not.toHaveBeenCalled();
  });

  it("uses the callback origin, not Host, and passes the session cookie to withActor", async () => {
    const { withActor, query } = wire();
    vi.stubEnv("OIDC_REDIRECT_URI", CALLBACK);
    const res = await POST(routeRequest());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ reference: REFERENCE });
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenCalledWith(SQL, expect.any(Array));

    const forged = routeRequest({ origin: "https://evil.example" });
    expect((await POST(forged)).status).toBe(403);
    expect(forged.bodyUsed).toBe(false);
  });
});
