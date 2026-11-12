import { fc, test as fcTest } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";

import { accessLogDaysOf, accessLogEntryOf, mergeAccessLogPages, zonedInstantOf } from "./access-log-days";

// DAN-294 (M10.4, contract on #1836, c.6814737263): the classes of input of
// the grouping, written before the code. Invented ids and names only.
type Row = Record<string, unknown>;
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const row = (over: Row = {}): Row => ({
  entry_id: id(1), opened_at: new Date("2026-11-10T13:10:00Z"), surface: "live_view", reader_role: "mentor",
  reader_given_name: "Nastavnik", reader_family_name: "B", ...over,
});
const at = (iso: string, n: number, over: Row = {}) => row({ entry_id: id(n), opened_at: new Date(iso), ...over });
/** Each day as its key and its rows as "from–to role surface". */
const shape = (rows: Row[]) => accessLogDaysOf(rows)?.map((d) => [d.key, d.entries.map((e) => `${e.from}–${e.to} ${e.role} ${e.surface}`)]);

describe("DAN-294 access log days: the classes of input", () => {
  it("1. an empty log is no day, not a failure", () => {
    expect(accessLogDaysOf([])).toEqual([]);
  });

  it("2. one entry is one day with one row of five minutes", () => {
    expect(accessLogDaysOf([row()])).toEqual([{
      key: "2026-11-10", year: 2026, month: 11, day: 10, weekday: 2,
      entries: [{ id: id(1), at: Date.parse("2026-11-10T13:10:00Z"), from: "14:10", to: "14:15", role: "mentor", surface: "live_view",
        reader: { givenName: "Nastavnik", familyName: "B" } }],
    }]);
  });

  it("3. several entries in one window stay separate rows, never merged or counted", () => {
    const rows = [
      at("2026-11-10T13:10:00Z", 1),
      at("2026-11-10T13:10:00Z", 2, { surface: "submitted_text" }),
      at("2026-11-10T13:10:00Z", 3, { reader_role: "teacher", reader_given_name: "Nastavnik", reader_family_name: "C" }),
    ];
    // Within a window the order is the read's: newest id first.
    expect(shape(rows)).toEqual([["2026-11-10", [
      "14:10–14:15 teacher live_view", "14:10–14:15 mentor submitted_text", "14:10–14:15 mentor live_view",
    ]]]);
    expect(accessLogDaysOf(rows)?.[0]?.entries.map((e) => e.id)).toEqual([id(3), id(2), id(1)]);
  });

  it("4. the window edge splits rows; a time off the edge fails the whole read", () => {
    expect(shape([at("2026-11-10T13:05:00Z", 1), at("2026-11-10T13:10:00Z", 2)])).toEqual([["2026-11-10", [
      "14:10–14:15 mentor live_view", "14:05–14:10 mentor live_view",
    ]]]);
    expect(accessLogDaysOf([at("2026-11-10T13:07:00Z", 1)])).toBeNull();
    expect(accessLogDaysOf([at("2026-11-10T13:10:30Z", 1)])).toBeNull();
    expect(accessLogDaysOf([at("2026-11-10T13:10:00.001Z", 1)])).toBeNull();
  });

  it("5. the day changes at midnight in Zagreb, winter and summer", () => {
    expect(shape([at("2026-11-11T22:55:00Z", 1), at("2026-11-11T23:00:00Z", 2)])).toEqual([
      ["2026-11-12", ["00:00–00:05 mentor live_view"]],
      ["2026-11-11", ["23:55–00:00 mentor live_view"]],
    ]);
    expect(shape([at("2026-07-01T21:55:00Z", 1), at("2026-07-01T22:00:00Z", 2)])).toEqual([
      ["2026-07-02", ["00:00–00:05 mentor live_view"]],
      ["2026-07-01", ["23:55–00:00 mentor live_view"]],
    ]);
  });

  it("6. the spring and autumn change: wall times as the clock showed them, order by instant", () => {
    expect(shape([at("2026-03-29T00:55:00Z", 1)])).toEqual([["2026-03-29", ["01:55–03:00 mentor live_view"]]]);
    expect(shape([at("2026-10-25T00:55:00Z", 1), at("2026-10-25T01:00:00Z", 2)])).toEqual([["2026-10-25", [
      "02:00–02:05 mentor live_view", "02:55–02:00 mentor live_view",
    ]]]);
  });

  it("7. an unknown role or surface keeps the row, marked unknown", () => {
    expect(shape([row({ reader_role: "owner" }), row({ entry_id: id(2), surface: "elsewhere" })])).toEqual([["2026-11-10", [
      "14:10–14:15 mentor unknown", "14:10–14:15 unknown live_view",
    ]]]);
    expect(accessLogEntryOf(row({ reader_role: null }))?.role).toBe("unknown");
  });

  it.each([
    ["half a name", { reader_family_name: null }],
    ["an empty name", { reader_given_name: "" }],
    ["an over-long name", { reader_given_name: "a".repeat(256) }],
    ["an id that is no uuid", { entry_id: "abc" }],
    ["an upper-case id", { entry_id: id(0xabc).toUpperCase() }],
    ["a time that is no instant", { opened_at: "yesterday" }],
    ["an invalid date", { opened_at: new Date(Number.NaN) }],
    ["no time", { opened_at: null }],
  ])("8. refuses %s", (_, over) => {
    expect(accessLogEntryOf(row(over))).toBeNull();
    expect(accessLogDaysOf([row(over)])).toBeNull();
  });

  it("8. no name at all is the role alone", () => {
    expect(accessLogEntryOf(row({ reader_given_name: null, reader_family_name: null }))?.reader).toBeNull();
    expect(accessLogEntryOf(row({ opened_at: "2026-11-10T13:10:00+00:00" }))?.at).toBe(Date.UTC(2026, 10, 10, 13, 10));
    expect(accessLogDaysOf([row({ opened_at: "2026-11-10T13:10:00+00:00" })])?.[0]?.entries[0]?.from).toBe("14:10");
  });

  it("9. a repeated id is shown once, across pages too", () => {
    expect(accessLogDaysOf([row(), row()])?.[0]?.entries).toHaveLength(1);
    const first = [at("2026-11-10T13:10:00Z", 1)];
    const second = [at("2026-11-10T13:10:00Z", 1), at("2026-11-09T13:10:00Z", 2)];
    expect(mergeAccessLogPages(first, second).map((r) => r.entry_id)).toEqual([id(1), id(2)]);
  });

  it("9a. a time given as text must name its zone; a long first page does not overflow the stack", () => {
    expect(accessLogEntryOf(row({ opened_at: "2026-11-10T13:10:00Z" }))?.at).toBe(Date.UTC(2026, 10, 10, 13, 10));
    expect(accessLogEntryOf(row({ opened_at: "2026-11-10T14:10:00+01:00" }))?.at).toBe(Date.UTC(2026, 10, 10, 13, 10));
    expect(accessLogEntryOf(row({ opened_at: "2026-11-10T13:10:00" }))).toBeNull();
    expect(accessLogEntryOf(row({ opened_at: "2026-11-10" }))).toBeNull();
    expect(zonedInstantOf("Tue, 10 Nov 2026 13:10:00")).toBeNaN();
    const long = Array.from({ length: 200_000 }, (_, i) => at("2026-11-10T13:10:00Z", i + 10));
    expect(mergeAccessLogPages(long, [at("2026-11-09T13:10:00Z", 1)])).toHaveLength(200_001);
  });

  it("10. unordered input comes out newest day and row first", () => {
    expect(shape([at("2026-11-09T08:00:00Z", 1), at("2026-11-10T08:00:00Z", 2), at("2026-11-09T09:00:00Z", 3)])).toEqual([
      ["2026-11-10", ["09:00–09:05 mentor live_view"]],
      ["2026-11-09", ["10:00–10:05 mentor live_view", "09:00–09:05 mentor live_view"]],
    ]);
  });
});

describe("DAN-294 access log days: concurrency (contract b)", () => {
  it("an entry written after the first page neither enters the continuation nor changes the first page", () => {
    const first = [at("2026-11-10T13:10:00Z", 1)];
    const before = JSON.stringify(accessLogDaysOf(first));
    // A misbehaving continuation that brings back the first page's row and a newer one.
    const merged = mergeAccessLogPages(first, [at("2026-11-10T13:10:00Z", 1), at("2026-11-10T13:20:00Z", 9), at("2026-11-08T13:10:00Z", 2)]);
    expect(merged.map((r) => r.entry_id)).toEqual([id(1), id(2)]);
    expect(JSON.stringify(accessLogDaysOf(first))).toBe(before);
  });
});

const instant = fc.integer({ min: Date.UTC(2025, 0, 1) / 300_000, max: Date.UTC(2028, 0, 1) / 300_000 }).map((n) => new Date(n * 300_000));
const entry = fc.record({
  n: fc.integer({ min: 1, max: 40 }),
  opened_at: instant,
  surface: fc.constantFrom("live_view", "process_summary", "fast_path", "replay", "submitted_text", "x"),
  reader_role: fc.constantFrom("teacher", "mentor", "seminar_teacher", "y"),
});

describe("DAN-294 access log days: properties", () => {
  fcTest.prop([fc.array(entry, { maxLength: 60 })])("one row per distinct id, each in its Zagreb day, no total anywhere", (raw) => {
    const rows = raw.map((r) => row({ entry_id: id(r.n), opened_at: r.opened_at, surface: r.surface, reader_role: r.reader_role }));
    const days = accessLogDaysOf(rows);
    expect(days).not.toBeNull();
    const out = days!.flatMap((d) => d.entries.map((e) => ({ d, e })));
    expect(out).toHaveLength(new Set(raw.map((r) => r.n)).size);
    for (const { d, e } of out) {
      const source = rows.find((r) => r.entry_id === e.id)!;
      const wall = new Date((source.opened_at as Date).getTime());
      // The day key is the Zagreb date of the instant: one or two hours ahead of UTC.
      const candidates = [3_600_000, 7_200_000].map((o) => new Date(wall.getTime() + o).toISOString().slice(0, 10));
      expect(candidates).toContain(d.key);
    }
    const keys = days!.map((d) => d.key);
    expect([...keys].sort().reverse()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(JSON.stringify(days)).not.toMatch(/"(count|total|duration|visits)"/);
  });
});
