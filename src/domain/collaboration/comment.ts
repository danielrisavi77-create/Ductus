import { isNodeId } from "../document";
import type { TextAnchor } from "./anchor";

/**
 * B-10 input contract (docs/BACKEND.md 4.11). The same limits as the CHECKs
 * in collaboration.is_comment_body and is_text_anchor; the database stays the
 * authority, this only refuses early and without a round trip. Lengths are
 * code points, like char_length.
 */
export const COMMENT_BODY_MAX = 2000;
export const ANCHOR_QUOTE_MAX = 500;
export const ANCHOR_CONTEXT_MAX = 64;
export const ANCHOR_HINT_MAX = 1_000_000;
export const DOCUMENT_ID_MAX = 256;

const BIDI = /[\u202A-\u202E\u2066-\u2069]/u;
// C0, DEL and C1, like [[:cntrl:]].
const CONTROL = /\p{Cc}/u;
const ANCHOR_KEYS = ["endHint", "nodeId", "prefix", "quote", "startHint", "suffix"];

function codePoints(value: string): number {
  return [...value].length;
}

function hasForbiddenChars(value: string): boolean {
  // Newline and tab are the only control characters allowed.
  return CONTROL.test(value.replace(/[\n\t]/g, "")) || BIDI.test(value);
}

export function isCommentBody(value: unknown): value is string {
  if (typeof value !== "string" || value.normalize("NFC") !== value) return false;
  const length = codePoints(value);
  return length >= 1 && length <= COMMENT_BODY_MAX && /\S/u.test(value) && !hasForbiddenChars(value);
}

function isAnchorText(value: unknown, max: number): value is string {
  return typeof value === "string" && codePoints(value) <= max && !hasForbiddenChars(value);
}

function isHint(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= ANCHOR_HINT_MAX;
}

/** Exactly the six TextAnchor fields; anything more or less is refused. */
export function isTextAnchorInput(value: unknown): value is TextAnchor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  if (keys.length !== ANCHOR_KEYS.length || keys.some((key, i) => key !== ANCHOR_KEYS[i])) return false;
  if (!isNodeId(obj.nodeId)) return false;
  if (!isAnchorText(obj.quote, ANCHOR_QUOTE_MAX) || obj.quote.length === 0) return false;
  if (!isAnchorText(obj.prefix, ANCHOR_CONTEXT_MAX) || !isAnchorText(obj.suffix, ANCHOR_CONTEXT_MAX)) return false;
  return isHint(obj.startHint) && isHint(obj.endHint) && obj.startHint < obj.endHint;
}

/** Same shape as the evidence.document id CHECK. */
export function isDocumentId(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value) return false;
  const length = codePoints(value);
  return length >= 1 && length <= DOCUMENT_ID_MAX && !CONTROL.test(value);
}
