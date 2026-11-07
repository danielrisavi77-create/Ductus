import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { DEFAULT_INTERFACE_LOCALE, INTERFACE_LOCALES, languageOfTag, parseInterfaceLocale } from "../../src/lib/i18n/locale";

// The classes of input of the DAN-427 contract (#1091), generated rather than listed.
const registered = fc.constantFrom(...INTERFACE_LOCALES);
const subtag = fc.stringMatching(/^[A-Za-z0-9]{1,8}$/);
const flips = fc.infiniteStream(fc.boolean());
// Characters that may stand next to a tag but are not part of one ("-" starts a subtag).
const noise = fc.string({
  unit: fc.constantFrom(" ", "\t", "\n", "\u0000", "_", ",", ";", ".", "x", "1", "́", "​", " ", "ｈ", "һ"),
  minLength: 1,
  maxLength: 4,
});

test.prop([fc.anything({ withNullPrototype: true, withBoxedValues: true, withMap: true, withSet: true })])(
  "anything reads as a registered locale and nothing throws",
  (value) => {
    expect(INTERFACE_LOCALES).toContain(parseInterfaceLocale(value));
  },
);

test.prop([registered, flips, fc.array(subtag, { maxLength: 3 })])(
  "a registered tag in any case and with any subtags reads as itself",
  (locale, upper, subtags) => {
    const cased = [...locale].map((char) => (upper.next().value ? char.toUpperCase() : char)).join("");
    const value = [cased, ...subtags].join("-");
    expect(languageOfTag(value)).toBe(locale);
    expect(parseInterfaceLocale(value)).toBe(locale);
  },
);

test.prop([registered, noise, fc.boolean()])("a registered tag with anything around it reads as the default", (locale, around, before) => {
  const value = before ? around + locale : locale + around;
  // Checked on the reading, since the default is also a registered locale: the noise
  // either breaks the tag or makes another language ("hrx"), never the locale itself.
  expect(languageOfTag(value)).not.toBe(locale);
  expect(parseInterfaceLocale(value)).toBe(DEFAULT_INTERFACE_LOCALE);
});

test.prop([fc.stringMatching(/^[a-z]{2,3}$/).filter((tag) => !(INTERFACE_LOCALES as readonly string[]).includes(tag))])(
  "a language without a catalogue reads as the default",
  (tag) => {
    expect(languageOfTag(tag)).toBe(tag);
    expect(parseInterfaceLocale(tag)).toBe(DEFAULT_INTERFACE_LOCALE);
  },
);

test.prop([registered, fc.array(subtag, { minLength: 8, maxLength: 12 })])("an overlong tag reads as the default", (locale, subtags) => {
  const value = [locale, ...subtags].join("-");
  fc.pre(value.length > 35);
  expect(languageOfTag(value)).toBeUndefined();
  expect(parseInterfaceLocale(value)).toBe(DEFAULT_INTERFACE_LOCALE);
});
