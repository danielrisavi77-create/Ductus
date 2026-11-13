import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { INTERFACE_LOCALE_SETTING_VALUES, parseInterfaceLocaleSetting } from "./interface-locale-setting";

// DAN-427 contract (#1836, c.6820446364): every string outside {hr, en} is
// refused, and every accepted value is exactly a member of the set.
const SET: readonly string[] = INTERFACE_LOCALE_SETTING_VALUES;

const near = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.string({ unit: "grapheme", maxLength: 12 }),
  fc.constantFrom(...SET).chain((s) =>
    fc.tuple(fc.string({ maxLength: 3 }), fc.string({ maxLength: 3 })).map(([a, b]) => `${a}${s}${b}`),
  ),
  fc.constantFrom(...SET).map((s) => s.toUpperCase()),
  fc.stringMatching(/^[a-zA-Z]{2,3}(?:[-_][a-zA-Z]{2})?$/),
);

test.prop([near])("a string is accepted only when it is exactly a member of the set", (locale) => {
  const parsed = parseInterfaceLocaleSetting({ locale });
  expect(parsed !== null).toBe(SET.includes(locale));
  if (parsed) expect(parsed.locale).toBe(locale);
});

test.prop([fc.anything()])("any value under locale that is not a member is refused", (locale) => {
  const parsed = parseInterfaceLocaleSetting({ locale });
  expect(parsed !== null).toBe(typeof locale === "string" && SET.includes(locale));
});

test.prop([
  fc.constantFrom(...SET),
  fc.dictionary(fc.string({ maxLength: 12 }).filter((k) => k !== "locale"), fc.anything(), { minKeys: 1, maxKeys: 4 }),
])("any key besides locale makes the body invalid", (locale, extra) => {
  expect(parseInterfaceLocaleSetting({ ...extra, locale })).toBeNull();
});
