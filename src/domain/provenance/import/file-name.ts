/**
 * The imported file's name as the mentor sees it (DAN-436, contract
 * docs/contracts/import-v1.md §3, D-292, attack plan #1911 N1 to N9).
 *
 * The name is never in the hashed manifest, the segment or a receipt: it is a
 * nullable column of `import_event`, so retention (D-30, Q-16) can erase it
 * without touching any hash. It is shown as text, never as markup.
 */

/** Longest name kept, in Unicode code points. */
export const MAX_IMPORT_FILE_NAME_LENGTH = 200;

const LONE_SURROGATES = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu;
// Controls (C0, DEL, C1), format characters (bidi, zero width, BOM, soft hyphen)
// and line or paragraph separators: none is visible, so none may change what
// the mentor reads.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const WHITESPACE = /\s+/gu;

function clean(value: string): string {
  // Invisible characters go before NFC: one between a letter and its mark
  // would otherwise leave an uncomposed pair behind.
  return value.replace(LONE_SURROGATES, "").replace(INVISIBLE, "").normalize("NFC").replace(WHITESPACE, " ").trim();
}

/**
 * The last path segment, cleaned and cut at a code point boundary; `null` when
 * nothing usable is left. Applying it to its own output changes nothing.
 */
export function normalizeImportFileName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const segments = value.split(/[\\/]/u);
  let name = clean(segments[segments.length - 1] ?? "");
  const points = Array.from(name);
  if (points.length > MAX_IMPORT_FILE_NAME_LENGTH) {
    name = clean(points.slice(0, MAX_IMPORT_FILE_NAME_LENGTH).join(""));
  }
  if (name === "" || name === "." || name === "..") return null;
  return name;
}
