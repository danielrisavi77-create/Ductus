import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// DAN-343 (contract on #896): the v3 migration changes two lines of the live
// descriptor validator and acceptance, and copies everything else. The copies
// are checked here instead of by eye, on the way up and on the way down.
const DIRECTORY = new URL("../../db/migrations/", import.meta.url);
const V3_NAME = "20261028000000_evidence_segment_v3.sql";

function migration(name: string): string {
  return readFileSync(new URL(name, DIRECTORY), "utf8");
}
function upOf(text: string): string {
  const down = text.indexOf("-- migrate:down");
  return down < 0 ? text : text.slice(0, down);
}
function downOf(text: string): string {
  const down = text.indexOf("-- migrate:down");
  expect(down).toBeGreaterThanOrEqual(0);
  return text.slice(down);
}

const VALIDATOR = "FUNCTION evidence.validate_segment_descriptor_v2(";
const ACCEPTANCE = "FUNCTION app.commit_evidence_segment(";

/** The one definition of `name` in `text`, from CREATE to the closing `$$;`. */
function definitionOf(text: string, name: string): string {
  const starts = [`CREATE ${name}`, `CREATE OR REPLACE ${name}`].flatMap((header) => {
    const found: number[] = [];
    for (let at = text.indexOf(header); at >= 0; at = text.indexOf(header, at + 1)) found.push(at);
    return found;
  });
  expect(starts).toHaveLength(1);
  const end = text.indexOf("\n$$;", starts[0]);
  expect(end).toBeGreaterThan(starts[0]);
  return text.slice(starts[0], end + "\n$$;".length);
}

const asReplace = (text: string) => text.replace(/^CREATE FUNCTION /, "CREATE OR REPLACE FUNCTION ");

const LIVE_VALIDATOR = asReplace(
  definitionOf(upOf(migration("20261014140000_evidence_descriptor_v2.sql")), VALIDATOR),
);
const LIVE_ACCEPTANCE = asReplace(
  definitionOf(upOf(migration("20261019170000_evidence_acceptance_signature.sql")), ACCEPTANCE),
);
const V3 = migration(V3_NAME);

const SCHEMA_V2_ONLY = "     OR p_descriptor->>'evidenceSchema' <> 'ductus-evidence-segment-v2'\n";
const SCHEMA_V2_OR_V3 =
  "     OR p_descriptor->>'evidenceSchema' NOT IN ('ductus-evidence-segment-v2', 'ductus-evidence-segment-v3')\n";
const RECEIPT_FIXED_V2 = "    'evidenceSchema', 'ductus-evidence-segment-v2',\n";
const RECEIPT_FROM_DESCRIPTOR = "    'evidenceSchema', p_descriptor->>'evidenceSchema',\n";

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe("evidence segment v3 migration", () => {
  it("copies the latest definition of each function before it", () => {
    const earlier = readdirSync(DIRECTORY)
      .filter((name) => name.endsWith(".sql") && name < V3_NAME)
      .sort();
    const lastDefining = (name: string) =>
      earlier.filter((file) => upOf(migration(file)).includes(name)).at(-1);
    expect(lastDefining(`CREATE ${VALIDATOR}`)).toBe("20261014140000_evidence_descriptor_v2.sql");
    expect(earlier.some((file) => upOf(migration(file)).includes(`CREATE OR REPLACE ${VALIDATOR}`))).toBe(false);
    expect(lastDefining(`CREATE ${ACCEPTANCE}`)).toBe(
      "20261019170000_evidence_acceptance_signature.sql",
    );
    expect(earlier.some((file) => upOf(migration(file)).includes(`CREATE OR REPLACE ${ACCEPTANCE}`))).toBe(false);
  });

  it("changes exactly the schema line of the validator on the way up", () => {
    expect(occurrences(LIVE_VALIDATOR, SCHEMA_V2_ONLY)).toBe(1);
    expect(definitionOf(upOf(V3), VALIDATOR)).toBe(LIVE_VALIDATOR.replace(SCHEMA_V2_ONLY, SCHEMA_V2_OR_V3));
  });

  it("changes exactly the receipt schema line of the acceptance on the way up", () => {
    expect(occurrences(LIVE_ACCEPTANCE, RECEIPT_FIXED_V2)).toBe(1);
    expect(definitionOf(upOf(V3), ACCEPTANCE)).toBe(LIVE_ACCEPTANCE.replace(RECEIPT_FIXED_V2, RECEIPT_FROM_DESCRIPTOR));
  });

  it("restores both live definitions verbatim on the way down", () => {
    expect(definitionOf(downOf(V3), VALIDATOR)).toBe(LIVE_VALIDATOR);
    expect(definitionOf(downOf(V3), ACCEPTANCE)).toBe(LIVE_ACCEPTANCE);
  });

  it("defines nothing else and leaves owner and grants alone", () => {
    for (const part of [upOf(V3), downOf(V3)]) {
      expect(part.match(/^CREATE /gm)).toHaveLength(2);
      expect(part.match(/^CREATE OR REPLACE FUNCTION /gm)).toHaveLength(2);
      expect(part).not.toMatch(/\bDROP\b|\bALTER\b|GRANT EXECUTE|REVOKE ALL|OWNER TO|SECURITY INVOKER/);
    }
  });
});
