/**
 * Croatian formatting helpers (F1-9b).
 *
 * Pure: no React, no DOM, no network, no `Intl`. Every string this file
 * produces is built from tables declared here, for two reasons:
 *
 *   1. Determinism. `Intl.DateTimeFormat("hr-HR", …)` renders whatever the
 *      host's ICU build happens to think Croatian looks like — "19. rujna
 *      2026." on one Node, "19. 9. 2026." on another, and something else again
 *      in a browser whose locale data was trimmed. A date in the UI is a claim
 *      about the author's work; it must not drift with the runtime.
 *   2. Agreement. Croatian numbers take three forms and no `Intl` call picks
 *      them for us. "1 riječi" in a panel that is asking the author to trust it
 *      is a small dishonesty about how carefully the thing was made.
 *
 * Instants are rendered in the RUNTIME'S LOCAL TIME: these strings are read by
 * the author, and the author's clock is the one they will compare them
 * against. What is deterministic is the *shape* of the output, not the time
 * zone it is resolved in.
 */

/**
 * Month names in the genitive, which is the case a Croatian date uses:
 * "19. rujna", not "19. rujan". Index 0 is January, matching `Date#getMonth`.
 */
export const MONTHS_GENITIVE_HR = [
  "siječnja",
  "veljače",
  "ožujka",
  "travnja",
  "svibnja",
  "lipnja",
  "srpnja",
  "kolovoza",
  "rujna",
  "listopada",
  "studenoga",
  "prosinca",
] as const;

/** Two-digit clock component: 5 → "05". */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Parses an instant, or `null` when the input cannot be read as one.
 *
 * Callers show the raw input in that case rather than "Invalid Date" or, far
 * worse, silently substituting "now".
 */
function parseInstant(iso: string): Date | null {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Long Croatian date: `19. rujna 2026.`
 *
 * The trailing period is part of the form — the year is an ordinal — and is
 * not a sentence ending.
 */
export function formatDateHr(iso: string): string {
  const at = parseInstant(iso);
  if (at === null) {
    return iso;
  }
  return `${at.getDate()}. ${MONTHS_GENITIVE_HR[at.getMonth()]} ${at.getFullYear()}.`;
}

/**
 * Long Croatian date and clock time: `19. rujna 2026. u 14:05`.
 *
 * 24-hour, always two digits, no seconds: the minute is as precise as any
 * claim in this UI needs to be.
 */
export function formatDateTimeHr(iso: string): string {
  const at = parseInstant(iso);
  if (at === null) {
    return iso;
  }
  return `${formatDateHr(iso)} u ${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}

/**
 * Picks the Croatian form a count agrees with.
 *
 * The rule, in full:
 *   - last digit 1, but not the 11–14 band → `jedan` (1, 21, 101, 1001)
 *   - last digit 2–4, but not the 11–14 band → `dva` (2, 23, 104)
 *   - everything else, including the whole 11–14 band → `pet`
 *
 * Non-integers and negatives are answered by the same rule applied to the
 * absolute value of the integer part; a fractional count has no place in this
 * UI, and guessing at one would be a worse answer than a consistent one.
 */
export function pluralHr(
  n: number,
  jedan: string,
  dva: string,
  pet: string,
): string {
  const whole = Math.abs(Math.trunc(n));
  const lastTwo = whole % 100;
  const last = whole % 10;
  if (lastTwo >= 11 && lastTwo <= 14) {
    return pet;
  }
  if (last === 1) {
    return jedan;
  }
  if (last >= 2 && last <= 4) {
    return dva;
  }
  return pet;
}

/**
 * The number and the form it agrees with: `countHr(3, "rad", "rada", "radova")`
 * → `"3 rada"`. The number is rendered as given, so a caller that passes a
 * non-integer sees its own value back.
 */
export function countHr(
  n: number,
  jedan: string,
  dva: string,
  pet: string,
): string {
  return `${n} ${pluralHr(n, jedan, dva, pet)}`;
}

/* ------------------------------------------------------------------ nouns */

/** "1 riječ, 2 riječi, 5 riječi" — word counts, in panels and summaries. */
export function wordsHr(n: number): string {
  return countHr(n, "riječ", "riječi", "riječi");
}

/** "1 blok, 2 bloka, 5 blokova" — canonical block counts. */
export function blocksHr(n: number): string {
  return countHr(n, "blok", "bloka", "blokova");
}

/** "1 rad, 2 rada, 5 radova" — projects in the workspace list. */
export function projectsHr(n: number): string {
  return countHr(n, "rad", "rada", "radova");
}

/** "1 kontrolna točka, 2 kontrolne točke, 5 kontrolnih točaka". */
export function checkpointsHr(n: number): string {
  return countHr(n, "kontrolna točka", "kontrolne točke", "kontrolnih točaka");
}

/** "1 dio, 2 dijela, 5 dijelova" — parts named in the export summary. */
export function partsHr(n: number): string {
  return countHr(n, "dio", "dijela", "dijelova");
}

/** "1 problem, 2 problema, 5 problema" — rejected-candidate errors. */
export function problemsHr(n: number): string {
  return countHr(n, "problem", "problema", "problema");
}
