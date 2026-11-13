import { describe, expect, it, vi } from "vitest";

import { parsePublicStatus } from "@/lib/status/public-status";

import { type Capability, type CapabilityReport, type CapabilityStatus, checkCapabilities } from "./ready";
import { PUBLIC_STATUS_TTL_MS, publicComponents, publicStatusCache, publicStatusResponse } from "./public-status";

const report = (c: CapabilityReport["capabilities"]): CapabilityReport => ({ ready: c.database === "ok", capabilities: c, codes: {} });
const all = (s: CapabilityStatus) => report({ database: s, storage: s, signing: s, queue: s });

describe("publicComponents", () => {
  it.each<[string, CapabilityReport, ReturnType<typeof publicComponents>]>([
    ["every capability ok", all("ok"), { writing: "radi", submission: "radi", mentorView: "radi" }],
    [
      "database ok, the rest not configured",
      report({ database: "ok", storage: "nije_konfigurirano", signing: "nije_konfigurirano", queue: "nije_konfigurirano" }),
      { writing: "nije_ukljuceno", submission: "nije_ukljuceno", mentorView: "nije_ukljuceno" },
    ],
    [
      "storage down",
      report({ database: "ok", storage: "nedostupno", signing: "ok", queue: "ok" }),
      { writing: "ne_radi", submission: "ne_radi", mentorView: "ne_radi" },
    ],
    [
      "signing down, storage not configured: a failure outranks not configured",
      report({ database: "ok", storage: "nije_konfigurirano", signing: "nedostupno", queue: "ok" }),
      { writing: "ne_radi", submission: "ne_radi", mentorView: "nije_ukljuceno" },
    ],
    ["database down", all("nedostupno"), { writing: "ne_radi", submission: "ne_radi", mentorView: "ne_radi" }],
    // Only the queue down: no part shown here depends on it alone.
    ["queue down", report({ database: "ok", storage: "ok", signing: "ok", queue: "nedostupno" }), { writing: "radi", submission: "radi", mentorView: "radi" }],
    // A capability missing from the report was not checked: not "radi".
    ["nothing reported", report({}), { writing: "ne_radi", submission: "ne_radi", mentorView: "ne_radi" }],
  ])("%s", (_name, input, expected) => {
    expect(publicComponents(input)).toEqual(expected);
  });
});

// Codex P2 on #1979: with asynchronous signing (DAN-518) the worker signs every
// receipt, so writing and submission are not "radi" without the queue.
describe("publicComponents with asynchronous signing", () => {
  it.each<[string, CapabilityReport, ReturnType<typeof publicComponents>]>([
    ["every capability ok", all("ok"), { writing: "radi", submission: "radi", mentorView: "radi" }],
    ["queue down", report({ database: "ok", storage: "ok", signing: "ok", queue: "nedostupno" }), { writing: "ne_radi", submission: "ne_radi", mentorView: "radi" }],
    [
      "queue not configured",
      report({ database: "ok", storage: "ok", signing: "ok", queue: "nije_konfigurirano" }),
      { writing: "nije_ukljuceno", submission: "nije_ukljuceno", mentorView: "radi" },
    ],
    ["queue not reported", report({ database: "ok", storage: "ok", signing: "ok" }), { writing: "ne_radi", submission: "ne_radi", mentorView: "radi" }],
  ])("%s", (_name, input, expected) => {
    expect(publicComponents(input, true)).toEqual(expected);
  });

  it("the cache maps with the mode it was given", async () => {
    const queueDown = report({ database: "ok", storage: "ok", signing: "ok", queue: "nedostupno" });
    await expect(publicStatusCache(async () => queueDown, () => 0, true)()).resolves.toMatchObject({ components: { writing: "ne_radi" } });
    await expect(publicStatusCache(async () => queueDown, () => 0)()).resolves.toMatchObject({ components: { writing: "radi" } });
  });
});
// QA FAIL on #1979 (c.6861487923): the mentor fast path reads stored segments
// (readFastPath -> readProcessSummary -> readImmutable), so the mentor view is
// not "radi" while storage is not. Every storage class, both signing modes.
describe("mentorView needs storage", () => {
  it.each<[string, CapabilityReport["capabilities"], ReturnType<typeof publicComponents>["mentorView"]]>([
    ["storage ok", { database: "ok", storage: "ok", signing: "ok", queue: "ok" }, "radi"],
    ["storage down", { database: "ok", storage: "nedostupno", signing: "ok", queue: "ok" }, "ne_radi"],
    ["storage not configured", { database: "ok", storage: "nije_konfigurirano", signing: "ok", queue: "ok" }, "nije_ukljuceno"],
    ["storage not reported", { database: "ok", signing: "ok", queue: "ok" }, "ne_radi"],
  ])("%s", (_name, capabilities, expected) => {
    expect(publicComponents(report(capabilities)).mentorView).toBe(expected);
    expect(publicComponents(report(capabilities), true).mentorView).toBe(expected);
  });
});


describe("publicStatusCache", () => {
  const clock = (start = 1_000_000) => {
    let t = start;
    return { now: () => t, advance: (ms: number) => void (t += ms) };
  };

  it("answers a checked closed body with the time of the check", async () => {
    const c = clock(Date.parse("2027-03-06T13:10:00.000Z"));
    const get = publicStatusCache(async () => all("ok"), c.now);
    const body = await get();
    expect(body).toEqual({ checkedAt: "2027-03-06T13:10:00.000Z", components: { writing: "radi", submission: "radi", mentorView: "radi" } });
    expect(parsePublicStatus(JSON.parse(JSON.stringify(body)))).toEqual(body);
  });

  // Istodobnost (contract): unauthenticated traffic shares one check.
  it("runs one check for concurrent calls after the cache expires", async () => {
    const c = clock();
    // The check waits on a gate the test opens, so calls overlap for certain.
    let release: (r: CapabilityReport) => void = () => {};
    let gate = new Promise<CapabilityReport>((resolve) => (release = resolve));
    const check = vi.fn(() => gate);
    const get = publicStatusCache(check, c.now);
    const first = Promise.all([get(), get(), get()]);
    release(all("ok"));
    await first;
    expect(check).toHaveBeenCalledTimes(1);

    c.advance(PUBLIC_STATUS_TTL_MS - 1);
    await get();
    expect(check).toHaveBeenCalledTimes(1);

    c.advance(1);
    gate = new Promise<CapabilityReport>((resolve) => (release = resolve));
    const burst = Promise.all(Array.from({ length: 20 }, () => get()));
    // A call arriving while the check runs joins it.
    c.advance(5);
    const late = get();
    release(all("nedostupno"));
    const answers = await Promise.all([burst, late]).then(([b, l]) => [...b, l]);
    expect(check).toHaveBeenCalledTimes(2);
    expect(new Set(answers.map((a) => a.components.mentorView))).toEqual(new Set(["ne_radi"]));
  });

  it("does not keep a failed check: the next call checks again", async () => {
    const c = clock();
    const check = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue(all("ok"));
    const get = publicStatusCache(check, c.now);
    await expect(get()).rejects.toThrow();
    await expect(get()).resolves.toMatchObject({ components: { writing: "radi" } });
    expect(check).toHaveBeenCalledTimes(2);
  });
});

describe("publicStatusResponse", () => {
  const body = { checkedAt: "2027-03-06T13:10:00.000Z", components: { writing: "radi", submission: "radi", mentorView: "radi" } } as const;

  it("answers the closed body, never cached", async () => {
    const response = await publicStatusResponse(async () => body, true);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(body);
  });

  it("answers 503 without a body and runs no check while shutting down", async () => {
    const get = vi.fn(async () => body);
    const response = await publicStatusResponse(get, false);
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(get).not.toHaveBeenCalled();
  });

  it("answers 503 without the error's text when the check fails", async () => {
    const response = await publicStatusResponse(() => Promise.reject(new Error("postgres://u:pw@db.internal.example")), true);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  });
});

// Orchestrator note 2 (c.6820602587): a probe that fails with a host and a
// code, through the whole chain the route uses, answers only the closed body.
describe("public status with a failing probe", () => {
  it("carries no host, code, message or timing from the failed probe", async () => {
    const leak = Object.assign(new Error("connect ECONNREFUSED postgres://u:pw@db.internal.example:5432"), { code: "ECONNREFUSED" });
    const capabilities: Capability[] = [
      { name: "database", required: true, timeoutMs: 1_000, probe: async () => { throw leak; } },
      { name: "storage", required: false, timeoutMs: 1_000, probe: async () => "ok" },
      { name: "signing", required: false, timeoutMs: 1_000, probe: () => new Promise(() => {}) },
      { name: "queue", required: false, timeoutMs: 1_000, probe: async () => "nije_konfigurirano" },
    ];
    const get = publicStatusCache(() => checkCapabilities(capabilities, 20), () => Date.parse("2026-11-12T10:25:00.000Z"));
    const response = await publicStatusResponse(get, true);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      checkedAt: "2026-11-12T10:25:00.000Z",
      components: { writing: "ne_radi", submission: "ne_radi", mentorView: "ne_radi" },
    });
    expect(text).not.toMatch(/ECONNREFUSED|TIMEOUT|ERROR|postgres|internal|5432|codes|ready|ms/);
  });
});
