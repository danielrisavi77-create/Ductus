import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MIGRATION, readRule, report } from "@/server/db/plain-label-check";

// The check before the stricter is_plain_label (#446) reads its rule from the
// migration; anything it does not recognise stops it instead of checking a
// different rule. The database cases are in
// tests/integration/plain-label-check.integration.test.ts.
const TEXT = readFileSync(new URL(`../../db/migrations/${MIGRATION}`, import.meta.url), "utf8");
const DOWN = TEXT.indexOf("-- migrate:down");
const UP = TEXT.slice(0, DOWN);

describe("readRule", () => {
  it("reads the rule of the up section and the three guarded columns", () => {
    const { body, targets } = readRule(TEXT);
    expect(body).toMatch(/^SELECT length\(p_text\) BETWEEN 1 AND 200/);
    // The up section refuses tag characters and U+034F; the down section's older rule does not.
    expect(body).toContain("\\x034F\\x061C");
    expect(body).toContain("\\U000E0000-\\U000E007F]'");
    expect(targets).toEqual([
      { table: "course", column: "name" },
      { table: "institution_settings", column: "display_name" },
      { table: "assignment_version", column: "title" },
    ]);
  });

  it.each([
    ["no definition in the up section", UP.replace("CREATE OR REPLACE FUNCTION", "CREATE FUNCTION") + TEXT.slice(DOWN)],
    ["two definitions in the up section", UP + UP.slice(UP.indexOf("CREATE OR REPLACE")) + TEXT.slice(DOWN)],
    ["no guard over stored names", UP.replaceAll("WHERE NOT institution.is_plain_label", "WHERE NOT x") + TEXT.slice(DOWN)],
    ["a body that reads a table", TEXT.replace("SELECT length(p_text)", "SELECT 1 FROM t WHERE length(p_text)")],
    ["a body with a second statement", TEXT.replace("SELECT length(p_text)", "SELECT 1; SELECT length(p_text)")],
    ["no down section", UP],
    ["the down section first", TEXT.slice(DOWN) + UP],
  ])("stops on %s", (_, text) => {
    expect(() => readRule(text)).toThrow();
  });
});

describe("report", () => {
  it("names table, column and key and says when nothing would stop the migration", () => {
    expect(report([])).toBe(`No stored name would stop ${MIGRATION}.`);
    expect(report([{ table: "institution.course", column: "name", id: "id=00000000-0000-4000-8000-000000000001" }])).toBe(
      `1 stored name(s) would stop ${MIGRATION}:\ninstitution.course\tname\tid=00000000-0000-4000-8000-000000000001`,
    );
  });
});
