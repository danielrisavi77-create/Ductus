import { describe, expect, it } from "vitest";

import { messagesHr } from "./messages.hr";
import { DEFAULT_INTERFACE_LOCALE, INTERFACE_LOCALES, languageOfTag, messagesFor, parseInterfaceLocale } from "./locale";

// Classes of input the parser covers (DAN-427 contract on #1091). Every class
// that is not a registered language tag gives the default, never an error.
describe("parseInterfaceLocale", () => {
  it("defaults to Croatian", () => {
    expect(DEFAULT_INTERFACE_LOCALE).toBe("hr");
    expect(INTERFACE_LOCALES).toContain("hr");
  });

  it.each([
    // 1. A registered tag.
    ["hr", "hr"],
    // 2. Language tags are case-insensitive (BCP 47).
    ["HR", "hr"],
    ["Hr", "hr"],
    // 3. A region or script subtag keeps the language.
    ["hr-HR", "hr"],
    ["hr-hr", "hr"],
    ["HR-Latn-HR", "hr"],
  ])("reads %j as %s", (value, locale) => {
    expect(languageOfTag(value)).toBe(locale);
    expect(parseInterfaceLocale(value)).toBe(locale);
  });

  // 4. A well-formed tag of a language without a catalogue: the tag is read, the
  // default is chosen only because nothing is registered for it.
  it.each([
    ["de", "de"],
    ["sr-Latn", "sr"],
    // A letter next to "hr" makes another three-letter language, not "hr".
    ["hrx", "hrx"],
    ["xhr", "xhr"],
  ])("reads the language of %j as %s and gives the default", (value, language) => {
    expect(languageOfTag(value)).toBe(language);
    expect(parseInterfaceLocale(value)).toBe(DEFAULT_INTERFACE_LOCALE);
  });

  // Classes 5 to 10 are not one tag at all. With only "hr" registered the default
  // and a match look the same, so the tag reading is checked on its own.
  it.each([
    // 5. Empty or blank.
    [""],
    ["   "],
    // 6. Not a string.
    [undefined],
    [null],
    [0],
    [1],
    [Number.NaN],
    [true],
    [{}],
    [["hr"]],
    [{ toString: () => "hr" }],
    [new String("hr")],
    [Symbol("hr")],
    // 7. Padding, control characters, separators and suffixes around a tag.
    [" hr"],
    ["hr "],
    ["hr\n"],
    ["hr\u0000"],
    ["hr_HR"],
    ["hr-"],
    ["-hr"],
    ["hr--HR"],
    ["hr,en;q=0.8"],
    ["hr-HR-toolongsubtag"],
    // 8. Keys of Object.prototype.
    ["__proto__"],
    ["constructor"],
    ["toString"],
    ["hasOwnProperty"],
    // 9. Look-alike letters, full width and combining marks; nothing is normalised.
    ["һr"],
    ["ｈｒ"],
    ["h́r"],
    ["h​r"],
    // 10. Overlong input.
    [`hr-${"a".repeat(8)}`.repeat(20)],
  ])("reads %j as no tag and gives the default", (value) => {
    expect(languageOfTag(value)).toBeUndefined();
    expect(parseInterfaceLocale(value)).toBe(DEFAULT_INTERFACE_LOCALE);
  });
});

describe("messagesFor", () => {
  it("gives the Croatian catalogue for Croatian", () => {
    expect(messagesFor("hr")).toBe(messagesHr);
  });

  it("gives a catalogue for every registered locale", () => {
    for (const locale of INTERFACE_LOCALES) expect(messagesFor(locale).app.name).toBe(messagesHr.app.name);
  });
});
