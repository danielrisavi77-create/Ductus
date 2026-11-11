/**
 * Europe/Zagreb wall time, independent of the zone of the browser or server
 * that runs the code (DAN-700, #1877). Every time the interface shows, and
 * every `datetime-local` value a teacher types (opening, deadline, enrolment
 * code), means Zagreb time: the pilot runs in one faculty, and the student and
 * the teacher must read the same clock (F-10 invariant 2, PRODUCT §5 rule 5).
 *
 * No `Intl` and no local-time `Date` getters: both follow the host. The zone
 * rule is written out instead: Central European Time (UTC+1), and summer time
 * (UTC+2) from 01:00 UTC on the last Sunday of March to 01:00 UTC on the last
 * Sunday of October (EU rule in force since 1996). A property test compares it
 * with the IANA zone.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** 01:00 UTC on the last Sunday of a month (0-based), as epoch milliseconds. */
function lastSundayOneUtc(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const day = lastDay.getUTCDate() - lastDay.getUTCDay();
  return Date.UTC(year, month, day, 1);
}

function zagrebOffsetMs(epochMs: number): number {
  const year = new Date(epochMs).getUTCFullYear();
  const summer = epochMs >= lastSundayOneUtc(year, 2) && epochMs < lastSundayOneUtc(year, 9);
  return (summer ? 2 : 1) * HOUR_MS;
}

/** Wall clock in Zagreb; `month` is 1-based. */
export type ZagrebWall = { year: number; month: number; day: number; hour: number; minute: number };

export function zagrebWall(epochMs: number): ZagrebWall {
  // A UTC date shifted by the zone offset: its UTC getters read Zagreb time.
  const wall = new Date(epochMs + zagrebOffsetMs(epochMs));
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
    hour: wall.getUTCHours(),
    minute: wall.getUTCMinutes(),
  };
}

/** The `datetime-local` shape: a minute with no seconds and no zone. */
export const LOCAL_MINUTE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/**
 * The instant a Zagreb minute (`2026-12-14T23:59`) means, or null. No
 * normalization: a date that does not exist (30 February, hour 24) or a minute
 * skipped by the spring change is null instead of silently another minute. In
 * the repeated autumn hour the first occurrence (summer time) is taken.
 */
export function zagrebInstant(local: string): string | null {
  const match = LOCAL_MINUTE.exec(local);
  if (match === null) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  if (year < 1) return null;
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  // Summer offset first, so the repeated autumn hour resolves to its first occurrence.
  for (const offset of [2 * HOUR_MS, HOUR_MS]) {
    const epochMs = asUtc - offset;
    const wall = zagrebWall(epochMs);
    if (wall.year === year && wall.month === month && wall.day === day && wall.hour === hour && wall.minute === minute) {
      return new Date(epochMs).toISOString();
    }
  }
  return null;
}

/**
 * Epoch milliseconds of a text: an instant (with `Z` or an offset) as itself, a
 * minute with no zone as Zagreb time; null when it is neither. `Date.parse`
 * alone would read the minute with no zone in the host zone.
 */
export function zagrebEpochMs(text: string): number | null {
  const instant = LOCAL_MINUTE.test(text) ? zagrebInstant(text) : text;
  if (instant === null) return null;
  const epochMs = Date.parse(instant);
  return Number.isNaN(epochMs) ? null : epochMs;
}

/** The Zagreb minute a `datetime-local` field shows for an instant, or "" when it is not one. */
export function zagrebLocalMinute(iso: string): string {
  const epochMs = Date.parse(iso);
  if (Number.isNaN(epochMs)) return "";
  const at = zagrebWall(epochMs);
  return `${pad(at.year, 4)}-${pad(at.month)}-${pad(at.day)}T${pad(at.hour)}:${pad(at.minute)}`;
}

/** Offset of an instant in Zagreb, as `+01:00` or `+02:00`. */
export function zagrebOffset(iso: string): string {
  return zagrebOffsetMs(Date.parse(iso)) === HOUR_MS ? "+01:00" : "+02:00";
}
