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
// Code points the database's Unicode (15.1 in PostgreSQL 16 and 17) does not
// have, but Node's (up to 17.0) gives a combining class or a composition: each
// differs from the database's NFC answer, or is a part of one that does
// (measured over every code point, #1654 QA). PostgreSQL treats an unknown
// code point as a starter that never composes, so each becomes U+E000, which
// is exactly that, before the NFC comparison. If either side moves to another
// Unicode version, the agreement sweep fails and this list is measured again.
const UNKNOWN_TO_DATABASE =
  /[\u0897\u1ACF-\u1ADD\u1AE0-\u1AEB\u{105C9}\u{105D2}\u{105DA}\u{105E4}\u{10D69}-\u{10D6D}\u{10EFA}-\u{10EFB}\u{11382}-\u{11385}\u{1138B}\u{1138E}\u{11390}-\u{11391}\u{113B8}\u{113BB}\u{113C2}\u{113C5}\u{113C7}-\u{113C9}\u{113CE}-\u{113D0}\u{1611E}-\u{16129}\u{1612F}\u{16D63}\u{16D67}-\u{16D6A}\u{1E5EE}-\u{1E5EF}\u{1E6E3}\u{1E6E6}\u{1E6EE}-\u{1E6EF}\u{1E6F5}]/gu;
// A private use character: a starter that never composes, named in the source.
const UNKNOWN_STARTER = String.fromCodePoint(0xe000);
const HASH = /^[0-9a-f]{64}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type RevisionKind = "done" | "declined";

/** As collaboration.is_revision_text, and no lone surrogate (the database cannot hold one). */
export function isRevisionText(value: unknown): value is string {
  if (typeof value !== "string" || LONE_SURROGATE.test(value)) return false;
  const known = value.replace(UNKNOWN_TO_DATABASE, UNKNOWN_STARTER);
  if (known.normalize("NFC") !== known) return false;
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
