import { describe, expect, it } from "vitest";

import type { FastPathLoad } from "@/components/teacher/fast-path";
import { DEMO_FAST_PATH } from "@/lib/i18n/demo-fast-path.hr";

import { FAST_PATH_REFRESH_MS, fetchFastPath, parseFastPath, startFastPathReader } from "./fast-path";

// Invented students only (src/lib/i18n/demo-fast-path.hr.ts).
const ASSIGNMENT = "6f1c2a4e-1111-4b2c-9d3e-000000000001";
const answer = () => ({ kind: "ok", students: structuredClone(DEMO_FAST_PATH) as unknown[] });
const ok = (body: unknown = answer()) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** A clock and timers the test moves by hand, and a fetcher that answers when told. */
function harness(opts: { answerAfter?: number; respond?: () => Response | Promise<Response> } = {}) {
  let time = 0;
  let visible = true;
  const listeners = new Set<() => void>();
  const timers = new Map<number, { at: number; run: () => void }>();
  let next = 1;
  const requests: { at: number; init: RequestInit | undefined; input: unknown }[] = [];
  const pending: { at: number; resolve: (r: Response) => void }[] = [];
  const loads: FastPathLoad[] = [];
  const fetcher = ((input: unknown, init?: RequestInit) => {
    requests.push({ at: time, init, input });
    if (opts.answerAfter === undefined) return Promise.resolve(opts.respond ? opts.respond() : ok());
    return new Promise<Response>((resolve) => pending.push({ at: time + opts.answerAfter!, resolve }));
  }) as typeof fetch;
  const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
  async function advance(ms: number) {
    const end = time + ms;
    await flush();
    for (;;) {
      type Due = { id: number; at: number; run: () => void; kind: "timer" | "answer" };
      const due = [...timers.entries()].map(([id, t]): Due => ({ id, ...t, kind: "timer" }))
        .concat(pending.map((p, i) => ({ id: i, at: p.at, run: () => p.resolve(opts.respond ? (opts.respond() as Response) : ok()), kind: "answer" }) as Due))
        .filter((e) => e.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      time = Math.max(time, due.at);
      if (due.kind === "timer") timers.delete(due.id);
      else pending.splice(due.id, 1);
      due.run();
      await flush();
    }
    time = end;
    await flush();
  }
  const setVisible = async (value: boolean) => {
    visible = value;
    for (const l of listeners) l();
    await flush();
  };
  const start = (current: () => boolean = () => true) => startFastPathReader({
    assignmentId: ASSIGNMENT,
    onChange: (load) => loads.push(load),
    current,
    fetcher,
    now: () => time,
    visibility: { isVisible: () => visible, subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); } },
    timers: {
      set: (run, ms) => { const id = next++; timers.set(id, { at: time + ms, run }); return id; },
      clear: (id) => { timers.delete(id as number); },
    },
  });
  return { advance, setVisible, start, requests, loads, flush, timers };
}

describe("startFastPathReader timing (P-03)", () => {
  it("sends exactly 13 requests in an hour: one at 0 and one per five minutes", async () => {
    const h = harness();
    h.start();
    await h.advance(3_600_000);
    expect(h.requests.map((r) => r.at)).toEqual(Array.from({ length: 13 }, (_, i) => i * FAST_PATH_REFRESH_MS));
  });

  it("sends nothing before P-03 has passed since the start of the last request", async () => {
    const h = harness();
    h.start();
    await h.advance(299_999);
    expect(h.requests).toHaveLength(1);
    await h.advance(1);
    expect(h.requests).toHaveLength(2);
  });

  it("never has two requests in flight; a slow answer does not bring the next one forward", async () => {
    const h = harness({ answerAfter: 400_000 });
    h.start();
    await h.advance(399_999);
    expect(h.requests).toHaveLength(1);
    await h.advance(1);
    // The answer came after P-03 had already passed, so the next starts now, and only one.
    expect(h.requests.map((r) => r.at)).toEqual([0, 400_000]);
    await h.advance(399_999);
    expect(h.requests).toHaveLength(2);
  });

  it("a hidden tab sends nothing, however often it is shown and hidden", async () => {
    const h = harness();
    h.start();
    await h.setVisible(false);
    await h.advance(3 * FAST_PATH_REFRESH_MS);
    expect(h.requests).toHaveLength(1);
    for (let i = 0; i < 50; i += 1) {
      await h.setVisible(i % 2 === 0);
      await h.advance(1_000);
    }
    // Shown after P-03 had passed: exactly one more, and none during the toggles after it.
    expect(h.requests).toHaveLength(2);
    // The second started at 900 000 ms, when the tab was first shown again.
    expect(h.requests[1]!.at).toBe(3 * FAST_PATH_REFRESH_MS);
    await h.setVisible(true);
    await h.advance(4 * FAST_PATH_REFRESH_MS - 950_000 - 1);
    expect(h.requests).toHaveLength(2);
    await h.advance(1);
    expect(h.requests).toHaveLength(3);
  });

  it("a tab shown before P-03 waits for the rest of it", async () => {
    const h = harness();
    h.start();
    await h.advance(100_000);
    await h.setVisible(false);
    await h.advance(50_000);
    await h.setVisible(true);
    await h.advance(149_999);
    expect(h.requests).toHaveLength(1);
    await h.advance(1);
    expect(h.requests).toHaveLength(2);
  });

  it("a failure is retried only after P-03, and keeps the last state as not fresh", async () => {
    let status = 200;
    const h = harness({ respond: () => (status === 200 ? ok() : new Response("", { status })) });
    h.start();
    await h.flush();
    expect(h.loads.at(-1)).toMatchObject({ state: "ready", stale: false });
    status = 503;
    await h.advance(FAST_PATH_REFRESH_MS);
    expect(h.loads.at(-1)).toMatchObject({ state: "ready", stale: true });
    expect((h.loads.at(-1) as { students: readonly unknown[] }).students).toHaveLength(DEMO_FAST_PATH.length);
    await h.advance(FAST_PATH_REFRESH_MS - 1);
    expect(h.requests).toHaveLength(2);
    status = 200;
    await h.advance(1);
    expect(h.requests).toHaveLength(3);
    expect(h.loads.at(-1)).toMatchObject({ state: "ready", stale: false });
  });

  it("a first failure is unavailable, not an empty list", async () => {
    const h = harness({ respond: () => new Response("", { status: 500 }) });
    h.start();
    await h.flush();
    expect(h.loads.at(-1)).toEqual({ state: "unavailable" });
  });

  it("after stop nothing is sent and a late answer is not shown", async () => {
    const h = harness({ answerAfter: 10_000 });
    const stop = h.start();
    await h.advance(5_000);
    stop();
    await h.advance(3_600_000);
    expect(h.requests).toHaveLength(1);
    expect(h.loads).toEqual([]);
    expect(h.timers.size).toBe(0);
  });

  it("sends nothing once the session has ended in this browser", async () => {
    const h = harness();
    h.start(() => false);
    await h.advance(3_600_000);
    expect(h.requests).toHaveLength(0);
    expect(h.loads).toEqual([{ state: "signedOut" }]);
  });

  it("a 401 is signed out and stops the reader", async () => {
    const h = harness({ respond: () => new Response("", { status: 401 }) });
    h.start();
    await h.advance(3_600_000);
    expect(h.requests).toHaveLength(1);
    expect(h.loads).toEqual([{ state: "signedOut" }]);
  });
});

describe("fetchFastPath", () => {
  it("posts only the assignment id, same origin, uncached", async () => {
    const calls: [unknown, RequestInit | undefined][] = [];
    const read = await fetchFastPath(ASSIGNMENT, () => true, ((input: unknown, init?: RequestInit) => {
      calls.push([input, init]);
      return Promise.resolve(ok());
    }) as typeof fetch);
    expect(read.kind).toBe("ok");
    expect(calls).toHaveLength(1);
    const [input, init] = calls[0]!;
    expect(input).toBe("/api/teacher/fast-path");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" } });
    expect(JSON.parse(init!.body as string)).toEqual({ assignmentId: ASSIGNMENT });
  });

  it.each([
    [401, "signedOut"], [403, "unavailable"], [404, "unavailable"], [422, "unavailable"], [500, "unavailable"], [503, "unavailable"],
  ])("answers status %i as %s", async (status, kind) => {
    expect(await fetchFastPath(ASSIGNMENT, () => true, (() => Promise.resolve(new Response("", { status }))) as typeof fetch)).toEqual({ kind });
  });

  it("is unavailable for a 200 that is HTML, not UTF-8, or a network error", async () => {
    const html = new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
    const bytes = new Response(new Uint8Array([0x7b, 0xff, 0x7d]), { status: 200 });
    for (const response of [html, bytes]) {
      expect(await fetchFastPath(ASSIGNMENT, () => true, (() => Promise.resolve(response)) as typeof fetch)).toEqual({ kind: "unavailable" });
    }
    expect(await fetchFastPath(ASSIGNMENT, () => true, (() => Promise.reject(new TypeError("offline"))) as typeof fetch)).toEqual({ kind: "unavailable" });
  });
});

describe("parseFastPath", () => {
  it("accepts exactly the answer of #757 and keeps its order", () => {
    expect(parseFastPath(answer())).toEqual(DEMO_FAST_PATH);
    expect(parseFastPath({ kind: "ok", students: [] })).toEqual([]);
  });

  type Student = Record<string, unknown> & { record: Record<string, unknown> | null };
  const breaks: [string, (body: { kind: unknown; students: Student[] }) => void][] = [
    ["another kind", (b) => { b.kind = "error"; }],
    ["an extra root key", (b) => { Object.assign(b, { more: 1 }); }],
    ["students not a list", (b) => { (b as { students: unknown }).students = {}; }],
    ["an extra student key", (b) => { b.students[0]!.email = "ana@example.test"; }],
    ["a missing student key", (b) => { delete b.students[0]!.lastChangeAt; }],
    ["an empty id", (b) => { b.students[0]!.id = ""; }],
    ["a repeated id", (b) => { b.students[1]!.id = b.students[0]!.id; }],
    ["a revision state (#757 O2)", (b) => { b.students[0]!.work = "revision_requested"; }],
    ["half a name (D1)", (b) => { b.students[0]!.givenName = null; }],
    ["an empty surname", (b) => { b.students[0]!.surname = ""; }],
    ["a time not on a whole minute", (b) => { b.students[0]!.lastChangeAt = "2026-10-16T19:05:30.000Z"; }],
    ["a record before the notice", (b) => { b.students.find((s) => s.work === "notice_pending")!.record = structuredClone(b.students[0]!.record); }],
    ["a declaration field (#757 O3)", (b) => { b.students[0]!.record!.declaration = "submitted"; }],
    ["pastes as a list", (b) => { b.students[0]!.record!.pastesWithoutSource = [1]; }],
    ["negative pastes", (b) => { b.students[0]!.record!.pastesWithoutSource = -1; }],
    ["fractional pastes", (b) => { b.students[0]!.record!.pastesWithoutSource = 1.5; }],
    ["another block kind", (b) => { (b.students[0]!.record!.blocks as Record<string, unknown>[])[0]!.kind = "quote"; }],
    ["a broken summary", (b) => { (b.students[0]!.record!.summary as Record<string, unknown>).summaryFormat = "v2"; }],
  ];

  it.each(breaks)("rejects the whole answer for %s", (_, change) => {
    const body = answer() as unknown as { kind: unknown; students: Student[] };
    change(body);
    expect(parseFastPath(body)).toBeNull();
  });

  it("rejects what is not an object", () => {
    for (const value of [null, [], "ok", 1]) expect(parseFastPath(value)).toBeNull();
  });
});
