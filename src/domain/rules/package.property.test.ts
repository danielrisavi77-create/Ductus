import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { parseRulePackage, RULE_PACKAGE_FORMAT } from "./package";

/**
 * Properties over the input classes of the contract (#1091): every generated
 * valid package passes unchanged (K1), and one unknown field, one missing
 * field or one mistyped value on an object of any level (root, profile, source,
 * rule; each drawn evenly) rejects the whole package (K3, K4, K5). Each run
 * works on its own clone: fast-check reuses a generated value while shrinking.
 * Synthetic values only.
 */

type Node = Record<string, unknown>;

const slug = fc.stringMatching(/^[a-z0-9][a-z0-9-]{1,20}$/);
const label = fc.stringMatching(/^[A-Za-zčćžšđ][A-Za-zčćžšđ ]{0,30}$/);
const source = fc.record({ title: label, url: slug.map((s) => `https://example.org/${s}`) });

const rules = (sources: number) => {
  const at = fc.nat({ max: sources - 1 });
  const pair = (hi: number) => fc.tuple(fc.nat({ max: hi }), fc.nat({ max: hi })).map(([a, b]) => [Math.min(a, b), Math.max(a, b, 1)]);
  const all = [
    fc.tuple(pair(500_000), at).map(([[min, max], s]) => ({ kind: "word-range", min, max, source: s })),
    fc.tuple(pair(2_000), at).map(([[min, max], s]) => ({ kind: "page-range", min, max, source: s })),
    fc.tuple(fc.integer({ min: 1, max: 1_000 }), at).map(([count, s]) => ({ kind: "min-sources", count, source: s })),
    fc.tuple(label, fc.double({ min: 6, max: 72, noNaN: true }), at).map(([family, sizePt, s]) => ({ kind: "font", family, sizePt, source: s })),
    fc.tuple(fc.double({ min: 1, max: 3, noNaN: true }), at).map(([value, s]) => ({ kind: "line-spacing", value, source: s })),
    fc.tuple(fc.uniqueArray(label, { minLength: 1, maxLength: 5 }), at).map(([parts, s]) => ({ kind: "required-parts", parts, source: s })),
  ];
  return fc.subarray(all, { minLength: 1 }).chain((picked) => fc.tuple(...picked));
};

const profile = fc.array(source, { minLength: 1, maxLength: 5 }).chain((sources) =>
  fc.record({
    id: slug,
    label,
    workTypes: fc.uniqueArray(slug, { minLength: 1, maxLength: 4 }),
    checkedAt: fc.date({ min: new Date("2020-01-01"), max: new Date("2030-12-31"), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10)),
    sources: fc.constant(sources),
    rules: rules(sources.length),
  }),
);

const rulePackage = fc.record({
  format: fc.constant(RULE_PACKAGE_FORMAT),
  name: slug,
  version: fc.tuple(fc.nat(99), fc.nat(99), fc.nat(99)).map((v) => v.join(".")),
  institution: fc.stringMatching(/^[a-z0-9-]{2,32}$/),
  profiles: fc.uniqueArray(profile, { minLength: 1, maxLength: 4, selector: (p) => p.id }),
});

const pick = <T,>(items: readonly T[], at: number): T => items[at % items.length] as T;

type Pkg = Node & { profiles: (Node & { sources: Node[]; rules: Node[] })[] };

/** The objects of one level: the root, the profiles, the sources or the rules. */
const LEVELS = ["package", "profile", "source", "rule"] as const;
function level(pkg: Pkg, name: (typeof LEVELS)[number]): Node[] {
  if (name === "package") return [pkg];
  if (name === "profile") return pkg.profiles;
  return pkg.profiles.flatMap((p) => (name === "source" ? p.sources : p.rules));
}

/** Every level is drawn evenly, so the root is hit as often as a rule. */
const node = fc.constantFrom(...LEVELS);
const objectAt = (pkg: unknown, name: (typeof LEVELS)[number], at: number): Node => pick(level(pkg as Pkg, name), at);

/** Any short name, plus the keys of Object.prototype a validator may trip on. */
const PROTO_KEYS = ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty", "valueOf"] as const;
const unknownKey = fc.oneof(fc.stringMatching(/^[a-zA-Z_]{1,12}$/), fc.constantFrom(...PROTO_KEYS));

describe("parseRulePackage property", () => {
  it("K1: every generated valid package passes and comes back equal", () => {
    fc.assert(
      fc.property(rulePackage, (pkg) => {
        expect(parseRulePackage(pkg)).toEqual({ ok: true, value: pkg });
      }),
    );
  });

  /**
   * The key is added as an own data property, as JSON.parse would: a plain
   * `target[key] = 1` with `__proto__` only calls the inherited setter, adds no
   * key, and the still valid package passes (#1747, seed 2027008327).
   */
  const k3 = fc.property(rulePackage, node, fc.nat(), unknownKey, (generated, lvl, at, key) => {
    const pkg = structuredClone(generated);
    const target = objectAt(pkg, lvl, at);
    fc.pre(!Object.hasOwn(target, key));
    Object.defineProperty(target, key, { value: 1, enumerable: true, writable: true, configurable: true });
    expect(Object.hasOwn(target, key)).toBe(true);
    expect(parseRulePackage(pkg)).toMatchObject({ ok: false, reason: "unknown_field" });
  });

  it("K3: an unknown field on any object rejects the package", () => {
    fc.assert(k3);
  });

  it("K3: the run that found #1747 (seed 2027008327) rejects", () => {
    fc.assert(k3, { seed: 2027008327 });
  });

  it("K4: removing any field of any object rejects the package", () => {
    fc.assert(
      fc.property(rulePackage, node, fc.nat(), fc.nat(), (generated, lvl, at, field) => {
        const pkg = structuredClone(generated);
        const target = objectAt(pkg, lvl, at);
        delete target[pick(Object.keys(target), field)];
        expect(parseRulePackage(pkg)).toMatchObject({ ok: false, reason: "missing_field" });
      }),
    );
  });

  it("K5: a value of the wrong type in any field rejects the package", () => {
    fc.assert(
      fc.property(rulePackage, node, fc.nat(), fc.nat(), (generated, lvl, at, field) => {
        const pkg = structuredClone(generated);
        const target = objectAt(pkg, lvl, at);
        const key = pick(Object.keys(target), field);
        target[key] = typeof target[key] === "boolean" ? "x" : true;
        expect(parseRulePackage(pkg).ok).toBe(false);
      }),
    );
  });
});
