import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import { zagrebInstant, zagrebLocalMinute, zagrebWall } from "./zagreb";

// DAN-700 (#1877): the written-out zone rule against the IANA zone, under host
// zones that are not Zagreb, for any minute from 1996 (EU rule) to 2100.
const MINUTE = 60_000;
const FROM = Date.UTC(1996, 0, 1) / MINUTE;
const TO = Date.UTC(2100, 0, 1) / MINUTE;
const minutes = fc.integer({ min: FROM, max: TO }).map((m) => m * MINUTE);

const IANA = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Zagreb",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
});

function iana(epochMs: number) {
  const part = (type: string) => Number(IANA.formatToParts(epochMs).find((p) => p.type === type)!.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute") };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(["America/New_York", "Asia/Tokyo"])("Zagreb time with TZ=%s", (zone) => {
  it("reads the wall clock the IANA zone reads", () => {
    vi.stubEnv("TZ", zone);
    fc.assert(fc.property(minutes, (epochMs) => {
      expect(zagrebWall(epochMs)).toEqual(iana(epochMs));
    }));
  });

  it("turns the minute a field shows back into the same instant, except the second repeated autumn hour", () => {
    vi.stubEnv("TZ", zone);
    fc.assert(fc.property(minutes, (epochMs) => {
      const iso = new Date(epochMs).toISOString();
      const back = zagrebInstant(zagrebLocalMinute(iso));
      if (back === iso) return;
      // Only the second 02:00–02:59 of an autumn change maps to its first occurrence, one hour earlier.
      expect(back).toBe(new Date(epochMs - 60 * MINUTE).toISOString());
      expect(zagrebLocalMinute(back!)).toBe(zagrebLocalMinute(iso));
    }));
  });
});
