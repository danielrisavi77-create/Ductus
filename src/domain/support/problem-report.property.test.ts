import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { SYNC_STATES } from "@/domain/sync/states";
import {
  BROWSER_FAMILIES,
  PROBLEM_REPORT_CATEGORIES,
  PROBLEM_REPORT_KEYS,
  PROBLEM_REPORT_ROUTES,
  parseProblemReport,
} from "./problem-report";

// DAN-431 contract (#1836, c.6788234570): no context field can carry work text.
const valid = {
  appVersion: "0.1.0",
  browser: { family: "firefox", major: 132 },
  category: "technical",
  description: "Nakon prijave stranica ostaje prazna.",
  route: "/rad",
  syncState: "SYNCED",
};

// Text shaped like a work: words, sentences, a title, a paragraph.
const word = fc.stringMatching(/^[a-zA-ZčćžšđČĆŽŠĐ]{1,12}$/);
const workText = fc.oneof(
  fc.array(word, { minLength: 1, maxLength: 30 }).map((w) => w.join(" ")),
  fc.array(word, { minLength: 1, maxLength: 6 }).map((w) => `/${w.join("-")}`),
  fc.array(word, { minLength: 1, maxLength: 6 }).map((w) => `/rad?naslov=${w.join("+")}`),
  fc.string({ maxLength: 200 }),
  fc.string({ unit: "grapheme", maxLength: 200 }),
);

const CLOSED: Record<string, readonly string[]> = {
  category: PROBLEM_REPORT_CATEGORIES,
  route: PROBLEM_REPORT_ROUTES,
  syncState: SYNC_STATES,
};

test.prop([fc.constantFrom("category", "route", "syncState"), workText])(
  "a closed field accepts a string only when it is exactly a member of its set",
  (key, text) => {
    const report = parseProblemReport({ ...valid, [key]: text });
    expect(report !== null).toBe(CLOSED[key]!.includes(text));
  },
);

test.prop([workText])("the browser family accepts only its four names", (text) => {
  const report = parseProblemReport({ ...valid, browser: { family: text, major: 1 } });
  expect(report !== null).toBe((BROWSER_FAMILIES as readonly string[]).includes(text));
});

test.prop([fc.array(word, { minLength: 1, maxLength: 30 })])(
  "an app version never holds a word with a letter outside hex",
  (words) => {
    const text = words.join(" ");
    for (const version of [text, `1.2.3-${words.join("-")}`, `1.2.3+${words.join("")}`]) {
      if (/[^0-9a-f.+]/.test(version)) expect(parseProblemReport({ ...valid, appVersion: version })).toBeNull();
    }
  },
);

test.prop([
  fc.string({ minLength: 1, maxLength: 20 }).filter((key) => !(PROBLEM_REPORT_KEYS as readonly string[]).includes(key)),
  fc.anything(),
])("any extra key is refused, whatever it holds", (key, value) => {
  expect(parseProblemReport({ ...valid, [key]: value })).toBeNull();
});

test.prop([
  fc.record({
    appVersion: fc.oneof(fc.constant("1.0.0"), workText),
    browser: fc.oneof(fc.record({ family: fc.constantFrom(...BROWSER_FAMILIES), major: fc.integer({ min: 0, max: 999 }) }), fc.anything()),
    category: fc.oneof(fc.constantFrom(...PROBLEM_REPORT_CATEGORIES), workText),
    description: fc.oneof(fc.constant("Ne mogu predati rad."), workText),
    route: fc.oneof(fc.constantFrom(...PROBLEM_REPORT_ROUTES), fc.constant(null), workText),
    syncState: fc.oneof(fc.constantFrom(...SYNC_STATES), fc.constant(null), workText),
  }),
  workText,
])("whatever is accepted holds only closed values outside the description", (input, text) => {
  const report = parseProblemReport(input);
  if (report === null) return;
  expect(Object.keys(report).sort()).toEqual(
    ["appVersion", "browserFamily", "browserMajor", "category", "description", "route", "syncState"],
  );
  expect(PROBLEM_REPORT_CATEGORIES).toContain(report.category);
  expect(BROWSER_FAMILIES).toContain(report.browserFamily);
  expect(report.route === null || (PROBLEM_REPORT_ROUTES as readonly string[]).includes(report.route)).toBe(true);
  expect(report.syncState === null || (SYNC_STATES as readonly string[]).includes(report.syncState)).toBe(true);
  expect(report.appVersion).toMatch(/^[0-9a-f.+]+$/);
  // Only the description may carry the generated text, and only because the user typed it there.
  const context = [report.category, report.route, report.syncState, report.appVersion, report.browserFamily];
  if (/[^0-9a-f.+]/.test(text) && text.length > 1) {
    expect(context.filter((v) => v === text && !Object.values(CLOSED).some((set) => set.includes(text)))).toEqual([]);
  }
});

test.prop([fc.anything({ withBoxedValues: true, withNullPrototype: true, withMap: true, withSet: true })])(
  "anything parses to a report or null, and nothing throws",
  (value) => {
    expect(() => parseProblemReport(value)).not.toThrow();
  },
);
