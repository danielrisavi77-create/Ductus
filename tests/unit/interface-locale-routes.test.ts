import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  INTERFACE_LOCALE_SETTING_VALUES,
  parseInterfaceLocaleSetting,
} from "@/domain/profile/interface-locale-setting";
import { INTERFACE_LOCALES } from "@/lib/i18n/locale";

// DAN-427: the migration's CHECK, the body parser and the interface's
// locales are one contract; a value one accepts and another refuses is a
// setting lost or a language the screen cannot show.
const ROOT = join(import.meta.dirname, "..", "..");
const MIGRATION = readFileSync(join(ROOT, "db/migrations/20261112170000_interface_locale.sql"), "utf8");
const UP = MIGRATION.slice(0, MIGRATION.indexOf("-- migrate:down"));
// The statements without their comments, which may name what is left out.
const CODE = UP.replace(/--[^\n]*/g, "");

function checkSet(column: string): string[] {
  const match = new RegExp(`\\n  ${column} text[^\\n]*CHECK \\(${column} IN \\(([^)]*)\\)`, "s").exec(UP);
  if (!match?.[1]) throw new Error(`no CHECK set for ${column}`);
  return [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1] ?? "");
}

describe("DAN-427 interface locale: migration, parser and interface agree", () => {
  it("the CHECK set, the parser's set and INTERFACE_LOCALES are the same", () => {
    expect(checkSet("interface_locale")).toEqual([...INTERFACE_LOCALES]);
    expect([...INTERFACE_LOCALE_SETTING_VALUES]).toEqual([...INTERFACE_LOCALES]);
  });

  it("the parser accepts every member of the CHECK set", () => {
    for (const locale of checkSet("interface_locale")) {
      expect(parseInterfaceLocaleSetting({ locale })).toEqual({ locale });
    }
  });

  it("the migration adds no column to user_account and names no work language", () => {
    expect(CODE).not.toMatch(/ALTER TABLE identity\.user_account/i);
    expect(CODE).not.toMatch(/UPDATE identity\.user_account/i);
    expect(CODE).not.toMatch(/work_language|document_language|language_code/i);
  });

  it("the route sends the RPCs by their full names", () => {
    const route = readFileSync(join(ROOT, "src/server/profile/interface-locale-route.ts"), "utf8");
    expect(route).toContain("identity.set_interface_locale($1)");
    expect(route).toContain("identity.interface_locale()");
  });
});
