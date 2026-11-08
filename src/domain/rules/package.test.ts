import { describe, expect, it } from "vitest";

import fixture from "./fixtures/synthetic-package.json";
import { parsePackageRef, parseRulePackage, type RuleContractError } from "./package";

/**
 * Table over the input classes K1 to K13 of the contract (#1091). Synthetic
 * data only: the fixture names an invented institution and example.org.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const base = (): Json => structuredClone(fixture) as Json;
const profile0 = (p: Json): Json => p.profiles[0];
const rule = (p: Json, kind: string): Json => profile0(p).rules.find((r: Json) => r.kind === kind);
const REF = { name: "primjer-pravila", version: "1.0.0", sha256: "a".repeat(64) };

class Foreign {
  format = "ductus-rule-package-v1";
}

const rows: [klass: string, name: string, edit: (p: Json) => unknown, reason: RuleContractError, path: string][] = [
  ["K2", "null package", () => null, "not_object", "package"],
  ["K2", "array package", () => [], "not_object", "package"],
  ["K2", "string package", () => "paket", "not_object", "package"],
  ["K2", "class instance", () => new Foreign(), "not_object", "package"],
  ["K14", "required field only inherited", (p) => Object.create(p), "not_object", "package"],
  ["K14", "profile field only inherited", (p) => ((p.profiles[0] = Object.create(profile0(p))), p), "not_object", "package.profiles[0]"],
  ["K2", "profile is an array", (p) => ((p.profiles[0] = []), p), "not_object", "package.profiles[0]"],
  ["K2", "source is null", (p) => ((profile0(p).sources[0] = null), p), "not_object", "package.profiles[0].sources[0]"],
  ["K2", "rule is a string", (p) => ((profile0(p).rules[0] = "x"), p), "not_object", "package.profiles[0].rules[0]"],
  ["K3", "unknown root field", (p) => ((p.extra = 1), p), "unknown_field", "package"],
  ["K3", "own __proto__ key", (p) => JSON.parse(`{"__proto__":{"x":1},${JSON.stringify(p).slice(1)}`), "unknown_field", "package"],
  ["K3", "symbol key", (p) => ((p[Symbol("s") as never] = 1), p), "unknown_field", "package"],
  ["K3", "unknown profile field", (p) => ((profile0(p).status = "x"), p), "unknown_field", "package.profiles[0]"],
  ["K3", "unknown source field", (p) => ((profile0(p).sources[0].note = "x"), p), "unknown_field", "package.profiles[0].sources[0]"],
  ["K3", "unknown rule field", (p) => ((rule(p, "font").weight = 700), p), "unknown_field", "package.profiles[0].rules[3]"],
  ["K3", "field of another rule kind", (p) => ((rule(p, "word-range").count = 1), p), "unknown_field", "package.profiles[0].rules[0]"],
  ["K4", "missing version", (p) => (delete p.version, p), "missing_field", "package.version"],
  ["K4", "missing profile label", (p) => (delete profile0(p).label, p), "missing_field", "package.profiles[0].label"],
  ["K4", "missing rule source", (p) => (delete rule(p, "min-sources").source, p), "missing_field", "package.profiles[0].rules[2].source"],
  ["K4", "missing rule kind", (p) => (delete profile0(p).rules[0].kind, p), "missing_field", "package.profiles[0].rules[0].kind"],
  ["K5", "profiles not a list", (p) => ((p.profiles = {}), p), "wrong_type", "package.profiles"],
  ["K5", "format a number", (p) => ((p.format = 1), p), "wrong_type", "package.format"],
  ["K5", "min a string", (p) => ((rule(p, "word-range").min = "6000"), p), "wrong_type", "package.profiles[0].rules[0].min"],
  ["K5", "url a number", (p) => ((profile0(p).sources[0].url = 1), p), "wrong_type", "package.profiles[0].sources[0].url"],
  ["K5", "sparse workTypes", (p) => ((profile0(p).workTypes = [, "seminar"]), p), "wrong_type", "package.profiles[0].workTypes[0]"],
  ["K6", "older format", (p) => ((p.format = "ductus-rule-package-v0"), p), "bad_format", "package.format"],
  ["K6", "unknown rule kind", (p) => ((profile0(p).rules[0].kind = "margins"), p), "bad_format", "package.profiles[0].rules[0].kind"],
  ["K6", "rule kind constructor", (p) => ((profile0(p).rules[0].kind = "constructor"), p), "bad_format", "package.profiles[0].rules[0].kind"],
  ["K7", "version not semver", (p) => ((p.version = "1.0"), p), "malformed", "package.version"],
  ["K7", "version with leading zero", (p) => ((p.version = "01.0.0"), p), "malformed", "package.version"],
  ["K7", "institution upper case", (p) => ((p.institution = "Primjer"), p), "malformed", "package.institution"],
  ["K7", "profile id with space", (p) => ((profile0(p).id = "zavrsni rad"), p), "malformed", "package.profiles[0].id"],
  ["K7", "impossible date", (p) => ((profile0(p).checkedAt = "2026-02-30"), p), "malformed", "package.profiles[0].checkedAt"],
  ["K7", "date with time", (p) => ((profile0(p).checkedAt = "2026-11-01T00:00"), p), "malformed", "package.profiles[0].checkedAt"],
  ["K8", "negative min", (p) => ((rule(p, "word-range").min = -1), p), "out_of_range", "package.profiles[0].rules[0].min"],
  ["K8", "fractional pages", (p) => ((rule(p, "page-range").max = 30.5), p), "out_of_range", "package.profiles[0].rules[1].max"],
  ["K8", "min above max", (p) => ((rule(p, "word-range").min = 9001), p), "out_of_range", "package.profiles[0].rules[0]"],
  ["K8", "words above cap", (p) => ((rule(p, "word-range").max = 500_001), p), "out_of_range", "package.profiles[0].rules[0].max"],
  ["K8", "NaN font size", (p) => ((rule(p, "font").sizePt = Number.NaN), p), "out_of_range", "package.profiles[0].rules[3].sizePt"],
  ["K8", "infinite spacing", (p) => ((rule(p, "line-spacing").value = Infinity), p), "out_of_range", "package.profiles[0].rules[4].value"],
  ["K8", "zero min sources", (p) => ((rule(p, "min-sources").count = 0), p), "out_of_range", "package.profiles[0].rules[2].count"],
  ["K8", "negative source index", (p) => ((rule(p, "font").source = -1), p), "out_of_range", "package.profiles[0].rules[3].source"],
  ["K9", "no profiles", (p) => ((p.profiles = []), p), "cardinality", "package.profiles"],
  ["K9", "65 profiles", (p) => ((p.profiles = Array.from({ length: 65 }, () => profile0(p))), p), "cardinality", "package.profiles"],
  ["K9", "no sources", (p) => ((profile0(p).sources = []), p), "cardinality", "package.profiles[0].sources"],
  ["K9", "six sources", (p) => ((profile0(p).sources = Array(6).fill(profile0(p).sources[0])), p), "cardinality", "package.profiles[0].sources"],
  ["K9", "no work types", (p) => ((profile0(p).workTypes = []), p), "cardinality", "package.profiles[0].workTypes"],
  ["K9", "no required parts", (p) => ((rule(p, "required-parts").parts = []), p), "cardinality", "package.profiles[0].rules[5].parts"],
  ["K10", "duplicate profile id", (p) => ((p.profiles = [profile0(p), profile0(p)]), p), "duplicate", "package.profiles"],
  ["K10", "duplicate work type", (p) => ((profile0(p).workTypes = ["zavrsni", "zavrsni"]), p), "duplicate", "package.profiles[0].workTypes"],
  ["K10", "duplicate rule kind", (p) => (profile0(p).rules.push({ ...rule(p, "font") }), p), "cardinality", "package.profiles[0].rules"],
  ["K10", "repeated kind within six", (p) => ((profile0(p).rules[1] = { ...rule(p, "word-range") }), p), "duplicate", "package.profiles[0].rules"],
  ["K10", "duplicate required part", (p) => ((rule(p, "required-parts").parts = ["Uvod", "Uvod"]), p), "duplicate", "package.profiles[0].rules[5].parts"],
  ["K11", "source index past end", (p) => ((rule(p, "font").source = 2), p), "dangling_source", "package.profiles[0].rules[3].source"],
  ["K12", "http url", (p) => ((profile0(p).sources[0].url = "http://example.org/a"), p), "bad_url", "package.profiles[0].sources[0].url"],
  ["K12", "javascript url", (p) => ((profile0(p).sources[0].url = "javascript:alert(1)"), p), "bad_url", "package.profiles[0].sources[0].url"],
  ["K12", "unparseable url", (p) => ((profile0(p).sources[0].url = "nije adresa"), p), "bad_url", "package.profiles[0].sources[0].url"],
  ["K12", "credentials in url", (p) => ((profile0(p).sources[0].url = "https://a:b@example.org/"), p), "bad_url", "package.profiles[0].sources[0].url"],
  ["K13", "blank label", (p) => ((profile0(p).label = "   "), p), "bad_text", "package.profiles[0].label"],
  ["K13", "label too long", (p) => ((profile0(p).label = "a".repeat(201)), p), "bad_text", "package.profiles[0].label"],
  ["K13", "control char in title", (p) => ((profile0(p).sources[0].title = "a\u0007b"), p), "bad_text", "package.profiles[0].sources[0].title"],
  ["K13", "C1 control in part", (p) => ((rule(p, "required-parts").parts = ["Uvod\u0085"]), p), "bad_text", "package.profiles[0].rules[5].parts[0]"],
];

/**
 * K3 over the keys of Object.prototype (#1747): a key only counts when it is
 * an own property. JSON.parse and defineProperty both create one, so each must
 * reject at every level; a plain assignment of a primitive to `__proto__` hits
 * the inherited setter and creates nothing.
 */
const LEVELS: [level: string, target: (p: Json) => Json][] = [
  ["package", (p) => p],
  ["package.profiles[0]", (p) => profile0(p)],
  ["package.profiles[0].sources[0]", (p) => profile0(p).sources[0]],
  ["package.profiles[0].rules[0]", (p) => profile0(p).rules[0]],
];
const PROTO_KEYS = ["__proto__", "constructor", "prototype"];

/** Rewrites the target's JSON text with the key first, as a package file would carry it. */
function viaJson(p: Json, target: (p: Json) => Json, key: string): Json {
  const marker = "markerKeyForTest";
  target(p)[marker] = 1;
  const text = JSON.stringify(p).replace(`"${marker}":1`, `${JSON.stringify(key)}:1`);
  return JSON.parse(text) as Json;
}

const protoRows = LEVELS.flatMap(([path, target]) =>
  PROTO_KEYS.flatMap((key) => [
    [path, key, "JSON.parse", (p: Json) => viaJson(p, target, key)] as const,
    [
      path,
      key,
      "defineProperty",
      (p: Json) => (Object.defineProperty(target(p), key, { value: 1, enumerable: true, writable: true, configurable: true }), p),
    ] as const,
  ]),
);

describe("parseRulePackage, keys of Object.prototype", () => {
  it.each(protoRows)("K3 %s own key %s via %s is rejected", (path, key, _how, edit) => {
    const input = edit(base());
    expect(Object.hasOwn(LEVELS.find(([l]) => l === path)![1](input), key)).toBe(true);
    expect(parseRulePackage(input)).toEqual({ ok: false, reason: "unknown_field", path });
  });

  it.each(LEVELS)("K2 %s whose prototype was replaced by assigning __proto__ is rejected", (path, target) => {
    const input = base();
    target(input).__proto__ = {};
    expect(parseRulePackage(input)).toEqual({ ok: false, reason: "not_object", path });
  });

  it.each(LEVELS)("K1 %s: assigning a primitive to __proto__ adds no key, so the package still passes", (_path, target) => {
    const input = base();
    target(input).__proto__ = 1;
    expect(Object.hasOwn(target(input), "__proto__")).toBe(false);
    expect(parseRulePackage(input)).toEqual({ ok: true, value: fixture });
  });
});

describe("parseRulePackage", () => {
  it("K1: accepts the synthetic fixture and returns an equal, frozen copy", () => {
    const input = base();
    const result = parseRulePackage(input);
    expect(result).toEqual({ ok: true, value: fixture });
    if (!result.ok) return;
    expect(result.value).not.toBe(input);
    expect(Object.isFrozen(result.value.profiles[0]?.rules[5])).toBe(true);
  });

  it("K1: a change to the input after the check does not reach the result", () => {
    const input = base();
    const result = parseRulePackage(input);
    profile0(input).rules[0].max = 1;
    profile0(input).sources[0].url = "http://example.org/";
    expect(result).toEqual({ ok: true, value: fixture });
  });

  it.each(rows)("%s %s is rejected", (_k, _name, edit, reason, path) => {
    expect(parseRulePackage(edit(base()))).toEqual({ ok: false, reason, path });
  });
});

describe("parsePackageRef", () => {
  it("K1: accepts a well formed ref", () => {
    expect(parsePackageRef({ ...REF })).toEqual({ ok: true, value: REF });
  });

  it.each<[string, unknown, RuleContractError, string]>([
    ["K2 null", null, "not_object", "ref"],
    ["K3 unknown field", { ...REF, channel: "npm" }, "unknown_field", "ref"],
    ["K4 missing sha256", { name: REF.name, version: REF.version }, "missing_field", "ref.sha256"],
    ["K5 version number", { ...REF, version: 1 }, "wrong_type", "ref.version"],
    ["K7 upper case sha256", { ...REF, sha256: "A".repeat(64) }, "malformed", "ref.sha256"],
    ["K7 short sha256", { ...REF, sha256: "a".repeat(63) }, "malformed", "ref.sha256"],
    ["K7 prerelease version", { ...REF, version: "1.0.0-rc.1" }, "malformed", "ref.version"],
  ])("%s is rejected", (_name, input, reason, path) => {
    expect(parsePackageRef(input)).toEqual({ ok: false, reason, path });
  });
});
