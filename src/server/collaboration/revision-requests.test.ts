import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalizeJcs } from "@/domain/forensics/jcs";
import { withActor as appWithActor } from "@/server/db";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

// B5/D4/D6: loading the old status model anywhere under this boundary fails the import.
vi.mock("@/domain/collaboration/conditional-validity", () => {
  throw new Error("revision boundary loaded conditional-validity");
});
vi.mock("@/domain/collaboration/revision-request", () => {
  throw new Error("revision boundary loaded revision-request");
});
vi.mock("@/server/db", () => ({ withActor: vi.fn() }));

const { MAX_REVISION_BODY_BYTES, REVISION_ACTIONS, handleRevisionRequest } = await import("./revision-requests");
const { POST } = await import("../../../app/api/revision-requests/[action]/route");
type Action = (typeof REVISION_ACTIONS)[number];

const ORIGIN = "http://localhost:3000";
const TOKEN = "A".repeat(43);
const REQ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC = "doc-student-a-1";
const CANARY = "kanarinac-dorada-5e2b";
const HASH = "0123456789abcdef".repeat(4);
const ANCHOR = {
  endHint: 10,
  nodeId: "11111111-1111-4111-8111-111111111111",
  prefix: "",
  quote: `${CANARY}-sidro`,
  startHint: 0,
  suffix: "",
};
const VALID: Record<Action, Record<string, unknown>> = {
  create: { anchor: ANCHOR, documentId: DOC, instruction: `Nastavnik N1: ${CANARY}`, requestedRevision: 3 },
  respond: { expectedSeq: 2, explanation: `Student A: ${CANARY}`, kind: "done", requestId: REQ, responseRevision: 4 },
  accept: { acceptedRevision: 4, expectedSeq: 3, rangeHash: HASH, requestId: REQ },
  reopen: { expectedSeq: 3, instruction: `Nastavnik N1: ${CANARY}`, requestId: REQ, requestedRevision: 5 },
  withdraw: { expectedSeq: 2, requestId: REQ },
  list: { documentId: DOC },
};
const TRANSITION_ROW = { outcome: "applied", row_seq: "7", version: 1, state: "responded" };
const CREATE_ROW = { request_id: REQ, row_seq: "1", version: 1, state: "open" };
const OPENED = new Date("2026-11-06T10:00:00Z");
const LIST_ROW = {
  request_id: REQ,
  request_state: "accepted",
  request_version: 1,
  request_row_seq: "4",
  anchor: ANCHOR,
  version: 1,
  instruction: "Nastavnik N1: pojasni uvod.",
  requested_revision: "3",
  opened_is_own: false,
  opened_window: OPENED,
  response_kind: "done",
  response_explanation: "Student A: uvod je dopunjen.",
  response_revision: "4",
  response_is_own: true,
  response_window: OPENED,
  closed_as: "accepted",
  closed_is_own: false,
  closed_window: OPENED,
  accepted_revision: "4",
  accepted_range_hash: HASH,
};
const OPEN_ROW = {
  ...LIST_ROW,
  request_state: "open",
  request_row_seq: "1",
  response_kind: null,
  response_explanation: null,
  response_revision: null,
  response_is_own: null,
  response_window: null,
  closed_as: null,
  closed_is_own: null,
  closed_window: null,
  accepted_revision: null,
  accepted_range_hash: null,
};

function without(value: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));
}

function body(value: unknown): string {
  return typeof value === "string" ? value : canonicalizeJcs(value);
}

function request(value: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/revision-requests`, {
    method: "POST",
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    body: value instanceof Uint8Array ? new Blob([value as Uint8Array<ArrayBuffer>]) : body(value),
  });
}

function rowsFor(action: Action) {
  if (action === "create") return [CREATE_ROW];
  if (action === "list") return [LIST_ROW, OPEN_ROW];
  return [TRANSITION_ROW];
}

function port({ code, rows, token = TOKEN }: { code?: string; rows?: Record<string, unknown>[]; token?: string } = {}) {
  type Query = (sql: string, params?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
  const query = vi.fn<Query>(async () => {
    if (code) throw Object.assign(new Error(`do not leak ${CANARY}`), { code });
    return { rows: rows ?? [TRANSITION_ROW], rowCount: (rows ?? [TRANSITION_ROW]).length };
  });
  const withActor = vi.fn(async (
    _token: string | null | undefined,
    fn: (tx: ActorTransaction) => Promise<unknown>,
  ) => fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
  return { deps: { withActor, expectedOrigin: ORIGIN, sessionToken: token }, withActor, query };
}

async function call(action: Action, value: unknown, options: Parameters<typeof port>[0] = {}) {
  const p = port({ rows: rowsFor(action), ...options });
  const res = await handleRevisionRequest(action, request(value), p.deps);
  expect(res.headers.get("cache-control")).toBe("no-store");
  return { res, json: await res.json() as Record<string, unknown>, ...p };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("DAN-314 2f revision request API: success", () => {
  it("creates through one parameterized RPC; the anchor goes as jsonb, no identity", async () => {
    const { res, json, withActor, query } = await call("create", VALID.create);
    expect(res.status).toBe(200);
    expect(json).toEqual({ request_id: REQ, row_seq: 1, version: 1, state: "open" });
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenCalledWith(
      "SELECT request_id, row_seq, version, state FROM collaboration.create_revision_request($1, $2::jsonb, $3, $4::bigint)",
      [DOC, JSON.stringify(ANCHOR), VALID.create.instruction, 3],
    );
  });

  it.each([
    ["respond", "respond_revision_request($1::uuid, $2::bigint, $3, $4, $5::bigint)", [REQ, 2, "done", VALID.respond.explanation, 4]],
    ["accept", "accept_revision_request($1::uuid, $2::bigint, $3::bigint, $4)", [REQ, 3, 4, HASH]],
    ["reopen", "reopen_revision_request($1::uuid, $2::bigint, $3, $4::bigint)", [REQ, 3, VALID.reopen.instruction, 5]],
    ["withdraw", "withdraw_revision_request($1::uuid, $2::bigint)", [REQ, 2]],
  ] as const)("%s: applied is 200 with the current counter", async (action, fn, params) => {
    const { res, json, query } = await call(action, VALID[action]);
    expect(res.status).toBe(200);
    expect(json).toEqual({ outcome: "applied", row_seq: 7, version: 1, state: "responded" });
    expect(query).toHaveBeenCalledWith(`SELECT outcome, row_seq, version, state FROM collaboration.${fn}`, params);
  });

  it("accept takes a null hash, and the key is required", async () => {
    const ok = await call("accept", { ...VALID.accept, rangeHash: null });
    expect(ok.res.status).toBe(200);
    expect(ok.query.mock.calls[0]?.[1]).toEqual([REQ, 3, 4, null]);
    expect((await call("accept", without(VALID.accept, "rangeHash"))).res.status).toBe(422);
  });

  it("list returns the same keys for every row and parses bigint strings (H4)", async () => {
    const own = { ...LIST_ROW, opened_is_own: true, response_is_own: false, closed_is_own: true };
    const { res, json, query } = await call("list", VALID.list, { rows: [LIST_ROW, OPEN_ROW, own] });
    expect(res.status).toBe(200);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM collaboration.list_revision_requests($1)"), [DOC]);
    const requests = json.requests as Record<string, unknown>[];
    expect(requests).toHaveLength(3);
    const keys = Object.keys(requests[0] ?? {}).sort();
    expect(keys).toEqual(Object.keys(LIST_ROW).sort());
    for (const row of requests) expect(Object.keys(row).sort()).toEqual(keys);
    expect(requests[0]).toMatchObject({
      request_row_seq: 4, requested_revision: 3, response_revision: 4, accepted_revision: 4,
      opened_window: OPENED.toISOString(), anchor: ANCHOR,
    });
    expect(requests[1]).toMatchObject({ response_kind: null, closed_as: null, accepted_revision: null });
  });

  it("an empty list is 200 with no rows", async () => {
    const { res, json } = await call("list", VALID.list, { rows: [] });
    expect(res.status).toBe(200);
    expect(json).toEqual({ requests: [] });
  });
});

describe("DAN-314 2f: conflict is an outcome, not_allowed an error", () => {
  it.each(["respond", "accept", "reopen", "withdraw"] as const)("%s: a stale counter is 409 with the current row", async (action) => {
    const { res, json } = await call(action, VALID[action], {
      rows: [{ outcome: "conflict", row_seq: "9", version: 2, state: "reopened" }],
    });
    expect(res.status).toBe(409);
    expect(json).toEqual({ outcome: "conflict", row_seq: 9, version: 2, state: "reopened" });
  });

  it.each(REVISION_ACTIONS)("%s: ZD409 is 409 not_allowed, never {error: conflict}", async (action) => {
    const { res, json } = await call(action, VALID[action], { code: "ZD409" });
    expect(res.status).toBe(409);
    expect(json).toEqual({ error: "not_allowed" });
  });
});

describe("DAN-314 2f: RPC codes (classes 1 to 5 and 11)", () => {
  it.each([
    ["ZD401", 401, { error: "unauthorized" }],
    ["ZD403", 403, { error: "forbidden" }],
    ["ZD422", 422, { error: "invalid_input" }],
    ["40001", 503, { error: "unavailable" }],
    ["XX000", 503, { error: "unavailable" }],
  ] as const)("%s is %i with a closed body", async (code, status, payload) => {
    for (const action of REVISION_ACTIONS) {
      const { res, json } = await call(action, VALID[action], { code });
      expect(res.status).toBe(status);
      expect(json).toEqual(payload);
    }
  });

  it("no cookie or a malformed token is 401 before the database (class 1)", async () => {
    for (const token of ["", "A".repeat(42), `${"A".repeat(42)}=`, `${"A".repeat(43)} `]) {
      const { res, json, withActor } = await call("list", VALID.list, { token });
      expect(res.status).toBe(401);
      expect(json).toEqual({ error: "unauthorized" });
      expect(withActor).not.toHaveBeenCalled();
    }
    const p = port();
    const res = await handleRevisionRequest("list", request(VALID.list), { ...p.deps, sessionToken: undefined });
    expect(res.status).toBe(401);
    expect(p.withActor).not.toHaveBeenCalled();
  });
});

describe("DAN-314 2f: refusals before the database", () => {
  async function refused(action: Action, value: unknown, status: number, error: string) {
    const { res, json, withActor } = await call(action, value);
    expect(res.status, JSON.stringify(value)).toBe(status);
    expect(json).toEqual({ error });
    expect(withActor).not.toHaveBeenCalled();
  }

  it("origin, method, content-type, size and JSON", async () => {
    const { deps, withActor } = port();
    const cross = await handleRevisionRequest("list", request(VALID.list, { origin: "https://evil.example" }), deps);
    expect(cross.status).toBe(403);
    expect(await cross.json()).toEqual({ error: "origin_mismatch" });
    const site = await handleRevisionRequest("list", request(VALID.list, { "sec-fetch-site": "same-site" }), deps);
    expect(site.status).toBe(403);
    const get = await handleRevisionRequest("list", new Request(`${ORIGIN}/api/revision-requests`, {
      method: "GET", headers: { origin: ORIGIN },
    }), deps);
    expect(get.status).toBe(405);
    expect((await handleRevisionRequest("list", request(VALID.list, { "content-type": "text/plain" }), deps)).status).toBe(415);
    const huge = { ...VALID.create, instruction: "x".repeat(MAX_REVISION_BODY_BYTES) };
    expect((await handleRevisionRequest("create", request(huge), deps)).status).toBe(413);
    for (const bad of ["{oops", "", `{"documentId":"${DOC}"`]) {
      const res = await handleRevisionRequest("list", request(bad), deps);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_json" });
    }
    const latin1 = new Uint8Array([...new TextEncoder().encode('{"documentId":"doc-'), 0xe8, 0x22, 0x7d]);
    expect((await handleRevisionRequest("list", request(latin1), deps)).status).toBe(400);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(body(VALID.list))]);
    expect((await handleRevisionRequest("list", request(bom), deps)).status).toBe(400);
    expect(withActor).not.toHaveBeenCalled();
  });

  it("the body is exact JCS bytes: duplicate key, spacing, 1.0, 1e0, -0 and escapes are 422 (G5)", async () => {
    const canonical = body(VALID.withdraw);
    for (const bad of [
      `{"expectedSeq":2,"expectedSeq":2,"requestId":"${REQ}"}`,
      `{"expectedSeq":9,"expectedSeq":2,"requestId":"${REQ}"}`,
      `{"expectedSeq":2,"requestId":"${REQ}","requestId":"${REQ}"}`,
      `{"requestId":"${REQ}","expectedSeq":2}`,
      `{"expectedSeq": 2,"requestId":"${REQ}"}`,
      `${canonical}\n`,
      ` ${canonical}`,
      canonical.replace(":2,", ":2.0,"),
      canonical.replace(":2,", ":2e0,"),
      canonical.replace(":2,", ":0.2e1,"),
      canonical.replace('"requestId"', '"request\\u0049d"'),
      canonical.replace("aaaa-4aaa", "aaaa\\u002d4aaa"),
    ]) {
      await refused("withdraw", bad, 422, "invalid_input");
    }
    await refused("respond", body(VALID.respond).replace(":4}", ":-0}"), 422, "invalid_input");
  });

  it("not an object, a missing key, an unknown key and a key of another action are 422 (class 9)", async () => {
    for (const bad of ["[]", "null", "1", '"x"', "true", "{}", `[${body(VALID.list)}]`]) {
      await refused("list", bad, 422, "invalid_input");
    }
    for (const action of REVISION_ACTIONS) {
      for (const key of Object.keys(VALID[action])) {
        await refused(action, without(VALID[action], key), 422, "invalid_input");
      }
      for (const extra of ["state", "status", "accepted_by", "__proto__", "actor", "institutionId", "role", "row_seq"]) {
        await refused(action, { ...VALID[action], [extra]: "open" }, 422, "invalid_input");
      }
    }
    await refused("withdraw", { ...VALID.withdraw, kind: "done" }, 422, "invalid_input");
    await refused("list", { ...VALID.list, requestId: REQ }, 422, "invalid_input");
    await refused("respond", VALID.reopen, 422, "invalid_input");
    await refused("reopen", VALID.create, 422, "invalid_input");
    await refused("create", { ...VALID.create, requestId: REQ }, 422, "invalid_input");
    // JSON.parse makes "__proto__" an own key; JCS keeps it, the key set refuses it.
    await refused("list", `{"__proto__":{"x":1},"documentId":"${DOC}"}`, 422, "invalid_input");
  });

  it("a malformed id is 403 like a foreign one, before the database (G7)", async () => {
    for (const bad of [1, null, true, REQ.toUpperCase(), ` ${REQ}`, `${REQ} `, `{${REQ}}`, REQ.replace(/-/g, ""), "", "x"]) {
      await refused("withdraw", { ...VALID.withdraw, requestId: bad }, 403, "forbidden");
      await refused("respond", { ...VALID.respond, requestId: bad }, 403, "forbidden");
    }
    for (const bad of [1, null, "", " doc", "doc\u0000x", "doc\u0007x", "doc\u007fx", ["doc"], { a: 1 }]) {
      await refused("list", { documentId: bad }, 403, "forbidden");
      await refused("create", { ...VALID.create, documentId: bad }, 403, "forbidden");
    }
    // Structure is checked before the id: an extra key still answers 422.
    await refused("withdraw", { expectedSeq: 2, requestId: "x", state: "open" }, 422, "invalid_input");
    // The id is checked before the values: a bad counter with a bad id answers 403.
    await refused("withdraw", { expectedSeq: 0, requestId: "x" }, 403, "forbidden");
  });

  it("the counter is a safe integer from 1 (class 6)", async () => {
    for (const bad of [null, 0, "3", "", 3.5, -1, 2 ** 53, true, [], {}]) {
      for (const action of ["respond", "accept", "reopen", "withdraw"] as const) {
        await refused(action, { ...VALID[action], expectedSeq: bad }, 422, "invalid_input");
      }
    }
    const ok = await call("withdraw", { ...VALID.withdraw, expectedSeq: 2 ** 53 - 1 });
    expect(ok.res.status).toBe(200);
  });

  it("a revision is a safe integer from 0 (class 7)", async () => {
    const fields = [["create", "requestedRevision"], ["respond", "responseRevision"], ["accept", "acceptedRevision"],
      ["reopen", "requestedRevision"]] as const;
    for (const [action, field] of fields) {
      for (const bad of ["3", 3.5, -1, 2 ** 53, null, true]) {
        await refused(action, { ...VALID[action], [field]: bad }, 422, "invalid_input");
      }
      expect((await call(action, { ...VALID[action], [field]: 0 })).res.status).toBe(200);
    }
  });

  it("text follows is_revision_text in instruction and explanation (class 8)", async () => {
    const bad = ["", "   ", "\u00A0", "\u200B", "Dora\u0301", "x".repeat(2001), "a\u0000b", "a\u0007b", "a\u007fb",
      "a\u202Eb", "a\u2066b", 1, null];
    for (const text of bad) {
      await refused("create", { ...VALID.create, instruction: text }, 422, "invalid_input");
      await refused("reopen", { ...VALID.reopen, instruction: text }, 422, "invalid_input");
      await refused("respond", { ...VALID.respond, explanation: text }, 422, "invalid_input");
    }
    // A lone surrogate cannot be canonical JCS, so it never reaches the validator.
    await refused("create", body(VALID.create).replace(CANARY, "\\ud800"), 422, "invalid_input");
    for (const text of ["x", "x".repeat(2000), "<b>oznaka</b>", "**naglasi**", "red\nred\tkraj"]) {
      expect((await call("create", { ...VALID.create, instruction: text })).res.status).toBe(200);
    }
  });

  it("kind and hash (class 9 values)", async () => {
    for (const kind of ["Done", "accepted", "", null]) {
      await refused("respond", { ...VALID.respond, kind }, 422, "invalid_input");
    }
    expect((await call("respond", { ...VALID.respond, kind: "declined" })).res.status).toBe(200);
    for (const rangeHash of [HASH.toUpperCase(), HASH.slice(1), `${HASH}0`, "", 1]) {
      await refused("accept", { ...VALID.accept, rangeHash }, 422, "invalid_input");
    }
  });

  it("the anchor shape is exact (class 10, G8)", async () => {
    const short = without(ANCHOR, "quote");
    for (const anchor of [null, [], "x", short, { ...ANCHOR, extra: 1 }, { ...ANCHOR, startHint: -1 },
      { ...ANCHOR, startHint: 10, endHint: 10 }, { ...ANCHOR, startHint: 11, endHint: 10 }, { ...ANCHOR, quote: "" }]) {
      await refused("create", { ...VALID.create, anchor }, 422, "invalid_input");
    }
  });
});

describe("DAN-314 2f: rows of the wrong shape are 503", () => {
  it.each([
    ["no row", []],
    ["two rows", [TRANSITION_ROW, TRANSITION_ROW]],
    ["row_seq as number", [{ ...TRANSITION_ROW, row_seq: 7 }]],
    ["row_seq 0", [{ ...TRANSITION_ROW, row_seq: "0" }]],
    ["row_seq with a leading zero", [{ ...TRANSITION_ROW, row_seq: "07" }]],
    ["row_seq past 2^53", [{ ...TRANSITION_ROW, row_seq: "9007199254740992" }]],
    ["row_seq negative", [{ ...TRANSITION_ROW, row_seq: "-1" }]],
    ["row_seq with a space", [{ ...TRANSITION_ROW, row_seq: " 7" }]],
    ["version 0", [{ ...TRANSITION_ROW, version: 0 }]],
    ["version 1001", [{ ...TRANSITION_ROW, version: 1001 }]],
    ["unknown state", [{ ...TRANSITION_ROW, state: "closed" }]],
    ["unknown outcome", [{ ...TRANSITION_ROW, outcome: "error" }]],
  ])("transition: %s", async (_name, rows) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, json } = await call("withdraw", VALID.withdraw, { rows });
    expect(res.status).toBe(503);
    expect(json).toEqual({ error: "unavailable" });
    expect(error).toHaveBeenCalledWith("revision request failed", "withdraw", "row_malformed");
  });

  it("create: a request id that is not canonical is 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { res } = await call("create", VALID.create, { rows: [{ ...CREATE_ROW, request_id: REQ.toUpperCase() }] });
    expect(res.status).toBe(503);
  });

  it.each([
    ["anchor is an array", { anchor: [] }],
    ["anchor is a string", { anchor: "x" }],
    ["window is a string", { opened_window: "2026-11-06" }],
    ["invalid date", { opened_window: new Date(Number.NaN) }],
    ["half a response", { response_kind: null }],
    ["half a closing", { closed_window: null }],
    ["accepted revision without accepted", { closed_as: "withdrawn", accepted_range_hash: null }],
    ["accepted without revision", { accepted_revision: null }],
    ["hash in upper case", { accepted_range_hash: HASH.toUpperCase() }],
    ["is_own as string", { opened_is_own: "false" }],
    ["requested_revision as number", { requested_revision: 3 }],
    ["missing column", { instruction: undefined }],
  ])("list: %s", async (_name, change) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { res } = await call("list", VALID.list, { rows: [OPEN_ROW, { ...LIST_ROW, ...change }] });
    expect(res.status).toBe(503);
  });

  it("list: a hash outside acceptance is 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const row = { ...OPEN_ROW, accepted_range_hash: HASH };
    expect((await call("list", VALID.list, { rows: [row] })).res.status).toBe(503);
  });
});

describe("DAN-314 2f: H3 nothing of the request reaches a log or a body", () => {
  it("canary text, anchor and ids stay out of console.error and every response", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: string[] = [];
    for (const code of ["ZD401", "ZD403", "ZD409", "ZD422", "40001", "XX000", "not-a-sqlstate", undefined]) {
      for (const action of REVISION_ACTIONS) {
        const p = port(code ? { code } : { rows: [{ outcome: "?" }] });
        const res = await handleRevisionRequest(action, request(VALID[action]), p.deps);
        seen.push(await res.text());
      }
    }
    for (const action of REVISION_ACTIONS) {
      const { json } = await call(action, { ...VALID[action], extra: CANARY });
      seen.push(JSON.stringify(json));
    }
    const logged = JSON.stringify([error.mock.calls, log.mock.calls, warn.mock.calls]);
    for (const secret of [CANARY, REQ, DOC, HASH, TOKEN, "do not leak"]) {
      expect(logged).not.toContain(secret);
      for (const text of seen) expect(text).not.toContain(secret);
    }
    for (const args of error.mock.calls) {
      expect(args).toHaveLength(3);
      expect(args[0]).toBe("revision request failed");
      expect(REVISION_ACTIONS).toContain(args[1]);
      expect(String(args[2])).toMatch(/^([0-9A-Z]{5}|unknown|row_malformed)$/);
    }
    expect(error).toHaveBeenCalledWith("revision request failed", "list", "unknown");
    expect(error).toHaveBeenCalledWith("revision request failed", "list", "40001");
  });
});

describe("DAN-314 2f: B5/D4/D6 the boundary does not know the old status model", () => {
  it("no import of the collaboration index, revision-request or conditional-validity", () => {
    for (const file of ["./revision-requests.ts", "../../domain/collaboration/revision-input.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/from\s+["'][^"']*conditional-validity["']/);
      expect(source).not.toMatch(/from\s+["'][^"']*revision-request["']/);
      expect(source).not.toMatch(/from\s+["']@\/domain\/collaboration["']/);
      expect(source).not.toMatch(/from\s+["']\.\.?\/?(index)?["']/);
    }
  });
});

describe("DAN-314 2f: the real POST route wires action, configured origin and cookie", () => {
  const CALLBACK = `${ORIGIN}/api/auth/callback`;
  const routeRequest = (value: unknown, headers: Record<string, string> = {}) => new NextRequest(request(value, {
    cookie: `__Host-ductus_session=${TOKEN}`,
    host: "evil.example",
    "x-forwarded-host": "evil.example",
    ...headers,
  }));
  const context = (action: string) => ({ params: Promise.resolve({ action }) });
  const wire = () => {
    const p = port({ rows: rowsFor("list") });
    vi.mocked(appWithActor).mockImplementation(p.withActor);
    return p;
  };

  it("an unknown action is 404 before the origin, the body or the database", async () => {
    const { withActor } = wire();
    vi.stubEnv("OIDC_REDIRECT_URI", CALLBACK);
    for (const action of ["nepoznato", "List", "list ", "__proto__", "constructor", ""]) {
      const req = routeRequest(VALID.list);
      const res = await POST(req, context(action));
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: "not_found" });
      expect(req.bodyUsed).toBe(false);
    }
    expect(withActor).not.toHaveBeenCalled();
  });

  it("without a configured callback origin every action is 503 and nothing is read", async () => {
    const { withActor } = wire();
    for (const callback of ["", "invalid", "file:///tmp/callback"]) {
      vi.stubEnv("OIDC_REDIRECT_URI", callback);
      for (const action of REVISION_ACTIONS) {
        const req = routeRequest(VALID[action]);
        const res = await POST(req, context(action));
        expect(res.status).toBe(503);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(await res.json()).toEqual({ error: "unavailable" });
        expect(req.bodyUsed).toBe(false);
      }
    }
    expect(withActor).not.toHaveBeenCalled();
  });

  it("uses the callback origin, not Host, and passes the session cookie to withActor", async () => {
    const { withActor, query } = wire();
    vi.stubEnv("OIDC_REDIRECT_URI", CALLBACK);
    const res = await POST(routeRequest(VALID.list), context("list"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    // The accepted request is counted as session activity (DAN-296): a second
    // transaction that only touches the session.
    expect(withActor).toHaveBeenCalledTimes(2);
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("list_revision_requests"), [DOC]);
    expect(query).toHaveBeenLastCalledWith("SELECT identity.touch_current_session() AS touched");

    const forged = routeRequest(VALID.list, { origin: "https://evil.example" });
    expect((await POST(forged, context("list"))).status).toBe(403);
    expect(forged.bodyUsed).toBe(false);

    vi.stubEnv("OIDC_REDIRECT_URI", "http://localhost:4000/api/auth/callback");
    const moved = routeRequest(VALID.list);
    expect((await POST(moved, context("list"))).status).toBe(403);
    expect(moved.bodyUsed).toBe(false);
    expect(withActor).toHaveBeenCalledTimes(2);
  });

  it("only the __Host- session cookie is the token", async () => {
    const { withActor } = wire();
    vi.stubEnv("OIDC_REDIRECT_URI", CALLBACK);
    const res = await POST(routeRequest(VALID.list, { cookie: `ductus_session=${TOKEN}` }), context("list"));
    expect(res.status).toBe(401);
    expect(withActor).not.toHaveBeenCalled();
  });
});
