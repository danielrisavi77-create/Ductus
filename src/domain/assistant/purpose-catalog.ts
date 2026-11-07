/**
 * The versioned catalogue of AI assistant purposes (DAN-402, M9.3-P01a).
 *
 * Version 1 is the closed list of five FPZG čl. 8 purposes (D-80 t. 1) that
 * assignments and the database CHECKs already use; tasks set on it keep it.
 * Version 2 (D-268 O2) has ten: those five at level 1, on by default, and five
 * at level 2, which a teacher has to switch on, among them "explanation"
 * (objašnjenje pojma). A version never changes once released: a different
 * list is a new version.
 *
 * Pure data and lookups. No UI text (the Croatian labels live in the i18n
 * catalogue), no database, no provider calls.
 */

export type PurposeLevel = 1 | 2;

export interface PurposeEntry {
  readonly key: string;
  readonly level: PurposeLevel;
  /** True exactly for level 1 (D-64): a teacher switches level 2 on per task. */
  readonly enabledByDefault: boolean;
}

export type PurposeCatalogVersion = 1 | 2;

export type CatalogFailure = { readonly ok: false; readonly reason: "unknown_version" | "unknown_purpose" };

const LEVEL_1 = ["formatting", "proofreading", "literature_search", "transcription", "translation"] as const;
const LEVEL_2_V2 = ["explanation", "brainstorming", "restructuring", "example_generation", "data_coding"] as const;

function entries(keys: readonly string[], level: PurposeLevel): PurposeEntry[] {
  return keys.map((key) => Object.freeze({ key, level, enabledByDefault: level === 1 }));
}

const CATALOGUES: ReadonlyMap<PurposeCatalogVersion, readonly PurposeEntry[]> = new Map([
  [1, Object.freeze(entries(LEVEL_1, 1))],
  [2, Object.freeze([...entries(LEVEL_1, 1), ...entries(LEVEL_2_V2, 2)])],
]);

export const PURPOSE_CATALOG_VERSIONS: readonly PurposeCatalogVersion[] = Object.freeze([1, 2]);
export const CURRENT_PURPOSE_CATALOG_VERSION: PurposeCatalogVersion = 2;

const UNKNOWN_VERSION: CatalogFailure = Object.freeze({ ok: false, reason: "unknown_version" });
const UNKNOWN_PURPOSE: CatalogFailure = Object.freeze({ ok: false, reason: "unknown_purpose" });

// Only the primitive numbers 1 and 2: no strings, boxed numbers or bigints.
function catalogueOf(version: unknown): readonly PurposeEntry[] | undefined {
  if (typeof version !== "number") return undefined;
  return CATALOGUES.get(version as PurposeCatalogVersion);
}

export function purposeCatalog(
  version: unknown,
): { readonly ok: true; readonly version: PurposeCatalogVersion; readonly purposes: readonly PurposeEntry[] } | CatalogFailure {
  const purposes = catalogueOf(version);
  return purposes ? { ok: true, version: version as PurposeCatalogVersion, purposes } : UNKNOWN_VERSION;
}

/**
 * The purpose with exactly this key in exactly this version. An unknown
 * version wins over an unknown key; a key from another version is unknown.
 */
export function parsePurpose(
  version: unknown,
  key: unknown,
): { readonly ok: true; readonly version: PurposeCatalogVersion; readonly purpose: PurposeEntry } | CatalogFailure {
  const purposes = catalogueOf(version);
  if (!purposes) return UNKNOWN_VERSION;
  if (typeof key !== "string") return UNKNOWN_PURPOSE;
  const purpose = purposes.find((entry) => entry.key === key);
  return purpose ? { ok: true, version: version as PurposeCatalogVersion, purpose } : UNKNOWN_PURPOSE;
}

/** The keys that are on by default in a version, in catalogue order. */
export function defaultPurposes(
  version: unknown,
): { readonly ok: true; readonly version: PurposeCatalogVersion; readonly keys: readonly string[] } | CatalogFailure {
  const purposes = catalogueOf(version);
  if (!purposes) return UNKNOWN_VERSION;
  return { ok: true, version: version as PurposeCatalogVersion, keys: purposes.filter((e) => e.enabledByDefault).map((e) => e.key) };
}
