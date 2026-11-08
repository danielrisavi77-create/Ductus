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

// The subtags that may follow the language, in their order (RFC 5646 2.1), each optional.
const alnum = (min: number, max: number) => fc.stringMatching(new RegExp(`^[A-Za-z0-9]{${min},${max}}$`));
const singleton = fc.stringMatching(/^[0-9A-WY-Za-wy-z]$/);
const wellFormedTail = fc
  .record({
    extlang: fc.option(fc.stringMatching(/^[A-Za-z]{3}$/), { nil: undefined }),
    script: fc.option(fc.stringMatching(/^[A-Za-z]{4}$/), { nil: undefined }),
    region: fc.option(fc.stringMatching(/^(?:[A-Za-z]{2}|[0-9]{3})$/), { nil: undefined }),
    variants: fc.array(fc.oneof(alnum(5, 8), fc.stringMatching(/^[0-9][A-Za-z0-9]{3}$/)), { maxLength: 1 }),
    extensions: fc.array(fc.tuple(singleton, fc.array(alnum(2, 8), { minLength: 1, maxLength: 2 })), { maxLength: 1 }),
    privateUse: fc.option(fc.array(alnum(1, 8), { minLength: 1, maxLength: 2 }), { nil: undefined }),
  })
  .map(({ extlang, script, region, variants, extensions, privateUse }) => [
    ...(extlang === undefined ? [] : [extlang]),
    ...(script === undefined ? [] : [script]),
    ...(region === undefined ? [] : [region]),
    ...variants,
    ...extensions.flatMap(([single, rest]) => [single, ...rest]),
    ...(privateUse === undefined ? [] : ["x", ...privateUse]),
  ]);

test.prop([registered, flips, wellFormedTail])(
  "a registered tag in any case and with well-formed subtags reads as itself",
  (locale, upper, subtags) => {
    const cased = [...locale].map((char) => (upper.next().value ? char.toUpperCase() : char)).join("");
    const value = [cased, ...subtags].join("-");
    fc.pre(value.length <= 35);
    expect(languageOfTag(value)).toBe(locale);
    expect(parseInterfaceLocale(value)).toBe(locale);
  },
);

test.prop([registered, wellFormedTail, fc.oneof(singleton, fc.constant("x"))])(
  "a singleton without a subtag after it is no tag",
  (locale, subtags, single) => {
    // After "x" every subtag of one to eight characters is private use, a singleton too.
    fc.pre(!subtags.includes("x"));
    const value = [locale, ...subtags, single].join("-");
    expect(languageOfTag(value)).toBeUndefined();
    expect(parseInterfaceLocale(value)).toBe(DEFAULT_INTERFACE_LOCALE);
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
