import type { WordRange } from "./length-line";

/**
 * Invented course, assignment and word range for the top bar and the status
 * bar of the demo /rad (FE-D6; design editor-v11 and README §5.1: "Kolegij A
 * / Zadatak 1", "2 000–2 500 riječi"). /rad has no read of its assignment
 * yet, and the assignment has no word range field; the bar beside it says
 * "Demo · izmišljeni podaci". Replaced by the read when it exists. It lives
 * here because its text is shown, so the forbidden-terms scan reads it.
 */
export const DEMO_WORK_CONTEXT: {
  readonly course: string;
  readonly assignment: string;
  readonly words: WordRange;
} = {
  course: "Kolegij A",
  assignment: "Zadatak 1",
  words: { min: 2000, max: 2500 },
};
