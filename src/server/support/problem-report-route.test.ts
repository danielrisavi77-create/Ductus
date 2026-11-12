import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalizeJcs } from "@/domain/forensics/jcs";
import {
  BROWSER_FAMILIES,
  PROBLEM_REPORT_CATEGORIES,
  PROBLEM_REPORT_DESCRIPTION_MAX,
  PROBLEM_REPORT_ROUTES,
} from "@/domain/support/problem-report";
import { SYNC_STATES } from "@/domain/sync/states";
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
const SQL = "SELECT identity.submit_problem_report($1, $2, $3, $4, $5, $6::integer, $7) AS reference";

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

describe("DAN-431: the 8 KiB body limit holds every valid report and nothing larger (#1836 c.6812033683)", () => {
  const CALLBACK = `${ORIGIN}/api/auth/callback`;
  const FOUR = "\u{1F600}"; // four UTF-8 bytes, one code point
  const longest = <T extends string>(set: readonly T[]): T =>
    set.reduce((a, b) => (b.length > a.length ? b : a));
  const utf8 = (text: string) => new TextEncoder().encode(text);

  // The largest context every closed class allows.
  const MAX_CONTEXT = {
    appVersion: `9999.9999.9999+${"f".repeat(40)}`,
    // `null` is one byte longer than the largest major version, 999.
    browser: { family: longest(BROWSER_FAMILIES), major: null },
    category: longest(PROBLEM_REPORT_CATEGORIES),
    route: longest(PROBLEM_REPORT_ROUTES),
    syncState: longest(SYNC_STATES),
  };
  const EMPTY_CONTEXT = {
    appVersion: "0a1b2c3",
    browser: { family: "other", major: null },
    category: "technical",
    route: null,
    syncState: null,
  };
  const LONGEST_DESCRIPTION = FOUR.repeat(PROBLEM_REPORT_DESCRIPTION_MAX);

  /** A canonical body of exactly `size` bytes whose description ends in `tail`. */
  function sized(size: number, tail: "four-byte" | "ascii"): string {
    const base = utf8(canonicalizeJcs({ ...MAX_CONTEXT, description: "" })).byteLength;
    const need = size - base;
    const description = tail === "ascii" ? "x".repeat(need) : "x".repeat(need % 4) + FOUR.repeat(Math.floor(need / 4));
    const text = canonicalizeJcs({ ...MAX_CONTEXT, description });
    expect(utf8(text).byteLength).toBe(size);
    return text;
  }

  // The decided limit as a literal, so the boundary cases do not move with the constant.
  const MAX = 8192;
  const CASES = [
    ["the largest valid report: 1000 four-byte characters and the largest context",
      () => canonicalizeJcs({ ...MAX_CONTEXT, description: LONGEST_DESCRIPTION }), 201, { reference: REFERENCE }],
    ["the longest description with an empty context",
      () => canonicalizeJcs({ ...EMPTY_CONTEXT, description: LONGEST_DESCRIPTION }), 201, { reference: REFERENCE }],
    ["exactly 8 KiB ending in a four-byte character passes the limit, then fails the classes",
      () => sized(MAX, "four-byte"), 422, { error: "invalid_input" }],
    ["one byte over 8 KiB ending in a four-byte character",
      () => sized(MAX + 1, "four-byte"), 413, { error: "body_too_large" }],
    ["one byte over 8 KiB in ASCII",
      () => sized(MAX + 1, "ascii"), 413, { error: "body_too_large" }],
  ] as const;

  /** The same bytes with a declared length, or streamed in chunks with none. */
  function send(text: string, mode: "declared" | "streamed"): Request {
    const bytes = utf8(text);
    const headers: Record<string, string> = {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      cookie: `__Host-ductus_session=${TOKEN}`,
    };
    if (mode === "declared") {
      return new Request(`${ORIGIN}/api/support/problem-report`, {
        method: "POST",
        headers: { ...headers, "content-length": String(bytes.byteLength) },
        body: bytes,
      });
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // Uneven chunks split four-byte characters across reads.
        for (let i = 0; i < bytes.byteLength; i += 1023) controller.enqueue(bytes.slice(i, i + 1023));
        controller.close();
      },
    });
    return new Request(`${ORIGIN}/api/support/problem-report`, {
      method: "POST", headers, body, duplex: "half",
    } as RequestInit & { duplex: "half" });
  }

  it("8 KiB is needed: the largest valid report is over 4 KiB and within the limit", () => {
    const bytes = utf8(canonicalizeJcs({ ...MAX_CONTEXT, description: LONGEST_DESCRIPTION })).byteLength;
    expect(MAX_PROBLEM_REPORT_BODY_BYTES).toBe(MAX);
    expect(bytes).toBeGreaterThan(4096);
    expect(bytes).toBeLessThanOrEqual(MAX);
  });

  for (const mode of ["declared", "streamed"] as const) {
    it.each(CASES)(`%s (${mode}, handler)`, async (_what, body, status, json) => {
      const p = port();
      const res = await handleProblemReport(send(body(), mode), p.deps);
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual(json);
      expect(p.withActor).toHaveBeenCalledTimes(status === 201 ? 1 : 0);
    });

    it.each(CASES)(`%s (${mode}, POST route)`, async (_what, body, status, json) => {
      const p = port();
      vi.mocked(appWithActor).mockReset().mockImplementation(p.withActor);
      vi.stubEnv("OIDC_REDIRECT_URI", CALLBACK);
      const res = await POST(new NextRequest(send(body(), mode)));
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual(json);
      // The activity touch is a second withActor; the report RPC runs only for a valid report.
      const rpc = p.query.mock.calls.filter(([sql]) => sql === SQL);
      expect(rpc).toHaveLength(status === 201 ? 1 : 0);
      if (status !== 201) expect(p.withActor).not.toHaveBeenCalled();
      if (status === 201) expect(rpc[0]?.[1]?.[1]).toBe(LONGEST_DESCRIPTION);
    });
  }
});
