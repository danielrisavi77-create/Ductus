import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MONTHS_GENITIVE_HR,
  blocksHr,
  checkpointsHr,
  countHr,
  formatDateHr,
  formatDateTimeHr,
  partsHr,
  pluralHr,
  problemsHr,
  projectsHr,
  wordsHr,
} from "./hr";

/**
 * The instants are written with the Zagreb offset of their date (summer time
 * from April to October for the days used here), so the expectations name the
 * Zagreb wall clock. DAN-700: the suite below runs them under four host zones.
 */
function localIso(
  year: number,
  monthIndex: number,
  day: number,
  hours = 0,
  minutes = 0,
): string {
  const two = (value: number) => String(value).padStart(2, "0");
  const offset = monthIndex >= 3 && monthIndex <= 9 ? "+02:00" : "+01:00";
  return new Date(`${year}-${two(monthIndex + 1)}-${two(day)}T${two(hours)}:${two(minutes)}:00${offset}`).toISOString();
}

const ZONES = ["Europe/Zagreb", "UTC", "America/New_York", "Asia/Tokyo"] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(ZONES)("formatDateHr with TZ=%s", (zone) => {
  beforeEach(() => {
    vi.stubEnv("TZ", zone);
  });

  it("renders the long Croatian form with the genitive month", () => {
    expect(formatDateHr(localIso(2026, 8, 19))).toBe("19. rujna 2026.");
  });

  it("does not pad the day", () => {
    expect(formatDateHr(localIso(2026, 0, 1))).toBe("1. siječnja 2026.");
  });

  it("names every month in the genitive", () => {
    const rendered = MONTHS_GENITIVE_HR.map((_, index) =>
      formatDateHr(localIso(2026, index, 15)),
    );
    expect(rendered).toEqual([
      "15. siječnja 2026.",
      "15. veljače 2026.",
      "15. ožujka 2026.",
      "15. travnja 2026.",
      "15. svibnja 2026.",
      "15. lipnja 2026.",
      "15. srpnja 2026.",
      "15. kolovoza 2026.",
      "15. rujna 2026.",
      "15. listopada 2026.",
      "15. studenoga 2026.",
      "15. prosinca 2026.",
    ]);
  });

  it("does not depend on the host's locale data", () => {
    // Whatever ICU this runtime carries, the shape is ours.
    expect(formatDateHr(localIso(2026, 8, 19))).not.toMatch(/September|rujan\b/);
  });

  it("shows an unreadable instant as it is rather than as an invalid date", () => {
    expect(formatDateHr("kada god")).toBe("kada god");
    expect(formatDateHr("")).toBe("");
  });
});

describe.each(ZONES)("formatDateTimeHr with TZ=%s", (zone) => {
  beforeEach(() => {
    vi.stubEnv("TZ", zone);
  });

  it("adds the clock time with the Croatian preposition", () => {
    expect(formatDateTimeHr(localIso(2026, 8, 19, 14, 5))).toBe(
      "19. rujna 2026. u 14:05",
    );
  });

  it("pads both clock components to two digits", () => {
    expect(formatDateTimeHr(localIso(2026, 8, 19, 9, 7))).toBe(
      "19. rujna 2026. u 09:07",
    );
  });

  it("uses the 24-hour clock", () => {
    const rendered = formatDateTimeHr(localIso(2026, 8, 19, 23, 59));
    expect(rendered).toBe("19. rujna 2026. u 23:59");
    expect(rendered.toLowerCase()).not.toContain("pm");
  });

  it("shows an unreadable instant as it is", () => {
    expect(formatDateTimeHr("bilo kada")).toBe("bilo kada");
  });

  // DAN-700 (#1877): the comment posted at 01:50 UTC read 20:50 the day before in New York.
  it("reads the clock in Zagreb, not in the host zone", () => {
    expect(formatDateTimeHr("2026-11-11T01:50:00.000Z")).toBe("11. studenoga 2026. u 02:50");
    expect(formatDateHr("2026-11-10T23:30:00.000Z")).toBe("11. studenoga 2026.");
    expect(formatDateTimeHr("2026-12-14T22:59:00.000Z")).toBe("14. prosinca 2026. u 23:59");
  });

  it("follows both clock changes", () => {
    expect(formatDateTimeHr("2026-03-29T00:59:00.000Z")).toBe("29. ožujka 2026. u 01:59");
    expect(formatDateTimeHr("2026-03-29T01:00:00.000Z")).toBe("29. ožujka 2026. u 03:00");
    expect(formatDateTimeHr("2026-10-25T00:30:00.000Z")).toBe("25. listopada 2026. u 02:30");
    expect(formatDateTimeHr("2026-10-25T01:30:00.000Z")).toBe("25. listopada 2026. u 02:30");
    expect(formatDateTimeHr("2026-10-25T02:00:00.000Z")).toBe("25. listopada 2026. u 03:00");
  });

  it("reads an instant with an offset as that instant", () => {
    expect(formatDateTimeHr("2026-12-14T17:59:00-05:00")).toBe("14. prosinca 2026. u 23:59");
  });

  it("reads a minute without a zone as Zagreb time, as the form fields do", () => {
    expect(formatDateTimeHr("2026-12-14T23:59")).toBe("14. prosinca 2026. u 23:59");
    expect(formatDateHr("2026-12-31T23:59")).toBe("31. prosinca 2026.");
  });
});

describe("pluralHr", () => {
  const rad = (n: number) => pluralHr(n, "rad", "rada", "radova");

  it("takes the first form for 1", () => {
    expect(rad(1)).toBe("rad");
  });

  it("takes the second form for 2, 3 and 4", () => {
    expect([rad(2), rad(3), rad(4)]).toEqual(["rada", "rada", "rada"]);
  });

  it("takes the third form for 5 and for 0", () => {
    expect(rad(5)).toBe("radova");
    expect(rad(0)).toBe("radova");
  });

  it("takes the third form across the whole 11–14 band", () => {
    expect([rad(11), rad(12), rad(13), rad(14)]).toEqual([
      "radova",
      "radova",
      "radova",
      "radova",
    ]);
  });

  it("returns to the first form at 21 and at 101", () => {
    expect(rad(21)).toBe("rad");
    expect(rad(101)).toBe("rad");
  });

  it("returns to the second form at 22", () => {
    expect(rad(22)).toBe("rada");
  });

  it("keeps the third form at 111, where 11 wins over the last digit", () => {
    expect(rad(111)).toBe("radova");
    expect(rad(112)).toBe("radova");
  });

  it("answers a negative count by its magnitude", () => {
    expect(rad(-1)).toBe("rad");
    expect(rad(-12)).toBe("radova");
  });

  it("answers a fractional count by its integer part", () => {
    expect(rad(1.9)).toBe("rad");
  });
});

describe("countHr", () => {
  it("puts the number in front of the form it agrees with", () => {
    expect(countHr(1, "rad", "rada", "radova")).toBe("1 rad");
    expect(countHr(3, "rad", "rada", "radova")).toBe("3 rada");
    expect(countHr(11, "rad", "rada", "radova")).toBe("11 radova");
  });
});

describe("the nouns the UI counts", () => {
  it("agrees for words", () => {
    expect([wordsHr(1), wordsHr(2), wordsHr(5), wordsHr(11)]).toEqual([
      "1 riječ",
      "2 riječi",
      "5 riječi",
      "11 riječi",
    ]);
  });

  it("agrees for blocks", () => {
    expect([blocksHr(1), blocksHr(2), blocksHr(5)]).toEqual([
      "1 blok",
      "2 bloka",
      "5 blokova",
    ]);
  });

  it("agrees for projects", () => {
    expect([projectsHr(1), projectsHr(2), projectsHr(5)]).toEqual([
      "1 rad",
      "2 rada",
      "5 radova",
    ]);
  });

  it("agrees for checkpoints", () => {
    expect([checkpointsHr(1), checkpointsHr(2), checkpointsHr(5)]).toEqual([
      "1 kontrolna točka",
      "2 kontrolne točke",
      "5 kontrolnih točaka",
    ]);
  });

  it("agrees for export parts", () => {
    expect([partsHr(1), partsHr(2), partsHr(5)]).toEqual([
      "1 dio",
      "2 dijela",
      "5 dijelova",
    ]);
  });

  it("agrees for rejected-candidate problems", () => {
    expect([problemsHr(1), problemsHr(2), problemsHr(5)]).toEqual([
      "1 problem",
      "2 problema",
      "5 problema",
    ]);
  });
});
