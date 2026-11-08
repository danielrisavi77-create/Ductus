import { hasOnlyKeys, isPlainObject, ownProperty } from "../json";

/**
 * C04 (M4.2-P02, DAN-392): the shape of a rule package as Ductus consumes it.
 *
 * Only what `docs/lekta/RIGHTSSCOPE.md` §3 lets into the projection: one
 * institution, its profiles (id, label, work types, date checked, at most
 * five official sources) and form rules as plain values, each pointing at
 * the official source it comes from (D-126). Citation style and title page
 * are not in v1. Nothing here depends on Lekta's code, package name,
 * delivery channel or licence, none of which is decided yet (Q-11); loading
 * a real package and checking its hash is M4.3 (DAN-393).
 *
 * Every level is a closed set of fields: an unknown, missing or mistyped
 * field rejects the whole package. The result is a frozen copy, never the
 * input, so changing the input after the check changes nothing.
 */

export const RULE_PACKAGE_FORMAT = "ductus-rule-package-v1";

export type PackageRef = Readonly<{ name: string; version: string; sha256: string }>;

export type RuleSource = Readonly<{ title: string; url: string }>;

export type FormRule = Readonly<
  | { kind: "word-range"; min: number; max: number; source: number }
  | { kind: "page-range"; min: number; max: number; source: number }
  | { kind: "min-sources"; count: number; source: number }
  | { kind: "font"; family: string; sizePt: number; source: number }
  | { kind: "line-spacing"; value: number; source: number }
  | { kind: "required-parts"; parts: readonly string[]; source: number }
>;

export type RuleProfile = Readonly<{
  id: string;
  label: string;
  workTypes: readonly string[];
  checkedAt: string;
  sources: readonly RuleSource[];
  rules: readonly FormRule[];
}>;

export type RulePackage = Readonly<{
  format: typeof RULE_PACKAGE_FORMAT;
  name: string;
  version: string;
  institution: string;
  profiles: readonly RuleProfile[];
}>;

export type RuleContractError =
  | "not_object"
  | "unknown_field"
  | "missing_field"
  | "wrong_type"
  | "bad_format"
  | "malformed"
  | "out_of_range"
  | "cardinality"
  | "duplicate"
  | "dangling_source"
  | "bad_url"
  | "bad_text";

export type RuleContractResult<T> =
  | { ok: true; value: T }
  | { ok: false; path: string; reason: RuleContractError };

export const LIMITS = Object.freeze({
  profiles: 64,
  workTypes: 16,
  sources: 5,
  parts: 32,
  text: 200,
  url: 2048,
  words: 500_000,
  pages: 2_000,
  minSources: 1_000,
});

const NAME = /^[a-z0-9][a-z0-9-]{1,63}$/;
const SLUG = /^[a-z0-9-]{2,32}$/;
const SEMVER = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// C0 controls, DEL and C1 controls.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

class Reject extends Error {
  constructor(
    readonly path: string,
    readonly reason: RuleContractError,
  ) {
    super(`${path}: ${reason}`);
  }
}

function fields(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Reject(path, "not_object");
  if (!hasOnlyKeys(value, new Set(keys))) throw new Reject(path, "unknown_field");
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new Reject(`${path}.${key}`, "missing_field");
  }
  return value;
}

function list(value: unknown, min: number, max: number, path: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Reject(path, "wrong_type");
  }
  if (value.length < min || value.length > max) throw new Reject(path, "cardinality");
  return Array.from({ length: value.length }, (_, i) => ownProperty(value as never, String(i)));
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Reject(path, "wrong_type");
  if (value.trim().length === 0 || value.length > LIMITS.text || CONTROL.test(value)) {
    throw new Reject(path, "bad_text");
  }
  return value;
}

function pattern(value: unknown, re: RegExp, path: string): string {
  if (typeof value !== "string") throw new Reject(path, "wrong_type");
  if (!re.test(value)) throw new Reject(path, "malformed");
  return value;
}

function date(value: unknown, path: string): string {
  const s = pattern(value, DATE, path);
  const [, y, m, d] = DATE.exec(s) as RegExpExecArray;
  const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (parsed.toISOString().slice(0, 10) !== s) throw new Reject(path, "malformed");
  return s;
}

function num(value: unknown, lo: number, hi: number, integer: boolean, path: string): number {
  if (typeof value !== "number") throw new Reject(path, "wrong_type");
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < lo || value > hi) {
    throw new Reject(path, "out_of_range");
  }
  return value;
}

function url(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Reject(path, "wrong_type");
  if (value.length > LIMITS.url || CONTROL.test(value) || !URL.canParse(value)) throw new Reject(path, "bad_url");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    throw new Reject(path, "bad_url");
  }
  return value;
}

function unique(values: readonly string[], path: string): readonly string[] {
  if (new Set(values).size !== values.length) throw new Reject(path, "duplicate");
  return values;
}

function range(r: Record<string, unknown>, hi: number, path: string): { min: number; max: number } {
  const min = num(r.min, 0, hi, true, `${path}.min`);
  const max = num(r.max, 1, hi, true, `${path}.max`);
  if (min > max) throw new Reject(path, "out_of_range");
  return { min, max };
}

function rule(value: unknown, sources: number, path: string): FormRule {
  if (!isPlainObject(value)) throw new Reject(path, "not_object");
  const kind = ownProperty(value, "kind");
  if (typeof kind !== "string") throw new Reject(`${path}.kind`, kind === undefined ? "missing_field" : "wrong_type");
  const at = (keys: readonly string[]) => fields(value, ["kind", ...keys, "source"], path);
  let out: FormRule;
  let r: Record<string, unknown>;
  switch (kind) {
    case "word-range":
    case "page-range":
      r = at(["min", "max"]);
      out = { kind, ...range(r, kind === "word-range" ? LIMITS.words : LIMITS.pages, path), source: 0 };
      break;
    case "min-sources":
      r = at(["count"]);
      out = { kind, count: num(r.count, 1, LIMITS.minSources, true, `${path}.count`), source: 0 };
      break;
    case "font":
      r = at(["family", "sizePt"]);
      out = { kind, family: text(r.family, `${path}.family`), sizePt: num(r.sizePt, 6, 72, false, `${path}.sizePt`), source: 0 };
      break;
    case "line-spacing":
      r = at(["value"]);
      out = { kind, value: num(r.value, 1, 3, false, `${path}.value`), source: 0 };
      break;
    case "required-parts":
      r = at(["parts"]);
      out = {
        kind,
        parts: unique(list(r.parts, 1, LIMITS.parts, `${path}.parts`).map((p, i) => text(p, `${path}.parts[${i}]`)), `${path}.parts`),
        source: 0,
      };
      break;
    default:
      throw new Reject(`${path}.kind`, "bad_format");
  }
  const source = num(r.source, 0, Number.MAX_SAFE_INTEGER, true, `${path}.source`);
  if (source >= sources) throw new Reject(`${path}.source`, "dangling_source");
  return { ...out, source };
}

function profile(value: unknown, path: string): RuleProfile {
  const p = fields(value, ["id", "label", "workTypes", "checkedAt", "sources", "rules"], path);
  const sources = list(p.sources, 1, LIMITS.sources, `${path}.sources`).map((s, i) => {
    const f = fields(s, ["title", "url"], `${path}.sources[${i}]`);
    return { title: text(f.title, `${path}.sources[${i}].title`), url: url(f.url, `${path}.sources[${i}].url`) };
  });
  const rules = list(p.rules, 1, 6, `${path}.rules`).map((r, i) => rule(r, sources.length, `${path}.rules[${i}]`));
  unique(rules.map((r) => r.kind), `${path}.rules`);
  return {
    id: pattern(p.id, NAME, `${path}.id`),
    label: text(p.label, `${path}.label`),
    workTypes: unique(
      list(p.workTypes, 1, LIMITS.workTypes, `${path}.workTypes`).map((w, i) => pattern(w, NAME, `${path}.workTypes[${i}]`)),
      `${path}.workTypes`,
    ),
    checkedAt: date(p.checkedAt, `${path}.checkedAt`),
    sources,
    rules,
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

function run<T>(build: () => T): RuleContractResult<T> {
  try {
    return { ok: true, value: deepFreeze(build()) };
  } catch (error) {
    if (error instanceof Reject) return { ok: false, path: error.path, reason: error.reason };
    throw error;
  }
}

export function parsePackageRef(input: unknown): RuleContractResult<PackageRef> {
  return run(() => {
    const r = fields(input, ["name", "version", "sha256"], "ref");
    return {
      name: pattern(r.name, NAME, "ref.name"),
      version: pattern(r.version, SEMVER, "ref.version"),
      sha256: pattern(r.sha256, SHA256, "ref.sha256"),
    };
  });
}

export function parseRulePackage(input: unknown): RuleContractResult<RulePackage> {
  return run(() => {
    const p = fields(input, ["format", "name", "version", "institution", "profiles"], "package");
    if (typeof p.format !== "string") throw new Reject("package.format", "wrong_type");
    if (p.format !== RULE_PACKAGE_FORMAT) throw new Reject("package.format", "bad_format");
    const profiles = list(p.profiles, 1, LIMITS.profiles, "package.profiles").map((x, i) =>
      profile(x, `package.profiles[${i}]`),
    );
    unique(profiles.map((x) => x.id), "package.profiles");
    return {
      format: RULE_PACKAGE_FORMAT,
      name: pattern(p.name, NAME, "package.name"),
      version: pattern(p.version, SEMVER, "package.version"),
      institution: pattern(p.institution, SLUG, "package.institution"),
      profiles,
    };
  });
}
