import { describe, expect, it, vi } from "vitest";

import {
  CAPABILITY_TIMEOUT_MS,
  READY_TIMEOUT_MS,
  checkCapabilities,
  classifyQueue,
  classifyStorage,
  signingOutcome,
  singleFlight,
  type Capability,
  type CapabilityName,
  type Probe,
} from "@/server/ready";

// DAN-585 (M11.3-P01): readiness per capability, each with its own time
// limit. Classes of input per capability: success, error, timeout, not
// configured. The table below runs every combination of the four.
const NAMES: readonly CapabilityName[] = ["database", "storage", "signing", "queue"];
type Kind = "ok" | "error" | "timeout" | "not_configured";
const KINDS: readonly Kind[] = ["ok", "error", "timeout", "not_configured"];
const SECRET = "postgres://user:pw@db.internal.example/ductus";
const LIMIT = 25;

const neverAnswers: Probe = () => new Promise(() => {});

// Every way a probe can fail, all of which must read "nedostupno".
const FAILURES: ReadonlyArray<[string, Probe]> = [
  ["rejects with a coded error", () => Promise.reject(Object.assign(new Error(SECRET), { code: "ECONNREFUSED" }))],
  ["rejects with a URL in the message", () => Promise.reject(new TypeError(`Invalid URL: ${SECRET}`))],
  ["rejects with a non-Error", () => Promise.reject(SECRET)],
  ["throws synchronously", () => { throw new Error(SECRET); }],
  ["resolves with an unknown value", async () => "ready" as never],
  ["resolves with nothing", async () => undefined as never],
  ["never answers", neverAnswers],
  ["answers after the limit", () => new Promise((resolve) => setTimeout(() => resolve("ok"), LIMIT * 4))],
];

function probeOf(kind: Kind): Probe {
  if (kind === "ok") return async () => "ok";
  if (kind === "not_configured") return async () => "nije_konfigurirano";
  if (kind === "timeout") return neverAnswers;
  return () => Promise.reject(Object.assign(new Error(SECRET), { code: "ECONNREFUSED" }));
}

function capabilities(kinds: readonly Kind[]): Capability[] {
  return NAMES.map((name, i) => ({ name, required: name === "database", timeoutMs: LIMIT, probe: probeOf(kinds[i]) }));
}

const EXPECTED: Record<Kind, string> = { ok: "ok", error: "nedostupno", timeout: "nedostupno", not_configured: "nije_konfigurirano" };

const COMBINATIONS: Kind[][] = [];
for (const a of KINDS) for (const b of KINDS) for (const c of KINDS) for (const d of KINDS) COMBINATIONS.push([a, b, c, d]);

describe("checkCapabilities", () => {
  it("covers every combination of the four capabilities", () => {
    expect(COMBINATIONS).toHaveLength(256);
  });

  it("reports each capability and refuses only when the required one is not ok, for all 256 combinations", async () => {
    const reports = await Promise.all(COMBINATIONS.map((kinds) => checkCapabilities(capabilities(kinds), LIMIT * 2)));
    reports.forEach((report, i) => {
      const kinds = COMBINATIONS[i];
      expect(report.capabilities).toEqual(Object.fromEntries(NAMES.map((name, j) => [name, EXPECTED[kinds[j]]])));
      expect(report.ready).toBe(kinds[0] === "ok");
      expect(JSON.stringify(report)).not.toMatch(/postgres|pw|internal|example|Error/);
    });
  });

  it.each(FAILURES)("reads nedostupno when the probe %s", async (_name, probe) => {
    const report = await checkCapabilities([{ name: "storage", required: false, timeoutMs: LIMIT, probe }], LIMIT * 2);
    expect(report.capabilities).toEqual({ storage: "nedostupno" });
    expect(report.ready).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/postgres|pw|internal|example/);
  });

  it("refuses when a required capability is not configured", async () => {
    const report = await checkCapabilities([{ name: "database", required: true, timeoutMs: LIMIT, probe: probeOf("not_configured") }]);
    expect(report).toMatchObject({ ready: false, capabilities: { database: "nije_konfigurirano" } });
  });

  it("keeps only closed codes for the log, never the message", async () => {
    const report = await checkCapabilities(capabilities(["error", "timeout", "ok", "error"]), LIMIT * 2);
    expect(report.codes).toEqual({ database: "ECONNREFUSED", storage: "TIMEOUT", queue: "ECONNREFUSED" });
    const odd = await checkCapabilities(
      [{ name: "queue", required: false, timeoutMs: LIMIT, probe: () => Promise.reject(Object.assign(new Error("x"), { code: SECRET })) }],
    );
    expect(odd.codes).toEqual({ queue: "ERROR" });
  });

  it("stops at the total limit even when a capability allows longer", async () => {
    const started = Date.now();
    const report = await checkCapabilities(
      NAMES.map((name) => ({ name, required: name === "database", timeoutMs: 60_000, probe: neverAnswers })),
      LIMIT,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(report.ready).toBe(false);
  });

  it("gives every capability a limit inside the total, and the total stays short", () => {
    expect(READY_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
    for (const name of NAMES) {
      expect(CAPABILITY_TIMEOUT_MS[name]).toBeGreaterThan(0);
      expect(CAPABILITY_TIMEOUT_MS[name]).toBeLessThanOrEqual(READY_TIMEOUT_MS);
    }
  });

  it("aborts the signal a hanging probe was given, so it can let go of its connection", async () => {
    let seen: AbortSignal | undefined;
    await checkCapabilities([{ name: "database", required: true, timeoutMs: LIMIT, probe: (signal) => { seen = signal; return neverAnswers(signal); } }]);
    expect(seen?.aborted).toBe(true);
  });
});

// Istodobnost: concurrent calls share no result and leave no connection open.
describe("concurrent readiness calls", () => {
  it("each call gets its own outcome", async () => {
    const reports = await Promise.all(
      Array.from({ length: 50 }, (_, i) => checkCapabilities(capabilities([i % 3 === 0 ? "ok" : i % 3 === 1 ? "error" : "timeout", "ok", "ok", "ok"]), LIMIT * 2)),
    );
    expect(reports.map((r) => r.ready)).toEqual(Array.from({ length: 50 }, (_, i) => i % 3 === 0));
  });

  it("a hanging probe holds no connection once the call has answered", async () => {
    let open = 0;
    let most = 0;
    const holding: Probe = (signal) =>
      new Promise((_, reject) => {
        open += 1;
        most = Math.max(most, open);
        signal.addEventListener("abort", () => { open -= 1; reject(signal.reason); }, { once: true });
      });
    const calls = 30;
    await Promise.all(
      Array.from({ length: calls }, () =>
        checkCapabilities(NAMES.map((name) => ({ name, required: name === "database", timeoutMs: LIMIT, probe: holding })), LIMIT * 2),
      ),
    );
    expect(open).toBe(0);
    expect(most).toBeLessThanOrEqual(calls * NAMES.length);
  });
});

describe("capability classifiers", () => {
  it.each([
    [{ queue: "ok" }, "ok"],
    [{ queue: "nije_konfigurirano" }, "nije_konfigurirano"],
    [{ queue: "nedostupno" }, "throws"],
    [{ queue: "OK" }, "throws"],
    [{ queue: null }, "throws"],
    [{}, "throws"],
    [undefined, "throws"],
  ])("queue row %j reads %s", (row, expected) => {
    if (expected === "throws") expect(() => classifyQueue(row)).toThrow();
    else expect(classifyQueue(row)).toBe(expected);
  });

  it.each([
    ["not_configured" as const, "nije_konfigurirano"],
    [{}, "nije_konfigurirano"],
    [{ a: "verified" }, "ok"],
    [{ a: "verified", b: "verified" }, "ok"],
    [{ a: "verified", b: "unverified" }, "throws"],
    [{ a: "disabled" }, "throws"],
    [{ a: "something" }, "throws"],
  ])("storage %j reads %s", (states, expected) => {
    if (expected === "throws") expect(() => classifyStorage(states)).toThrow();
    else expect(classifyStorage(states)).toBe(expected);
  });

  it.each([
    ["signing_key_production", "nije_konfigurirano"],
    ["signing_key_not_configured", "nije_konfigurirano"],
    ["signing_key_missing", "throws"],
    ["signing_key_permissions", "throws"],
    [undefined, "throws"],
  ])("signing failure %s reads %s", async (code, expected) => {
    const error = code === undefined ? new Error(SECRET) : Object.assign(new Error(code), { code });
    const outcome = signingOutcome(() => Promise.reject(error));
    if (expected === "throws") await expect(outcome).rejects.toBe(error);
    else await expect(outcome).resolves.toBe(expected);
  });

  it("signing that answers is ok", async () => {
    await expect(signingOutcome(async () => ({}))).resolves.toBe("ok");
  });
});

describe("singleFlight", () => {
  it("shares one unsettled call and starts a new one once it settles", async () => {
    let release: (value: string) => void = () => {};
    const fn = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const once = singleFlight(fn);
    const first = once();
    const second = once();
    expect(second).toBe(first);
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
    release("a");
    await expect(first).resolves.toBe("a");
    const third = once();
    expect(third).not.toBe(first);
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(2);
    release("b");
    await expect(third).resolves.toBe("b");
  });

  it("clears after a rejection, including a synchronous throw", async () => {
    let calls = 0;
    const once = singleFlight(() => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error(SECRET), { code: "E1" });
      return Promise.resolve("ok");
    });
    await expect(once()).rejects.toMatchObject({ code: "E1" });
    await expect(once()).resolves.toBe("ok");
    expect(calls).toBe(2);
  });
});
