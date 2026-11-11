import { MONTHS_GENITIVE_HR } from "@/lib/i18n/hr";
import { zagrebEpochMs, zagrebWall } from "@/lib/i18n/zagreb";

/**
 * Wall-clock parts of an instant in Europe/Zagreb, independent of the time
 * zone and language of the browser or server that renders them (F-10
 * invariant 2: the student and the teacher see the same text for the same
 * summary, PRODUCT §5 rule 5). The zone rule lives in `@/lib/i18n/zagreb`
 * (DAN-700), shared with every other time the interface shows.
 */

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
  const epochMs = zagrebEpochMs(iso);
  if (epochMs === null) return null;
  const wall = zagrebWall(epochMs);
  return {
    date: `${wall.day}. ${MONTHS_GENITIVE_HR[wall.month - 1]} ${wall.year}.`,
    time: `${pad2(wall.hour)}:${pad2(wall.minute)}`,
  };
}
