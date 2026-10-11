/**
 * What can be told about an Ed25519 key or signature from its bytes alone
 * (RFC 8032, sections 5.1.3 and 5.1.7). Runtimes disagree on exactly these
 * inputs: some verify under a point of small order, where a signature needs
 * no private key, or take a second spelling of the same number. A verifier
 * asks here first, so its answer is the same in every runtime.
 *
 * Not told here: whether the point is on the curve (no runtime verifies with
 * one that is not), and whether a point of no small order lies in the
 * prime-order subgroup (that takes a scalar multiplication).
 */
const FIELD_PRIME = 2n ** 255n - 19n;
const GROUP_ORDER = 2n ** 252n + 27742317777372353535851937790883648493n;
// The four points of order 8 have this y or its negative; the other points
// of small order have y = 0 (order 4), 1 (the identity) and -1 (order 2).
const ORDER_8_Y =
  2707385501144840649318225287225658788936804267575313519463743609750303402022n;
const SMALL_ORDER_Y: ReadonlySet<bigint> = new Set([
  0n,
  1n,
  FIELD_PRIME - 1n,
  ORDER_8_Y,
  FIELD_PRIME - ORDER_8_Y,
]);
// SubjectPublicKeyInfo of an Ed25519 key up to the key itself (RFC 8410).
const SPKI_PREFIX = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];

function littleEndian(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index]);
  }
  return value;
}

/**
 * 32 bytes that spell a point the one canonical way (y below the field
 * prime) and are none of the eight points of small order. The sign bit of x
 * is not part of y, so both spellings of a small-order point are refused.
 */
export function isSoundEd25519Point(point: Uint8Array): boolean {
  if (point.byteLength !== 32) return false;
  const y = littleEndian(point) & (2n ** 255n - 1n);
  return y < FIELD_PRIME && !SMALL_ORDER_Y.has(y);
}

/** `R || S` with a sound `R` and `S` below the group order. */
export function isCanonicalEd25519Signature(signature: Uint8Array): boolean {
  return (
    signature.byteLength === 64 &&
    isSoundEd25519Point(signature.subarray(0, 32)) &&
    littleEndian(signature.subarray(32)) < GROUP_ORDER
  );
}

/** The 32 bytes of the key of an Ed25519 SPKI, or null for anything else. */
export function ed25519KeyFromSpki(spki: Uint8Array): Uint8Array | null {
  return spki.byteLength === SPKI_PREFIX.length + 32 &&
    SPKI_PREFIX.every((byte, index) => spki[index] === byte)
    ? spki.subarray(SPKI_PREFIX.length)
    : null;
}
