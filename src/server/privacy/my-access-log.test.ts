import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { ACCESS_LOG_PAGE, readMyAccessLog } from "./my-access-log";

// DAN-294 (M10.4, contract on #1836, c.6814737263). Invented ids and names only.
const TOKEN = "T".repeat(43);
const CANARY = "kanarinac-dnevnik-3f9c";
const DOC = "rad-izmisljeni-1";
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

type Row = Record<string, unknown>;
const row = (n: number, iso: string, over: Row = {}): Row => ({
  entry_id: id(n), opened_at: new Date(iso), surface: "live_view", reader_role: "mentor",
  reader_given_name: "Nastavnik", reader_family_name: "B", ...over,
});

function database(answer: { rows?: Row[]; code?: string }) {
  const calls: { text: string; values: readonly unknown[] | undefined; token: string | null | undefined }[] = [];
  const withActor = vi.fn(async (token: string | null | undefined, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({
      async query(text: string, values?: readonly unknown[]) {
        calls.push({ text, values, token });
        if (answer.code) throw Object.assign(new Error(`do not leak ${CANARY}`), { code: answer.code });
        return { rows: answer.rows ?? [], rowCount: answer.rows?.length ?? 0 };
      },
    } as unknown as ActorTransaction),
  ) as unknown as WithActor;
  return { withActor, calls };
}

function logged(spy: ReturnType<typeof vi.spyOn>): string {
  return JSON.stringify(spy.mock.calls);
}

afterEach(() => vi.restoreAllMocks());

describe("DAN-294 my access log: the read", () => {
  it("asks the RPC once, with the session token and the document, and nothing else", async () => {
    const { withActor, calls } = database({ rows: [row(1, "2026-11-10T13:10:00Z")] });
    const read = await readMyAccessLog(TOKEN, withActor, DOC);
    expect(calls).toEqual([{ text: "SELECT * FROM app.read_my_access_log($1, $2, $3, $4)", values: [DOC, ACCESS_LOG_PAGE, null, null], token: TOKEN }]);
    expect(read.kind).toBe("ok");
    if (read.kind !== "ok") return;
    expect(read.days.map((d) => d.key)).toEqual(["2026-11-10"]);
    expect(read.next).toBeNull();
    expect(JSON.stringify(read)).not.toMatch(/"(count|total|duration|visits)"/);
  });

  it("an empty log is ok with no day", async () => {
    const { withActor } = database({ rows: [] });
    expect(await readMyAccessLog(TOKEN, withActor, DOC)).toEqual({ kind: "ok", rows: [], days: [], next: null });
  });

  it("a full page names the oldest row as the cursor of the next; the cursor goes to the RPC as given", async () => {
    const rows = Array.from({ length: ACCESS_LOG_PAGE }, (_, i) => row(i + 1, new Date(Date.UTC(2026, 10, 10, 12) - i * 300_000).toISOString()));
    const { withActor, calls } = database({ rows });
    const read = await readMyAccessLog(TOKEN, withActor, DOC);
    const oldest = rows.at(-1)!;
    expect(read.kind === "ok" && read.next).toEqual({ beforeAt: (oldest.opened_at as Date).toISOString(), beforeId: oldest.entry_id });
    await readMyAccessLog(TOKEN, withActor, DOC, { beforeAt: "2026-11-10T08:00:00.000Z", beforeId: id(7) });
    expect(calls[1]?.values).toEqual([DOC, ACCESS_LOG_PAGE, "2026-11-10T08:00:00.000Z", id(7)]);
  });

  it.each([
    ["no fraction", "2026-11-10T08:00:00Z"],
    ["a zero fraction", "2026-11-10T08:00:00.0Z"],
    ["exactly milliseconds", "2026-11-10T08:00:00.000Z"],
    ["six zero digits", "2026-11-10T08:00:00.000000Z"],
  ])("a cursor on the grid with %s goes to the RPC as the same instant", async (_, beforeAt) => {
    const { withActor, calls } = database({ rows: [] });
    expect((await readMyAccessLog(TOKEN, withActor, DOC, { beforeAt, beforeId: id(7) })).kind).toBe("ok");
    expect(calls[0]?.values).toEqual([DOC, ACCESS_LOG_PAGE, "2026-11-10T08:00:00.000Z", id(7)]);
  });

  it("contract b: a continuation that brings a newer or an already shown row is the RPC's answer, and the page shows each id once", async () => {
    const { withActor } = database({ rows: [row(1, "2026-11-10T13:10:00Z"), row(1, "2026-11-10T13:10:00Z")] });
    const read = await readMyAccessLog(TOKEN, withActor, DOC);
    expect(read.kind === "ok" && read.days.flatMap((d) => d.entries)).toHaveLength(1);
  });
});

describe("DAN-294 my access log: refusals", () => {
  it("negative: another person's work (ZD403) reads exactly as an unknown work, with no row and no error text", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { withActor } = database({ code: "ZD403" });
    const foreign = await readMyAccessLog(TOKEN, withActor, "rad-tudji-9");
    const unknown = await readMyAccessLog(TOKEN, withActor, "rad-nepostojeci");
    expect(foreign).toEqual({ kind: "not_found" });
    expect(unknown).toEqual(foreign);
    expect(JSON.stringify(foreign)).not.toContain(CANARY);
    expect(logged(error)).not.toContain(CANARY);
  });

  it("no session (ZD401) is unauthorized; a malformed token never reaches the database", async () => {
    const { withActor, calls } = database({ code: "ZD401" });
    expect(await readMyAccessLog(TOKEN, withActor, DOC)).toEqual({ kind: "unauthorized" });
    expect(await readMyAccessLog(undefined, withActor, DOC)).toEqual({ kind: "unauthorized" });
    expect(await readMyAccessLog("kratak", withActor, DOC)).toEqual({ kind: "unauthorized" });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["an empty id", ""],
    ["a padded id", " doc"],
    ["a control character", "doc\u0000"],
    ["an over-long id", "d".repeat(257)],
  ])("a malformed document id (%s) is not_found without a query", async (_, documentId) => {
    const { withActor, calls } = database({ rows: [] });
    expect(await readMyAccessLog(TOKEN, withActor, documentId)).toEqual({ kind: "not_found" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["a time that is no instant", { beforeAt: "jučer", beforeId: id(1) }],
    ["a time off the five-minute grid", { beforeAt: "2026-11-10T08:01:00.000Z", beforeId: id(1) }],
    ["an id that is no uuid", { beforeAt: "2026-11-10T08:00:00.000Z", beforeId: "x" }],
    ["a time without a zone, read in the host's zone", { beforeAt: "2026-11-10T08:00:00", beforeId: id(1) }],
    ["a date alone", { beforeAt: "2026-11-10", beforeId: id(1) }],
    // #1968 QA c.6815947103: digits below the millisecond are read, not dropped by Date.parse.
    ["one microsecond past the grid", { beforeAt: "2026-11-10T08:00:00.000001Z", beforeId: id(1) }],
    ["999999 microseconds", { beforeAt: "2026-11-10T07:59:59.999999Z", beforeId: id(1) }],
    ["999 microseconds", { beforeAt: "2026-11-10T08:00:00.000999Z", beforeId: id(1) }],
    ["100 microseconds as four digits", { beforeAt: "2026-11-10T08:00:00.0001Z", beforeId: id(1) }],
    ["10 microseconds as five digits", { beforeAt: "2026-11-10T08:00:00.00001Z", beforeId: id(1) }],
    ["nonzero milliseconds", { beforeAt: "2026-11-10T08:00:00.001Z", beforeId: id(1) }],
  ])("a malformed cursor (%s) is unavailable without a query", async (_, cursor) => {
    const { withActor, calls } = database({ rows: [] });
    expect(await readMyAccessLog(TOKEN, withActor, DOC, cursor)).toEqual({ kind: "unavailable" });
    expect(calls).toHaveLength(0);
  });

  // #1968 QA c.6816961587: an impossible calendar date is refused before Date.parse rolls it over.
  it.each([
    ["30 February", "2026-02-30T08:00:00Z"],
    ["29 February of a common year", "2026-02-29T08:00:00Z"],
    ["29 February of a century not divisible by 400", "1900-02-29T08:00:00Z"],
    ["30 February with an offset", "2026-02-30T09:00:00+01:00"],
    ["31 April", "2026-04-31T08:00:00Z"],
    ["month 00", "2026-00-10T08:00:00Z"],
    ["month 13", "2026-13-10T08:00:00Z"],
    ["day 00", "2026-11-00T08:00:00Z"],
    ["hour 24", "2026-11-10T24:00:00Z"],
    ["minute 60", "2026-11-10T08:60:00Z"],
    ["second 60", "2026-11-10T08:00:60Z"],
  ])("a cursor on an impossible date (%s) is unavailable and withActor is not called", async (_, beforeAt) => {
    const { withActor, calls } = database({ rows: [] });
    expect(await readMyAccessLog(TOKEN, withActor, DOC, { beforeAt, beforeId: id(1) })).toEqual({ kind: "unavailable" });
    expect(withActor).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["29 February of a leap year", "2028-02-29T08:00:00Z", "2028-02-29T08:00:00.000Z"],
    ["29 February of a year divisible by 400", "2000-02-29T08:00:00Z", "2000-02-29T08:00:00.000Z"],
    ["31 December", "2026-12-31T23:55:00Z", "2026-12-31T23:55:00.000Z"],
    ["1 January", "2027-01-01T00:00:00Z", "2027-01-01T00:00:00.000Z"],
  ])("a cursor on a real edge date (%s) goes to the RPC as the same instant", async (_, beforeAt, sent) => {
    const { withActor, calls } = database({ rows: [] });
    expect((await readMyAccessLog(TOKEN, withActor, DOC, { beforeAt, beforeId: id(1) })).kind).toBe("ok");
    expect(calls[0]?.values).toEqual([DOC, ACCESS_LOG_PAGE, sent, id(1)]);
  });

  it("any other failure and a malformed row are unavailable, logging only the SQLSTATE or a fixed word", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readMyAccessLog(TOKEN, database({ code: "ZD422" }).withActor, DOC)).toEqual({ kind: "unavailable" });
    expect(await readMyAccessLog(TOKEN, database({ code: `bad ${CANARY}` }).withActor, DOC)).toEqual({ kind: "unavailable" });
    const off = database({ rows: [row(1, "2026-11-10T13:07:00Z")] });
    expect(await readMyAccessLog(TOKEN, off.withActor, DOC)).toEqual({ kind: "unavailable" });
    expect(error.mock.calls).toEqual([
      ["my access log read failed", "ZD422"],
      ["my access log read failed", "unknown"],
      ["my access log read failed", "row_malformed"],
    ]);
    expect(logged(error)).not.toContain(CANARY);
  });
});
