import { describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { ACCESS_LOG_PAGE } from "./my-access-log";
import { ACCESS_LOG_MAX_PAGES, pagesParam, readMyAccessLogPages } from "./my-access-log-pages";

// DAN-294 (S-42, contract on #1836, c.6814737263): "Prikaži starije dane" as
// a page count read on the server. Invented ids and names only.
const TOKEN = "T".repeat(43);
const DOC = "rad-izmisljeni-1";
const CANARY = "kanarinac-stranice-7a1d";
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
type Row = Record<string, unknown>;
const START = Date.UTC(2026, 10, 10, 12);
/** Row n of the log, n minutes·5 older than START. */
const row = (n: number, over: Row = {}): Row => ({
  entry_id: id(n), opened_at: new Date(START - n * 300_000), surface: "live_view", reader_role: "mentor",
  reader_given_name: "Nastavnik", reader_family_name: "B", ...over,
});
const page = (from: number, length: number) => Array.from({ length }, (_, i) => row(from + i));

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

const ids = (days: { entries: { id: string }[] }[]) => days.flatMap((d) => d.entries.map((e) => e.id));

describe("DAN-294 access log pages: ?stranica=", () => {
  it.each([
    [undefined, 1], ["1", 1], ["2", 2], ["20", 20], ["21", ACCESS_LOG_MAX_PAGES], ["99", ACCESS_LOG_MAX_PAGES],
    ["0", 1], ["-1", 1], ["01", 1], ["1.5", 1], ["100", 1], ["", 1], [" 2", 1], ["2abc", 1], [["2", "3"], 1],
  ] as [string | string[] | undefined, number][])("%j is %d page(s)", (raw, pages) => {
    expect(pagesParam(raw)).toBe(pages);
  });
});

describe("DAN-294 access log pages: the read", () => {
  it("one page that is not full: one read, no older page offered", async () => {
    const { withActor, calls } = database([page(1, 3)]);
    const read = await readMyAccessLogPages(TOKEN, withActor, DOC, 3);
    expect(calls).toHaveLength(1);
    expect(read).toMatchObject({ kind: "ok", more: false });
    if (read.kind === "ok") expect(ids(read.days)).toEqual([id(1), id(2), id(3)]);
  });

  it("a full first page offers an older one and reads no further than asked", async () => {
    const { withActor, calls } = database([page(1, ACCESS_LOG_PAGE), page(ACCESS_LOG_PAGE + 1, 2)]);
    const read = await readMyAccessLogPages(TOKEN, withActor, DOC, 1);
    expect(calls).toHaveLength(1);
    expect(read).toMatchObject({ kind: "ok", more: true });
  });

  it("the second page starts at the first page's oldest row and is appended after it", async () => {
    const { withActor, calls } = database([page(1, ACCESS_LOG_PAGE), page(ACCESS_LOG_PAGE + 1, 2)]);
    const read = await readMyAccessLogPages(TOKEN, withActor, DOC, 2);
    const oldest = row(ACCESS_LOG_PAGE);
    expect(calls[1]).toEqual([DOC, ACCESS_LOG_PAGE, (oldest.opened_at as Date).toISOString(), oldest.entry_id]);
    expect(read).toMatchObject({ kind: "ok", more: false });
    if (read.kind === "ok") expect(ids(read.days)).toEqual(page(1, ACCESS_LOG_PAGE + 2).map((r) => r.entry_id));
  });

  it("concurrency: an opening written between the reads, or a repeated row, never enters the middle or shows twice", async () => {
    const newer = row(999, { opened_at: new Date(START + 600_000) });
    const { withActor } = database([page(1, ACCESS_LOG_PAGE), [row(ACCESS_LOG_PAGE), newer, row(ACCESS_LOG_PAGE + 1)]]);
    const read = await readMyAccessLogPages(TOKEN, withActor, DOC, 2);
    expect(read.kind).toBe("ok");
    if (read.kind !== "ok") return;
    expect(ids(read.days)).toEqual(page(1, ACCESS_LOG_PAGE + 1).map((r) => r.entry_id));
    expect(ids(read.days)).not.toContain(id(999));
  });

  it.each([
    ["ZD401", "unauthorized"], ["ZD403", "not_found"], ["57014", "unavailable"],
  ])("a later page failing with %s fails the whole read as %s, with no part of the log", async (code, kind) => {
    const { withActor } = database([page(1, ACCESS_LOG_PAGE), code]);
    const read = await readMyAccessLogPages(TOKEN, withActor, DOC, 3);
    expect(read).toEqual({ kind });
    expect(JSON.stringify(read)).not.toContain(CANARY);
  });

  it("another student's work answers as an unknown one: not_found, no row", async () => {
    const { withActor } = database(["ZD403"]);
    expect(await readMyAccessLogPages(TOKEN, withActor, "rad-tudji-2", 1)).toEqual({ kind: "not_found" });
  });

  it("a malformed row anywhere makes the read unavailable rather than guessed", async () => {
    const { withActor } = database([page(1, ACCESS_LOG_PAGE), [row(ACCESS_LOG_PAGE + 1, { opened_at: new Date(START - 7 * 60_000 - ACCESS_LOG_PAGE * 300_000) })]]);
    expect(await readMyAccessLogPages(TOKEN, withActor, DOC, 2)).toEqual({ kind: "unavailable" });
  });

  it("a full last page allowed is never shown as the whole log: no older link, but truncated", async () => {
    const answers = Array.from({ length: ACCESS_LOG_MAX_PAGES }, (_, p) => page(1 + p * ACCESS_LOG_PAGE, ACCESS_LOG_PAGE));
    const { withActor, calls } = database(answers);
    const read = await readMyAccessLogPages(TOKEN, withActor, DOC, ACCESS_LOG_MAX_PAGES);
    expect(calls).toHaveLength(ACCESS_LOG_MAX_PAGES);
    expect(read).toMatchObject({ kind: "ok", more: false, truncated: true });
  });

  it("a last page allowed that is not full is the whole log: not truncated", async () => {
    const answers = Array.from({ length: ACCESS_LOG_MAX_PAGES }, (_, p) =>
      page(1 + p * ACCESS_LOG_PAGE, p === ACCESS_LOG_MAX_PAGES - 1 ? 3 : ACCESS_LOG_PAGE));
    const { withActor } = database(answers);
    expect(await readMyAccessLogPages(TOKEN, withActor, DOC, ACCESS_LOG_MAX_PAGES)).toMatchObject({ kind: "ok", more: false, truncated: false });
  });

  it("below the last page allowed a full page offers the next one and is not truncated", async () => {
    const { withActor } = database([page(1, ACCESS_LOG_PAGE)]);
    expect(await readMyAccessLogPages(TOKEN, withActor, DOC, 1)).toMatchObject({ kind: "ok", more: true, truncated: false });
  });

  it("no session token never reaches the database", async () => {
    const { withActor, calls } = database([page(1, 1)]);
    expect(await readMyAccessLogPages(undefined, withActor, DOC, 2)).toEqual({ kind: "unauthorized" });
    expect(calls).toHaveLength(0);
  });
});

// Contract #1836 c.6818467514 (a): every class of input to the paged read, one table.
describe("DAN-294 access log pages: the classes of input", () => {
  const malformed = [row(1, { opened_at: new Date(START - 7 * 60_000) })];
  it.each([
    ["an empty log", [[]], 3, { kind: "ok", more: false, truncated: false }, [], 1],
    ["one page that is not full", [page(1, 2)], 3, { kind: "ok", more: false }, [1, 2], 1],
    ["a next-page cursor", [page(1, ACCESS_LOG_PAGE), page(ACCESS_LOG_PAGE + 1, 1)], 2, { kind: "ok", more: false },
      Array.from({ length: ACCESS_LOG_PAGE + 1 }, (_, i) => i + 1), 2],
    ["an unavailable answer on the first page", ["57014"], 2, { kind: "unavailable" }, null, 1],
    ["an unavailable answer on a later page", [page(1, ACCESS_LOG_PAGE), "57014"], 2, { kind: "unavailable" }, null, 2],
    ["a malformed row from the reader", [malformed], 1, { kind: "unavailable" }, null, 1],
    ["a network error on the first page", ["network"], 2, { kind: "unavailable" }, null, 1],
    ["a network error on a later page", [page(1, ACCESS_LOG_PAGE), "network"], 3, { kind: "unavailable" }, null, 2],
  ] as [string, (Row[] | string)[], number, Record<string, unknown>, number[] | null, number][])(
    "%s", async (_, answers, pages, shape, rowsShown, reads) => {
      const { withActor, calls } = database(answers);
      const read = await readMyAccessLogPages(TOKEN, withActor, DOC, pages);
      expect(calls).toHaveLength(reads);
      expect(read).toMatchObject(shape);
      expect(JSON.stringify(read)).not.toContain(CANARY);
      if (rowsShown === null) expect(read).toEqual(shape);
      else if (read.kind === "ok") expect(ids(read.days)).toEqual(rowsShown.map(id));
    });
});

// Contract #1836 c.6818467514 (b): an opening written between two pages.
describe("DAN-294 access log pages: concurrency across the cursor", () => {
  it("a first page longer than the limit (one whole interval) and its continuation show every row once, none skipped", async () => {
    // The RPC ends a page on a whole interval: rows 50..52 share the oldest interval of page one.
    const tied = (n: number) => row(n, { opened_at: new Date(START - ACCESS_LOG_PAGE * 300_000) });
    const first = [...page(1, ACCESS_LOG_PAGE - 1), tied(ACCESS_LOG_PAGE), tied(ACCESS_LOG_PAGE + 1), tied(ACCESS_LOG_PAGE + 2)];
    const older = [row(ACCESS_LOG_PAGE + 3), row(ACCESS_LOG_PAGE + 4)];
    const { withActor, calls } = database([first, older]);
    const read = await readMyAccessLogPages(TOKEN, withActor, DOC, 2);
    expect(calls[1]?.[2]).toBe(new Date(START - ACCESS_LOG_PAGE * 300_000).toISOString());
    expect(read.kind).toBe("ok");
    if (read.kind !== "ok") return;
    const shown = ids(read.days);
    expect(new Set(shown).size).toBe(shown.length);
    expect([...shown].sort()).toEqual(page(1, ACCESS_LOG_PAGE + 4).map((r) => r.entry_id as string).sort());
  });

  it("negative: a continuation that repeats the cursor's interval, plus a row written into it meanwhile, adds neither", async () => {
    const edge = new Date(START - ACCESS_LOG_PAGE * 300_000);
    const lateInEdge = row(998, { opened_at: edge });
    const { withActor } = database([page(1, ACCESS_LOG_PAGE), [row(ACCESS_LOG_PAGE), lateInEdge, row(ACCESS_LOG_PAGE + 1)]]);
    const read = await readMyAccessLogPages(TOKEN, withActor, DOC, 2);
    expect(read.kind).toBe("ok");
    if (read.kind !== "ok") return;
    const shown = ids(read.days);
    expect(shown.filter((x) => x === id(ACCESS_LOG_PAGE))).toHaveLength(1);
    expect(shown).not.toContain(id(998));
    expect(shown).toContain(id(ACCESS_LOG_PAGE + 1));
  });
});
