import { describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { ACCESS_LOG_PAGE } from "./my-access-log";
import { type AccessLogQuery, olderHref, readMyAccessLogPage } from "./my-access-log-pages";

// DAN-294 (S-42; narrowed round after review FAIL c.6819070024, contract on
// #1836 c.6819193865): "Prikaži starije dane" as a cursor in the address, one
// read per request, so every opening is reachable. Invented ids and names only.
const TOKEN = "T".repeat(43);
const DOC = "rad-izmisljeni-1";
const CANARY = "kanarinac-stranice-7a1d";
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
type Row = Record<string, unknown>;
const WINDOW = 300_000;
const START = Date.UTC(2026, 10, 10, 12);
const NOW = START + 60_000;
/** Row n of the log, n·5 minutes older than START. */
const row = (n: number, over: Row = {}): Row => ({
  entry_id: id(n), opened_at: new Date(START - n * WINDOW), surface: "live_view", reader_role: "mentor",
  reader_given_name: "Nastavnik", reader_family_name: "B", ...over,
});
const page = (from: number, length: number) => Array.from({ length }, (_, i) => row(from + i));
const ids = (days: { entries: { id: string }[] }[]) => days.flatMap((d) => d.entries.map((e) => e.id));

/** Answers the reads in turn; a string is an error with that SQLSTATE, "network" one without any. */
function database(answers: (Row[] | string)[]) {
  const calls: (readonly unknown[] | undefined)[] = [];
  const withActor = vi.fn(async (_token: string | null | undefined, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({
      async query(_text: string, values?: readonly unknown[]) {
        const answer = answers[calls.length] ?? [];
        calls.push(values);
        if (answer === "network") throw new Error(`connect ECONNRESET ${CANARY}`);
        if (typeof answer === "string") throw Object.assign(new Error(`do not leak ${CANARY}`), { code: answer });
        return { rows: answer, rowCount: answer.length };
      },
    } as unknown as ActorTransaction),
  ) as unknown as WithActor;
  return { withActor, calls };
}

/**
 * app.read_my_access_log as the migration states it (20261107180000): rows
 * older than p_before_at, the whole interval of the p_limit-th row, newest
 * first. `log` may grow between two requests.
 */
function rpc(log: Row[]) {
  const withActor = vi.fn(async (_token: string | null | undefined, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({
      async query(_text: string, values?: readonly unknown[]) {
        const [, limit, beforeAt] = values as [string, number, string | null, string | null];
        const at = (r: Row) => (r.opened_at as Date).getTime();
        const mine = log.filter((r) => beforeAt === null || at(r) < Date.parse(beforeAt));
        const top = mine.map(at).sort((a, b) => b - a).slice(0, limit);
        const edge = top.length === 0 ? Number.POSITIVE_INFINITY : top[top.length - 1];
        const rows = mine.filter((r) => at(r) >= edge)
          .sort((a, b) => at(b) - at(a) || ((a.entry_id as string) < (b.entry_id as string) ? 1 : -1));
        return { rows, rowCount: rows.length };
      },
    } as unknown as ActorTransaction),
  ) as unknown as WithActor;
  return withActor;
}

/** The query a link carries, as Next.js hands it to the page. */
function queryOf(href: string): AccessLogQuery {
  const params = new URL(href, "http://x").searchParams;
  return { prije: params.get("prije") ?? undefined, zapis: params.get("zapis") ?? undefined };
}

const HERE = "/rad/z/dnevnik-pristupa";
const AT = new Date(START - 3 * WINDOW).toISOString();

// Contract (a): every class of the cursor in the address, one table. A cursor
// that is not valid reads the first page: the query never carries it.
describe("DAN-294 access log cursor: the classes of input", () => {
  it.each([
    ["no cursor", {}, null],
    ["a valid cursor", { prije: AT, zapis: id(3) }, [AT, id(3)]],
    ["a valid cursor in another zone", { prije: "2026-11-10T12:45:00+01:00", zapis: id(3) }, [AT, id(3)]],
    ["an unknown id (a position only: the read compares opened_at)", { prije: AT, zapis: id(4242) }, [AT, id(4242)]],
    ["the current interval", { prije: new Date(START).toISOString(), zapis: id(1) }, [new Date(START).toISOString(), id(1)]],
    ["half a pair: no id", { prije: AT }, null],
    ["half a pair: no instant", { zapis: id(3) }, null],
    ["a repeated parameter", { prije: [AT, AT], zapis: id(3) }, null],
    ["an empty instant", { prije: "", zapis: id(3) }, null],
    ["garbage", { prije: "jucer", zapis: "nesto" }, null],
    ["an upper-case id", { prije: AT, zapis: id(0xabc).toUpperCase() }, null],
    ["an id not a uuid", { prije: AT, zapis: "00000000-0000-4000-8000-00000000000g" }, null],
    ["an impossible date", { prije: "2026-02-30T12:00:00Z", zapis: id(3) }, null],
    ["hour 24", { prije: "2026-11-09T24:00:00Z", zapis: id(3) }, null],
    ["microseconds", { prije: "2026-11-10T11:45:00.000001Z", zapis: id(3) }, null],
    ["milliseconds off the grid", { prije: "2026-11-10T11:45:00.001Z", zapis: id(3) }, null],
    ["off the five-minute grid", { prije: "2026-11-10T11:47:00Z", zapis: id(3) }, null],
    ["no zone", { prije: "2026-11-10T11:45:00", zapis: id(3) }, null],
    ["in the future", { prije: new Date(START + WINDOW).toISOString(), zapis: id(3) }, null],
    ["far in the future", { prije: "9999-12-31T23:55:00Z", zapis: id(3) }, null],
    ["the old page count", { stranica: "21" } as AccessLogQuery, null],
  ] as [string, AccessLogQuery, [string, string] | null][])("%s", async (_, query, cursor) => {
    const { withActor, calls } = database([page(1, 2)]);
    const read = await readMyAccessLogPage(TOKEN, withActor, DOC, query, NOW);
    expect(calls).toEqual([[DOC, ACCESS_LOG_PAGE, ...(cursor ?? [null, null])]]);
    expect(read).toMatchObject({ kind: "ok", continued: cursor !== null, next: null });
  });

  it("past the 1000th opening: following the links reaches opening 1001, every opening once", async () => {
    const log = page(1, 1001);
    const withActor = rpc(log);
    const shown: string[] = [];
    let query: AccessLogQuery = {};
    for (let request = 0; request < 1001; request += 1) {
      const read = await readMyAccessLogPage(TOKEN, withActor, DOC, query, NOW);
      if (read.kind !== "ok") throw new Error(read.kind);
      shown.push(...ids(read.days));
      if (read.next === null) break;
      query = queryOf(olderHref(HERE, read.next));
    }
    expect(withActor).toHaveBeenCalledTimes(Math.ceil(1001 / ACCESS_LOG_PAGE));
    expect(shown).toContain(id(1001));
    expect(shown).toEqual(log.map((r) => r.entry_id));
  });

  it("one read per request, however deep the cursor", async () => {
    const { withActor, calls } = database([page(900, ACCESS_LOG_PAGE)]);
    const deep = new Date(START - 899 * WINDOW).toISOString();
    const read = await readMyAccessLogPage(TOKEN, withActor, DOC, { prije: deep, zapis: id(899) }, NOW);
    expect(calls).toHaveLength(1);
    expect(read).toMatchObject({ kind: "ok", continued: true, next: { beforeAt: new Date(START - 949 * WINDOW).toISOString(), beforeId: id(949) } });
  });

  it("the older link carries the oldest row shown, encoded", () => {
    expect(olderHref(HERE, { beforeAt: AT, beforeId: id(3) }))
      .toBe(`${HERE}?prije=${encodeURIComponent(AT)}&zapis=${id(3)}`);
  });

  it.each([
    ["ZD401", "unauthorized"], ["ZD403", "not_found"], ["57014", "unavailable"], ["network", "unavailable"],
  ])("a continuation failing with %s is %s, with no part of the log", async (code, kind) => {
    const { withActor } = database([code]);
    const read = await readMyAccessLogPage(TOKEN, withActor, DOC, { prije: AT, zapis: id(3) }, NOW);
    expect(read).toEqual({ kind });
    expect(JSON.stringify(read)).not.toContain(CANARY);
  });

  it("no session token never reaches the database, cursor or not", async () => {
    const { withActor, calls } = database([page(1, 1)]);
    expect(await readMyAccessLogPage(undefined, withActor, DOC, { prije: AT, zapis: id(3) }, NOW)).toEqual({ kind: "unauthorized" });
    expect(calls).toHaveLength(0);
  });
});

// Contract (b): an opening written between two requests.
describe("DAN-294 access log cursor: concurrency between requests", () => {
  it("an opening written after the first request is neither a duplicate nor makes a row skipped in the continuation", async () => {
    const log = page(1, ACCESS_LOG_PAGE + 5);
    const withActor = rpc(log);
    const first = await readMyAccessLogPage(TOKEN, withActor, DOC, {}, NOW);
    if (first.kind !== "ok" || first.next === null) throw new Error("first page");
    // Written meanwhile: one in the current interval, one into the cursor's own interval.
    log.push(row(9001, { opened_at: new Date(START) }), row(9002, { opened_at: new Date(first.next.beforeAt) }));
    const second = await readMyAccessLogPage(TOKEN, withActor, DOC, queryOf(olderHref(HERE, first.next)), NOW);
    if (second.kind !== "ok") throw new Error("second page");
    const both = [...ids(first.days), ...ids(second.days)];
    expect(new Set(both).size).toBe(both.length);
    expect(both).toEqual(page(1, ACCESS_LOG_PAGE + 5).map((r) => r.entry_id));
    // The new openings are not lost: a fresh first page shows them.
    const fresh = await readMyAccessLogPage(TOKEN, withActor, DOC, {}, NOW);
    if (fresh.kind !== "ok") throw new Error("fresh page");
    expect(ids(fresh.days)).toEqual(expect.arrayContaining([id(9001)]));
  });

  it("negative: a continuation that repeats rows of the cursor's interval, plus a newer one, is not shown twice", async () => {
    const edge = new Date(START - ACCESS_LOG_PAGE * WINDOW);
    const { withActor } = database([[row(ACCESS_LOG_PAGE), row(998, { opened_at: new Date(START) }), row(998, { opened_at: edge }), row(ACCESS_LOG_PAGE + 1)]]);
    const read = await readMyAccessLogPage(TOKEN, withActor, DOC, { prije: edge.toISOString(), zapis: id(ACCESS_LOG_PAGE) }, NOW);
    expect(read).toMatchObject({ kind: "ok" });
    if (read.kind !== "ok") return;
    expect(ids(read.days)).toEqual([id(ACCESS_LOG_PAGE + 1)]);
  });
});
