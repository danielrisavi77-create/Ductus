/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * This is intentionally separate from the legacy Pisač v1 canonicalize()
 * function. Historic v1 hashes must remain verifiable under their original
 * algorithm; new Evidence v2 data opts into this implementation explicitly.
 *
 * RFC 8785 constraints used here:
 * - I-JSON-compatible JSON values only;
 * - ECMAScript JSON serialization for primitives/numbers;
 * - no NaN/Infinity;
 * - no lone UTF-16 surrogates;
 * - object keys recursively sorted by raw UTF-16 code units;
 * - array order preserved;
 * - no emitted whitespace.
 */

export type JcsJsonPrimitive = null | boolean | number | string;
export type JcsJsonValue =
  | JcsJsonPrimitive
  | JcsJsonValue[]
  | { [key: string]: JcsJsonValue };

function fail(reason: string): never {
  throw new Error(`jcs: ${reason}`);
}

function assertUnicodeScalarSequence(value: string): void {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail("lone surrogate");
      }
      i++;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail("lone surrogate");
    }
  }
}

function serializePrimitive(value: JcsJsonPrimitive): string {
  if (typeof value === "number" && !Number.isFinite(value)) {
    fail("non-finite number");
  }
  if (typeof value === "string") {
    assertUnicodeScalarSequence(value);
  }
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") {
    fail("unsupported primitive");
  }
  return serialized;
}

function serialize(value: unknown, active: WeakSet<object>): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return serializePrimitive(value);
  }

  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    fail("unsupported value");
  }

  if (typeof value !== "object") {
    fail("unsupported value");
  }

  if (active.has(value)) {
    fail("cyclic value");
  }

  active.add(value);
  try {
    if (Array.isArray(value)) {
      return "[" + value.map((item) => serialize(item, active)).join(",") + "]";
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("non-plain object");
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      fail("symbol property");
    }

    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    const parts: string[] = [];

    for (const key of keys) {
      assertUnicodeScalarSequence(key);
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (!descriptor || !("value" in descriptor)) {
        fail("accessor property");
      }
      parts.push(
        `${JSON.stringify(key)}:${serialize(descriptor.value, active)}`,
      );
    }

    return "{" + parts.join(",") + "}";
  } finally {
    active.delete(value);
  }
}

/**
 * Canonicalizes one in-memory JSON value according to RFC 8785 JCS.
 *
 * The caller must pass JSON data, not arbitrary JavaScript application
 * objects. Unsupported JS-only values fail closed.
 */
export function canonicalizeJcs(value: unknown): string {
  return serialize(value, new WeakSet<object>());
}

export function jcsUtf8Bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeJcs(value));
}
