/**
 * Key parity between interface catalogues (D-70): every catalogue has the
 * keys of the Croatian one, the same length of every list, and the same
 * `{placeholders}` in every text. The `Messages` type checks the shape when a
 * catalogue is compiled; this checks the values a catalogue holds at run time.
 */

type Leaf = { readonly kind: "text"; readonly placeholders: string } | { readonly kind: "empty" } | { readonly kind: "other" };

export interface CatalogueGaps {
  /** Paths of the reference that the other catalogue does not fill the same way. */
  readonly missing: string[];
  /** Paths of the other catalogue that the reference does not have. */
  readonly extra: string[];
  /** Paths of texts whose placeholders differ. */
  readonly placeholders: string[];
}

const PLACEHOLDER = /\{(\w+)\}/g;

function placeholdersOf(text: string): string {
  return [...new Set(Array.from(text.matchAll(PLACEHOLDER), (match) => match[1]))].sort().join(",");
}

function leafOf(node: unknown): Leaf | null {
  if (typeof node === "string") return { kind: "text", placeholders: placeholdersOf(node) };
  if (typeof node !== "object" || node === null) return { kind: "other" };
  return Object.keys(node).length === 0 ? { kind: "empty" } : null;
}

/**
 * How a path is reported: segments joined with dots, as long as that reads one
 * way only. A path with a dotted key, or one that would start like the other
 * form, is written as its segments in JSON (`["a.b"]` is not `a.b`).
 */
function shownPath(segments: readonly string[]): string {
  return segments.some((segment) => segment.includes(".")) || segments[0]?.startsWith("[") ? JSON.stringify(segments) : segments.join(".");
}

/**
 * Every text, empty section and stray value of a catalogue. A path is told by
 * its segments in JSON, never by a dotted join: a key may hold a dot, and
 * `"a.b"` and a → b must not share one entry.
 */
function leaves(node: unknown, segments: readonly string[] = [], into = new Map<string, { path: string; leaf: Leaf }>()) {
  const leaf = leafOf(node);
  if (leaf) {
    // An empty catalogue has no leaves: a root with nothing in it is not a missing or extra key.
    if (segments.length > 0 || leaf.kind !== "empty") into.set(JSON.stringify(segments), { path: shownPath(segments), leaf });
    return into;
  }
  for (const [key, value] of Object.entries(node as object)) leaves(value, [...segments, key], into);
  return into;
}

/** What the other catalogue lacks, adds or words with other placeholders, compared with the reference. */
export function catalogueGaps(reference: unknown, other: unknown): CatalogueGaps {
  const want = leaves(reference);
  const have = leaves(other);
  const gaps: CatalogueGaps = { missing: [], extra: [], placeholders: [] };
  for (const [id, { path, leaf }] of want) {
    const found = have.get(id)?.leaf;
    if (found?.kind !== leaf.kind) gaps.missing.push(path);
    else if (leaf.kind === "text" && found.kind === "text" && leaf.placeholders !== found.placeholders) gaps.placeholders.push(path);
  }
  for (const [id, { path, leaf }] of have) if (want.get(id)?.leaf.kind !== leaf.kind) gaps.extra.push(path);
  return gaps;
}
