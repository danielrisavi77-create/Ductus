import { describe, expect, it } from "vitest";

import { INTERFACE_LOCALES } from "@/lib/i18n/locale";
import { INTERFACE_LOCALE_SETTING_VALUES, parseInterfaceLocaleSetting } from "./interface-locale-setting";

// DAN-427 contract (#1836, c.6820446364), input classes (a).
describe("parseInterfaceLocaleSetting", () => {
  it.each([
    ["hr", "hr"],
    ["en", "en"],
  ])("accepts exactly %j", (locale, expected) => {
    expect(parseInterfaceLocaleSetting({ locale })).toEqual({ locale: expected });
  });

  it.each([
    ["upper case", "HR"],
    ["mixed case", "En"],
    ["region", "hr-HR"],
    ["underscore region", "en_GB"],
    ["unknown language", "de"],
    ["unknown tag", "xx"],
    ["empty", ""],
    ["leading space", " hr"],
    ["trailing newline", "hr\n"],
    ["Cyrillic look-alike", "һr"],
    ["full width", "ｈｒ"],
    ["too long", "hr".repeat(100)],
    ["zero width", "h​r"],
  ])("refuses a string outside the set: %s", (_name, locale) => {
    expect(parseInterfaceLocaleSetting({ locale })).toBeNull();
  });

  it.each([
    ["number", 1],
    ["null", null],
    ["boolean", true],
    ["array", ["hr"]],
    ["object", { value: "hr" }],
    ["undefined", undefined],
  ])("refuses a value that is not a string: %s", (_name, locale) => {
    expect(parseInterfaceLocaleSetting({ locale })).toBeNull();
  });

  it.each([
    ["missing key", {}],
    ["extra key", { locale: "hr", userId: "00000000-0000-4000-8000-000000000001" }],
    ["institution key", { locale: "en", institutionId: "x" }],
    ["wrong key", { language: "hr" }],
    ["own __proto__ key", JSON.parse('{"locale":"hr","__proto__":{"locale":"en"}}')],
    ["constructor key", { locale: "hr", constructor: "x" }],
  ])("refuses a body with other keys: %s", (_name, body) => {
    expect(parseInterfaceLocaleSetting(body)).toBeNull();
  });

  it.each([
    ["null", null],
    ["string", "hr"],
    ["number", 0],
    ["array", [{ locale: "hr" }]],
    ["undefined", undefined],
  ])("refuses a body that is not a plain object: %s", (_name, body) => {
    expect(parseInterfaceLocaleSetting(body)).toBeNull();
  });

  it("refuses an object with an inherited locale", () => {
    expect(parseInterfaceLocaleSetting(Object.create({ locale: "hr" }))).toBeNull();
  });

  it("accepts a null-prototype record and refuses a class instance", () => {
    const body = Object.assign(Object.create(null), { locale: "hr" });
    expect(parseInterfaceLocaleSetting(body)).toEqual({ locale: "hr" });
    class Box { locale = "hr"; }
    expect(parseInterfaceLocaleSetting(new Box())).toBeNull();
  });

  it("is the same set as the interface catalogues", () => {
    expect([...INTERFACE_LOCALE_SETTING_VALUES].sort()).toEqual([...INTERFACE_LOCALES].sort());
  });
});
