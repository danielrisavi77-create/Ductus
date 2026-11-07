import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CURRENT_PURPOSE_CATALOG_VERSION,
  PURPOSE_CATALOG_VERSIONS,
  defaultPurposes,
  parsePurpose,
  purposeCatalog,
  type PurposeEntry,
} from "./purpose-catalog";

// The five keys the database CHECKs and AI_PURPOSES already accept (D-80 t. 1).
// Version 1 is pinned to them: changing it is a new version, never an edit.
const EXISTING_FIVE = ["formatting", "proofreading", "literature_search", "transcription", "translation"];
const LEVEL_2_V2 = ["explanation", "brainstorming", "restructuring", "example_generation", "data_coding"];

function catalog(version: number): readonly PurposeEntry[] {
  const result = purposeCatalog(version);
  if (!result.ok) throw new Error(`version ${version} must exist`);
  return result.purposes;
}

const allEntries = PURPOSE_CATALOG_VERSIONS.flatMap((version) =>
  catalog(version).map((entry) => ({ version, entry })),
);

describe("purpose catalogue versions", () => {
  it("knows versions 1 and 2, and 2 is current", () => {
    expect(PURPOSE_CATALOG_VERSIONS).toEqual([1, 2]);
    expect(CURRENT_PURPOSE_CATALOG_VERSION).toBe(2);
  });

  it("pins version 1 to the existing five, all level 1", () => {
    expect(catalog(1)).toEqual(EXISTING_FIVE.map((key) => ({ key, level: 1, enabledByDefault: true })));
  });

  it("gives version 2 ten purposes: the existing five at level 1, five at level 2 (D-268 O2)", () => {
    const v2 = catalog(2);
    expect(v2).toHaveLength(10);
    expect(v2.filter((e) => e.level === 1).map((e) => e.key)).toEqual(EXISTING_FIVE);
    expect(v2.filter((e) => e.level === 2).map((e) => e.key)).toEqual(LEVEL_2_V2);
  });

  it.each(PURPOSE_CATALOG_VERSIONS)("version %i has unique keys", (version) => {
    const keys = catalog(version).map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(PURPOSE_CATALOG_VERSIONS.slice(1))("version %i keeps every purpose of the previous version at the same level", (version) => {
    const next = new Map(catalog(version).map((e) => [e.key, e]));
    for (const entry of catalog(version - 1)) expect(next.get(entry.key)).toEqual(entry);
  });

  it.each(PURPOSE_CATALOG_VERSIONS)("version %i is deeply frozen", (version) => {
    const result = purposeCatalog(version);
    if (!result.ok) throw new Error("unreachable");
    expect(Object.isFrozen(result.purposes)).toBe(true);
    for (const entry of result.purposes) expect(Object.isFrozen(entry)).toBe(true);
    expect(() => (result.purposes as PurposeEntry[]).push({ key: "x", level: 1, enabledByDefault: true })).toThrow(TypeError);
  });
});

describe("every purpose of every version", () => {
  it.each(allEntries)("v$version $entry.key: on by default exactly at level 1", ({ entry }) => {
    expect(entry.enabledByDefault).toBe(entry.level === 1);
  });

  it.each(allEntries)("v$version $entry.key parses in its own version", ({ version, entry }) => {
    expect(parsePurpose(version, entry.key)).toEqual({ ok: true, version, purpose: entry });
  });

  it.each(PURPOSE_CATALOG_VERSIONS)("version %i: explanation, when present, is level 2 and off by default", (version) => {
    const explanation = catalog(version).find((e) => e.key === "explanation");
    if (explanation) expect(explanation).toEqual({ key: "explanation", level: 2, enabledByDefault: false });
  });

  it.each(PURPOSE_CATALOG_VERSIONS)("version %i: default purposes are exactly the level 1 keys", (version) => {
    expect(defaultPurposes(version)).toEqual({
      ok: true,
      version,
      keys: catalog(version).filter((e) => e.level === 1).map((e) => e.key),
    });
  });
});

const unknownVersions: unknown[] = [0, 3, -1, -0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1", "2", null, undefined, true, [1], {}, 1n, new Number(1)];

describe("unknown version", () => {
  it.each(unknownVersions.map((v) => [String(v), v]))("rejects %s", (_label, version) => {
    const reason = { ok: false, reason: "unknown_version" };
    expect(purposeCatalog(version)).toEqual(reason);
    expect(defaultPurposes(version)).toEqual(reason);
    expect(parsePurpose(version, "proofreading")).toEqual(reason);
  });

  it("rejects every value that is not 1 or 2", () => {
    fc.assert(
      fc.property(fc.anything({ withBigInt: true, withBoxedValues: true }).filter((v) => v !== 1 && v !== 2), (version) => {
        expect(purposeCatalog(version)).toEqual({ ok: false, reason: "unknown_version" });
        expect(parsePurpose(version, "proofreading")).toEqual({ ok: false, reason: "unknown_version" });
      }),
    );
  });
});

const unknownPurposes: [number, unknown][] = [
  [1, "explanation"], [1, "brainstorming"], [1, "data_coding"],
  [2, "Proofreading"], [2, "PROOFREADING"], [2, " proofreading"], [2, "proofreading "], [2, "proofreading\n"],
  [2, ""], [2, "__proto__"], [2, "constructor"], [2, "toString"], [2, "hasOwnProperty"], [2, "valueOf"],
  [2, "prоofreading"], [2, "literature-search"], [2, "objašnjenje pojma"],
  [2, 0], [2, null], [2, undefined], [2, ["proofreading"]], [2, { toString: () => "proofreading" }], [2, new String("proofreading")],
];

describe("unknown purpose", () => {
  it.each(unknownPurposes.map(([v, k]) => [v, JSON.stringify(k) ?? String(k), k]))("v%i rejects %s", (version, _label, key) => {
    expect(parsePurpose(version as number, key)).toEqual({ ok: false, reason: "unknown_purpose" });
  });

  it.each(PURPOSE_CATALOG_VERSIONS)("version %i rejects every string that is not one of its keys", (version) => {
    const keys = new Set(catalog(version).map((e) => e.key));
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string({ unit: "grapheme" }), fc.constantFrom(...keys).map((k) => k + "x")).filter((s) => !keys.has(s)), (key) => {
        expect(parsePurpose(version, key)).toEqual({ ok: false, reason: "unknown_purpose" });
      }),
    );
  });

  it("rejects every non-string key", () => {
    fc.assert(
      fc.property(fc.anything({ withBoxedValues: true }).filter((v) => typeof v !== "string"), (key) => {
        expect(parsePurpose(2, key)).toEqual({ ok: false, reason: "unknown_purpose" });
      }),
    );
  });
});
