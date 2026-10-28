import { MONTHS_GENITIVE_HR } from "@/lib/i18n/hr";

/**
 * Wall-clock parts of an instant in Europe/Zagreb, independent of the time
 * zone and language of the browser or server that renders them (F-10
 * invariant 2: the student and the teacher see the same text for the same
 * summary, PRODUCT §5 rule 5).
 *
 * No `Intl` and no local-time `Date` getters: both follow the host. The zone
 * rule is written out instead: Central European Time (UTC+1), and summer time
 * (UTC+2) from 01:00 UTC on the last Sunday of March to 01:00 UTC on the last
 * Sunday of October (EU rule in force since 1996). A test compares it with the
 * IANA zone over many years and every transition.
 */

const HOUR_MS = 3_600_000;

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

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export type ZagrebParts = {
  /** Long Croatian date, `19. listopada 2026.` */
  date: string;
  /** 24-hour clock, `14:05` */
  time: string;
};

/** Parts of the instant, or `null` when `iso` cannot be read as one. */
export function zagrebParts(iso: string): ZagrebParts | null {
  const epochMs = Date.parse(iso);
  if (Number.isNaN(epochMs)) return null;
  // A UTC date shifted by the zone offset: its UTC getters read Zagreb time.
  const wall = new Date(epochMs + zagrebOffsetMs(epochMs));
  return {
    date: `${wall.getUTCDate()}. ${MONTHS_GENITIVE_HR[wall.getUTCMonth()]} ${wall.getUTCFullYear()}.`,
    time: `${pad2(wall.getUTCHours())}:${pad2(wall.getUTCMinutes())}`,
  };
}
