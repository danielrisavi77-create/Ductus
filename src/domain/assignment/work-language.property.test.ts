import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { INTERFACE_LOCALES } from "@/lib/i18n/locale";
import { parseWorkLanguage, WORK_LANGUAGES } from "./work-language";

// The classes of input of the DAN-386 contract (#1091, c.6720558678).
test.prop([fc.string({ maxLength: 12 }).filter((value) => !(WORK_LANGUAGES as readonly string[]).includes(value))])(
  "every string outside the set reads as null",
  (value) => {
    expect(parseWorkLanguage(value)).toBeNull();
  },
);

test.prop([fc.anything({ withBoxedValues: true, withNullPrototype: true })])(
  "anything reads as a member of the set or null, and nothing throws",
  (value) => {
    const language = parseWorkLanguage(value);
    expect(language === null || WORK_LANGUAGES.includes(language)).toBe(true);
    if (language !== null) expect(value).toBe(language);
  },
);

test.prop([fc.constantFrom(...WORK_LANGUAGES), fc.constantFrom(...INTERFACE_LOCALES)])(
  "a work language reads the same whatever the interface language is",
  (language, locale) => {
    expect(parseWorkLanguage(language)).toBe(language);
    // The interface locale is a different set: a locale is a work language only by being literally one.
    expect(parseWorkLanguage(locale)).toBe((WORK_LANGUAGES as readonly string[]).includes(locale) ? locale : null);
  },
);
