/**
 * DAN-386 (M2.10-P01; contract on #1091, c.6720558678): the language a work is
 * written in, separate from the interface language (F-06, D-67, D-70). The set
 * is closed and matches the CHECK institution.is_work_language; widening it is
 * a new migration. Nothing here reads the interface language.
 */
export const WORK_LANGUAGES = ["hr", "en"] as const;

export type WorkLanguage = (typeof WORK_LANGUAGES)[number];

/** The work language exactly as stored, or null for anything else: no trimming, case folding or default. */
export function parseWorkLanguage(value: unknown): WorkLanguage | null {
  return typeof value === "string" && (WORK_LANGUAGES as readonly string[]).includes(value)
    ? (value as WorkLanguage)
    : null;
}
