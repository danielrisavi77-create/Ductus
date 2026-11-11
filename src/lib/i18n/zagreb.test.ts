import { afterEach, describe, expect, it, vi } from "vitest";

import { zagrebInstant, zagrebLocalMinute, zagrebWall } from "./zagreb";

// DAN-700 (#1877): every class of input, under four host zones. The answer
// must not depend on the zone of the browser or server that runs the code.
const ZONES = ["Europe/Zagreb", "UTC", "America/New_York", "Asia/Tokyo"] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A Zagreb minute as typed into `datetime-local`, and the instant it means (null: none). */
const PARSE: ReadonlyArray<readonly [string, string, string | null]> = [
  ["winter minute", "2026-12-14T23:59", "2026-12-14T22:59:00.000Z"],
  ["summer minute", "2026-07-01T12:00", "2026-07-01T10:00:00.000Z"],
  ["spring change, last minute before", "2026-03-29T01:59", "2026-03-29T00:59:00.000Z"],
  ["spring gap, first minute", "2026-03-29T02:00", null],
  ["spring gap, middle", "2026-03-29T02:30", null],
  ["spring gap, last minute", "2026-03-29T02:59", null],
  ["spring change, first minute after", "2026-03-29T03:00", "2026-03-29T01:00:00.000Z"],
  ["autumn change, last minute before", "2026-10-25T01:59", "2026-10-24T23:59:00.000Z"],
  ["autumn repeated hour, first occurrence", "2026-10-25T02:00", "2026-10-25T00:00:00.000Z"],
  ["autumn repeated hour, middle", "2026-10-25T02:30", "2026-10-25T00:30:00.000Z"],
  ["autumn repeated hour, last minute", "2026-10-25T02:59", "2026-10-25T00:59:00.000Z"],
  ["autumn change, first minute after", "2026-10-25T03:00", "2026-10-25T02:00:00.000Z"],
  ["end of year", "2026-12-31T23:59", "2026-12-31T22:59:00.000Z"],
  ["start of year", "2027-01-01T00:00", "2026-12-31T23:00:00.000Z"],
  ["leap day", "2028-02-29T10:07", "2028-02-29T09:07:00.000Z"],
  ["no leap day", "2027-02-29T10:00", null],
  ["30 February", "2026-02-30T10:00", null],
  ["month 13", "2026-13-01T10:00", null],
  ["month 00", "2026-00-10T10:00", null],
  ["day 00", "2026-05-00T10:00", null],
  ["hour 24", "2026-05-10T24:00", null],
  ["minute 60", "2026-05-10T10:60", null],
  ["year 0000", "0000-05-10T10:00", null],
  ["seconds", "2026-05-10T10:00:00", null],
  ["zone suffix Z", "2026-05-10T10:00Z", null],
  ["offset suffix", "2026-05-10T10:00+02:00", null],
  ["empty", "", null],
  ["space instead of T", "2026-05-10 10:00", null],
  ["surrounding space", " 2026-05-10T10:00", null],
  ["trailing text", "2026-05-10T10:00x", null],
  ["date only", "2026-05-10", null],
  ["words", "sutra u podne", null],
];

describe.each(ZONES)("zagrebInstant with TZ=%s", (zone) => {
  it.each(PARSE)("%s: %j", (_, local, expected) => {
    vi.stubEnv("TZ", zone);
    expect(zagrebInstant(local)).toBe(expected);
  });
});

/** An instant and the Zagreb minute a `datetime-local` field shows for it. */
const LOCAL: ReadonlyArray<readonly [string, string, string]> = [
  ["winter", "2026-12-14T22:59:00.000Z", "2026-12-14T23:59"],
  ["summer", "2026-07-01T10:00:00.000Z", "2026-07-01T12:00"],
  ["evening in New York is the next day in Zagreb", "2026-11-11T01:50:00.000Z", "2026-11-11T02:50"],
  ["spring change, before", "2026-03-29T00:59:00.000Z", "2026-03-29T01:59"],
  ["spring change, after", "2026-03-29T01:00:00.000Z", "2026-03-29T03:00"],
  ["autumn, first 02:30", "2026-10-25T00:30:00.000Z", "2026-10-25T02:30"],
  ["autumn, second 02:30", "2026-10-25T01:30:00.000Z", "2026-10-25T02:30"],
  ["autumn change, after", "2026-10-25T02:00:00.000Z", "2026-10-25T03:00"],
  ["seconds are dropped", "2026-12-14T22:59:59.999Z", "2026-12-14T23:59"],
  ["an offset in the input", "2026-12-14T23:59:00-05:00", "2026-12-15T05:59"],
  ["new year", "2026-12-31T23:00:00.000Z", "2027-01-01T00:00"],
  ["not an instant", "bad", ""],
];

describe.each(ZONES)("zagrebLocalMinute with TZ=%s", (zone) => {
  it.each(LOCAL)("%s", (_, iso, expected) => {
    vi.stubEnv("TZ", zone);
    expect(zagrebLocalMinute(iso)).toBe(expected);
  });
});

describe("zagrebWall", () => {
  it.each(ZONES)("reads the same wall clock under TZ=%s", (zone) => {
    vi.stubEnv("TZ", zone);
    expect(zagrebWall(Date.parse("2026-10-25T00:30:00Z"))).toEqual({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 });
    expect(zagrebWall(Date.parse("2026-10-25T01:30:00Z"))).toEqual({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 });
    expect(zagrebWall(Date.parse("2026-03-29T01:00:00Z"))).toEqual({ year: 2026, month: 3, day: 29, hour: 3, minute: 0 });
  });
});
