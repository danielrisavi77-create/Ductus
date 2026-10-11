/**
 * What can be told about an Ed25519 key or signature from its bytes alone
 * (RFC 8032, sections 5.1.3 and 5.1.7). Runtimes disagree on exactly these
 * inputs: some verify under a point of small order, where a signature needs
 * no private key; some take a second spelling of the same number; and a key
 * with a small-order part (mixed order) passes in one runtime and fails in
 * another for the same signature. A verifier asks here first, so its answer
 * is the same in every runtime.
 *
 * The arithmetic reads public bytes only, so it need not run in constant time.
 */
const FIELD_PRIME = 2n ** 255n - 19n;
const GROUP_ORDER = 2n ** 252n + 27742317777372353535851937790883648493n;
// d = -121665/121666 and a square root of -1, modulo the field prime (RFC 8032, 5.1).
const CURVE_D =
  37095705934669439343138083508754565189542113879843219016388785533085940283555n;
const SQRT_MINUS_1 =
  19681161376707505956807079304988542015446066515923890162744021073123829784752n;
// SubjectPublicKeyInfo of an Ed25519 key up to the key itself (RFC 8410).
const SPKI_PREFIX = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];

/** Extended coordinates: x = X/Z, y = Y/Z, T = XY/Z. */
type Point = readonly [x: bigint, y: bigint, z: bigint, t: bigint];
const IDENTITY: Point = [0n, 1n, 1n, 0n];

function littleEndian(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index]);
  }
  return value;
}

function mod(value: bigint): bigint {
  const rest = value % FIELD_PRIME;
  return rest < 0n ? rest + FIELD_PRIME : rest;
}

function power(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  for (let b = base, e = exponent; e > 0n; e >>= 1n, b = mod(b * b)) {
    if (e & 1n) result = mod(result * b);
  }
  return result;
}

/** RFC 8032, 5.1.4. Complete on this curve, so it also doubles a point. */
function add([x1, y1, z1, t1]: Point, [x2, y2, z2, t2]: Point): Point {
  const a = mod((y1 - x1) * (y2 - x2));
  const b = mod((y1 + x1) * (y2 + x2));
  const c = mod(2n * CURVE_D * t1 * t2);
  const d = mod(2n * z1 * z2);
  return [mod((b - a) * (d - c)), mod((d + c) * (b + a)), mod((d - c) * (d + c)), mod((b - a) * (b + a))];
}

const isIdentity = ([x, y, z]: Point) => x === 0n && y === z;

/**
 * RFC 8032, 5.1.3: a point with the y that 32 bytes spell, or null for y at
 * or above the field prime and for a y that is on no point of the curve. The
 * sign of x is not read: it picks P or -P, which are in the prime-order
 * subgroup together, and where x is 0 the point is of small order either way.
 */
function decode(bytes: Uint8Array): Point | null {
  const y = littleEndian(bytes) & (2n ** 255n - 1n);
  if (y >= FIELD_PRIME) return null;
  // x^2 = (y^2 - 1) / (d y^2 + 1)
  const square = mod((y * y - 1n) * power(mod(CURVE_D * y * y + 1n), FIELD_PRIME - 2n));
  let x = power(square, (FIELD_PRIME + 3n) / 8n);
  if (mod(x * x) !== square) x = mod(x * SQRT_MINUS_1);
  return mod(x * x) === square ? [x, y, 1n, mod(x * y)] : null;
}

/**
 * 32 bytes that spell, the one canonical way, a point of the subgroup of
 * prime order other than the identity: what an honest key and the R of an
 * honest signature always are. Refused: a second spelling, a y of no point,
 * the eight points of small order, and every point with a small-order part,
 * which [L]P tells from the rest (L is the order of the base point).
 */
export function isSoundEd25519Point(point: Uint8Array): boolean {
  if (point.byteLength !== 32) return false;
  const decoded = decode(point);
  if (decoded === null) return false;
  let product = IDENTITY;
  for (let bit = 252n; bit >= 0n; bit -= 1n) {
    product = add(product, product);
    if ((GROUP_ORDER >> bit) & 1n) product = add(product, decoded);
  }
  return isIdentity(product) && !isIdentity(decoded);
}

/** `R || S` with a sound `R` and `S` below the group order. */
export function isCanonicalEd25519Signature(signature: Uint8Array): boolean {
  return (
    signature.byteLength === 64 &&
    littleEndian(signature.subarray(32)) < GROUP_ORDER &&
    isSoundEd25519Point(signature.subarray(0, 32))
  );
}

/** The 32 bytes of the key of an Ed25519 SPKI, or null for anything else. */
export function ed25519KeyFromSpki(spki: Uint8Array): Uint8Array | null {
  return spki.byteLength === SPKI_PREFIX.length + 32 &&
    SPKI_PREFIX.every((byte, index) => spki[index] === byte)
    ? spki.subarray(SPKI_PREFIX.length)
    : null;
}
