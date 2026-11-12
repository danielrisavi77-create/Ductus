import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const withActor = vi.fn();
vi.mock("@/server/db", () => ({ withActor: (...args: unknown[]) => withActor(...args) }));

const { NOT_CONFIGURED, deps } = vi.hoisted(() => ({
  NOT_CONFIGURED: Object.freeze({ marker: "storage-not-configured" }),
  deps: vi.fn(),
}));
vi.mock("@/server/evidence/payload-reader", () => ({ STORAGE_NOT_CONFIGURED: NOT_CONFIGURED }));
vi.mock("@/server/evidence/ingest-deps", () => ({ evidenceIngestDeps: () => deps() }));

const shutdownState = vi.hoisted(() => ({ value: "running" as "running" | "draining" | "stopped" }));
vi.mock("@/server/shutdown", () => ({ processShutdown: () => ({ state: () => shutdownState.value }) }));

const observe = vi.hoisted(() => vi.fn<(capabilities: unknown) => Promise<void>>(() => Promise.resolve()));
vi.mock("@/server/alarms/readiness-store", () => ({ readinessAlarms: { observe } }));

import { GET, dynamic, runtime } from "../../app/api/ready/route";

const SECRET = "postgres://user:pw@db.internal.example/ductus";
const productionSigner = {
  publicVerificationKey: () => Promise.reject(Object.assign(new Error("signing_key_production"), { code: "signing_key_production" })),
};

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
function database(query: Query) {
  withActor.mockImplementation(async (_token, fn) => fn({ query }));
}
const answers = (queue: string): Query => async (sql) => ({ rows: sql.includes("pg_stat_activity") ? [{ queue }] : [{}] });

beforeEach(() => {
  deps.mockReturnValue({ signer: productionSigner, payloads: NOT_CONFIGURED });
});

afterEach(() => {
  shutdownState.value = "running";
  withActor.mockReset();
  deps.mockReset();
  observe.mockClear();
  vi.restoreAllMocks();
});

// DAN-299, DAN-585: /api/ready reports each capability and does not return
// 200 without an available database.
describe("GET /api/ready", () => {
  it.each(["draining", "stopped"] as const)("answers 503 draining and runs no probe while %s (DAN-587)", async (state) => {
    shutdownState.value = state;
    database(answers("ok"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "draining" });
    expect(withActor).not.toHaveBeenCalled();
    expect(deps).not.toHaveBeenCalled();
  });

  it("answers 200 and never caches when the database answers, other capabilities not configured", async () => {
    database(answers("nije_konfigurirano"));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ready",
      capabilities: { database: "ok", storage: "nije_konfigurirano", signing: "nije_konfigurirano", queue: "nije_konfigurirano" },
    });
    for (const call of withActor.mock.calls) expect(call[0]).toBeNull();
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
  });

  it("bounds every database probe with a statement limit inside its transaction", async () => {
    const seen: Array<[string, unknown[] | undefined]> = [];
    database(async (sql, values) => {
      seen.push([sql, values]);
      return answers("ok")(sql);
    });
    await GET();
    const limits = seen.filter(([sql]) => sql.includes("statement_timeout"));
    expect(limits).toHaveLength(2);
    for (const [, values] of limits) expect(values?.[0]).toMatch(/^\d+ms$/);
  });

  it("reports every capability ok when each answers", async () => {
    database(answers("ok"));
    deps.mockReturnValue({
      signer: { publicVerificationKey: async () => ({}) },
      payloads: { verifyAll: async () => ({ a: "verified" }) },
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).capabilities).toEqual({ database: "ok", storage: "ok", signing: "ok", queue: "ok" });
  });

  it("stays 200 when only optional capabilities fail, and logs only closed codes", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    database(answers("nedostupno"));
    deps.mockReturnValue({
      signer: { publicVerificationKey: () => Promise.reject(Object.assign(new Error(SECRET), { code: "signing_key_permissions" })) },
      payloads: { verifyAll: async () => ({ a: "disabled" }) },
    });
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      status: "ready",
      capabilities: { database: "ok", storage: "nedostupno", signing: "nedostupno", queue: "nedostupno" },
    });
    expect(logged(log)).toEqual([{ event: "readiness", codes: { storage: "STORAGE_DOMAIN", signing: "signing_key_permissions", queue: "QUEUE_WORKER" } }]);
  });

  it("answers 503 with closed words and logs only a code when the database fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    withActor.mockRejectedValue(Object.assign(new Error(SECRET), { code: "ECONNREFUSED" }));
    deps.mockReturnValue({ signer: productionSigner, payloads: { verifyAll: () => Promise.reject(new Error(SECRET)) } });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      status: "unavailable",
      capabilities: { database: "nedostupno", storage: "nedostupno", signing: "nije_konfigurirano", queue: "nedostupno" },
    });
    expect(text).not.toMatch(/postgres|pw|internal|example|Error/);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/postgres|pw|internal|example/);
  });

  it("reads the queue as nedostupno, not an exception, when the catalogue refuses the read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    database(async (sql) => {
      if (sql.includes("pg_stat_activity")) throw Object.assign(new Error(SECRET), { code: "42501" });
      return { rows: [{}] };
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).capabilities.queue).toBe("nedostupno");
    expect(logged(log)).toEqual([{ event: "readiness", codes: { queue: "42501" } }]);
  });

  it("never borrows more than one connection per database probe while probes hang", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, "error").mockImplementation(() => {});
      // withActor takes no signal: a probe past its limit keeps its connection
      // until the pool's own query limit. Model that with probes that hang.
      const releases: Array<() => void> = [];
      withActor.mockImplementation(
        (_token, fn) =>
          new Promise((resolve, reject) => {
            releases.push(() => fn({ query: answers("ok") }).then(resolve, reject));
          }),
      );
      for (let call = 0; call < 5; call += 1) {
        const response = GET();
        await vi.advanceTimersByTimeAsync(3_000);
        const body = await (await response).json();
        expect(body.capabilities.database).toBe("nedostupno");
        expect(body.capabilities.queue).toBe("nedostupno");
      }
      // One database probe and one queue probe, not one of each per call.
      expect(withActor).toHaveBeenCalledTimes(2);
      for (const release of releases) release();
      await vi.advanceTimersByTimeAsync(0);
      // Once they settle, the next call probes afresh and gets the answer.
      const next = GET();
      await vi.advanceTimersByTimeAsync(0);
      expect(withActor).toHaveBeenCalledTimes(4);
      for (const release of releases.slice(2)) release();
      const body = await (await next).json();
      expect(body.capabilities).toMatchObject({ database: "ok", queue: "ok" });
    } finally {
      vi.useRealTimers();
    }
  });

  // DAN-184: the alarm channel sees each report and never shapes the answer.
  it("hands the report to the alarms and answers the same when their write hangs", async () => {
    database(answers("ok"));
    observe.mockImplementation(() => new Promise(() => {}));
    deps.mockReturnValue({ signer: productionSigner, payloads: {} });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls[0]?.[0]).toEqual(body.capabilities);
    expect(JSON.stringify(observe.mock.calls)).not.toContain("STORAGE");
  });

  it("does not wait for or rethrow a failed alarm write", async () => {
    database(answers("ok"));
    observe.mockImplementation(() => Promise.reject(new Error(SECRET)));
    const response = await GET();
    expect(response.status).toBe(200);
  });

  it("raises no alarm while draining", async () => {
    shutdownState.value = "draining";
    await GET();
    expect(observe).not.toHaveBeenCalled();
  });

  it("refuses storage that is not the router rather than guessing", async () => {
    database(answers("ok"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    deps.mockReturnValue({ signer: productionSigner, payloads: {} });
    const body = await (await GET()).json();
    expect(body.capabilities.storage).toBe("nedostupno");
  });
});

// One redacted JSON line per call (DAN-586): the event and its closed codes.
function logged(log: { mock: { calls: unknown[][] } }): Array<{ event: unknown; codes: unknown }> {
  return log.mock.calls.map(([line]) => {
    const parsed = JSON.parse(String(line)) as { event: unknown; fields: { codes: unknown } };
    return { event: parsed.event, codes: parsed.fields.codes };
  });
}
