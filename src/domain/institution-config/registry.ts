import { parseCitationStyle, type CitationStyle } from "@/domain/citation";

import fpzgStyleFile from "../../../config/faculties/fpzg/citation.json";
import institutionsFile from "../../../config/institutions.json";

/**
 * M2.12-P02 (DAN-443): the configuration of an institution, resolved from its
 * record in `config/institutions.json` and nothing else. No institution is a
 * default: a slug without a record resolves to nothing, and the caller shows
 * its empty state (plan napada #1689, A1 to A5).
 *
 * The record names a citation style from the catalogue below, which has one
 * entry per style file, so each style keeps a single source (D-83; replaced
 * by the Lekta package in M4). Signing keys and storage domains are not
 * here: they are already per institution on the server (`docs/BACKEND.md`)
 * and never belong in a public file.
 */

export type InstitutionConfig = Readonly<{
  slug: string;
  citationStyle: Readonly<CitationStyle>;
}>;

export type InstitutionConfigResult =
  | { ok: true; config: InstitutionConfig }
  | { ok: false; reason: "unknown_institution" };

export class InstitutionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstitutionConfigError";
  }
}

export const INSTITUTIONS_FORMAT = "ductus-institutions-v1";

/** The `identity.institution.slug` CHECK, matched exactly. */
const SLUG = /^[a-z0-9-]{2,32}$/;

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/** A plain object whose own keys are exactly `keys`; inherited fields count as absent. */
function exact(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InstitutionConfigError(`${path} must be an object`);
  }
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) {
    throw new InstitutionConfigError(`${path} must have exactly the fields ${keys.join(", ")}`);
  }
  return value as Record<string, unknown>;
}

/**
 * Validates the institutions file against a style catalogue. Unknown fields,
 * a wrong format tag, a slug outside the database CHECK, a duplicate slug or
 * a style the catalogue lacks fail the whole file.
 */
export function parseInstitutionRecords(
  input: unknown,
  styles: Readonly<Record<string, CitationStyle>>,
): ReadonlyMap<string, InstitutionConfig> {
  const root = exact(input, ["format", "institutions"], "institutions file");
  if (root.format !== INSTITUTIONS_FORMAT) throw new InstitutionConfigError("unknown institutions format");
  if (!Array.isArray(root.institutions)) throw new InstitutionConfigError("institutions must be an array");
  const out = new Map<string, InstitutionConfig>();
  root.institutions.forEach((entry: unknown, i: number) => {
    const record = exact(entry, ["slug", "citationStyle"], `institutions[${i}]`);
    const { slug, citationStyle } = record;
    if (typeof slug !== "string" || !SLUG.test(slug)) throw new InstitutionConfigError(`institutions[${i}].slug is malformed`);
    if (out.has(slug)) throw new InstitutionConfigError(`institutions[${i}].slug is a duplicate`);
    if (typeof citationStyle !== "string" || !Object.hasOwn(styles, citationStyle)) {
      throw new InstitutionConfigError(`institutions[${i}].citationStyle is unknown`);
    }
    out.set(slug, deepFreeze({ slug, citationStyle: structuredClone(styles[citationStyle]) }));
  });
  return out;
}

/** One entry per style file; the key is the style file's own `faculty`. */
function styleCatalogue(): Record<string, CitationStyle> {
  const catalogue: Record<string, CitationStyle> = Object.create(null) as Record<string, CitationStyle>;
  for (const file of [fpzgStyleFile]) {
    const style = parseCitationStyle(file);
    catalogue[style.faculty] = style;
  }
  return catalogue;
}

const RECORDS = parseInstitutionRecords(institutionsFile, styleCatalogue());

/** The configuration of the institution with this slug, or `unknown_institution`. */
export function resolveInstitutionConfig(slug: unknown): InstitutionConfigResult {
  if (typeof slug !== "string") return { ok: false, reason: "unknown_institution" };
  const config = RECORDS.get(slug);
  return config ? { ok: true, config } : { ok: false, reason: "unknown_institution" };
}

/** The citation style of that institution, or null when it has no record. */
export function resolveCitationStyle(slug: unknown): Readonly<CitationStyle> | null {
  const result = resolveInstitutionConfig(slug);
  return result.ok ? result.config.citationStyle : null;
}
