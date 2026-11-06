/**
 * DAN-314 step 2d input contract (docs/backend/suradnja.md 4.14, G1 to G9).
 * The same limits as the CHECKs in db/migrations 20261106160000 and
 * 20261106190000; the database stays the authority, this only refuses early
 * and without a round trip. Lengths are code points, like char_length.
 *
 * Imports nothing from the older revision-request.ts or conditional-validity
 * (B5/D4/D6): the HTTP route must not learn the old status names.
 */
export const REVISION_TEXT_MAX = 2000;
export const REVISION_NUMBER_MAX = Number.MAX_SAFE_INTEGER;

// C0, DEL and C1, like [[:cntrl:]]; newline and tab are removed first.
const CONTROL = /\p{Cc}/u;
const BIDI = /[\u202A-\u202E\u2066-\u2069]/u;
// A UTF-16 unit of a surrogate pair is never matched on its own under /u,
// so this finds only a lone surrogate (String#isWellFormed is ES2024).
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;
// The exact class of collaboration.is_revision_text: White_Space plus zero width.
const VISIBLE =
  /[^\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]/u;
const HASH = /^[0-9a-f]{64}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type RevisionKind = "done" | "declined";

/** As collaboration.is_revision_text, and no lone surrogate (the database cannot hold one). */
export function isRevisionText(value: unknown): value is string {
  if (typeof value !== "string" || LONE_SURROGATE.test(value)) return false;
  if (value.normalize("NFC") !== value) return false;
  const length = [...value].length;
  if (length < 1 || length > REVISION_TEXT_MAX) return false;
  if (CONTROL.test(value.replace(/[\n\t]/g, "")) || BIDI.test(value)) return false;
  return VISIBLE.test(value);
}

/** A revision as the bigint CHECKs: a safe integer from 0 to 2^53 - 1. */
export function isRevisionNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

/** A row_seq the client read: 1 to 2^53 - 1 (collaboration.is_revision_seq). */
export function isExpectedSeq(value: unknown): value is number {
  return isRevisionNumber(value) && value >= 1;
}

export function isRevisionKind(value: unknown): value is RevisionKind {
  return value === "done" || value === "declined";
}

/** The accepted_range_hash CHECK: 64 lowercase hex digits. */
export function isRangeHash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

/** A request id in the canonical lowercase form PostgreSQL prints. */
export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID.test(value);
}
