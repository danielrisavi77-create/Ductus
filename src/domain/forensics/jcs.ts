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
 * - arrays and objects nested no deeper than MAX_JCS_DEPTH (a local limit,
 *   not part of the RFC);
 * - array order preserved;
 * - no emitted whitespace.
 */

export type JcsJsonPrimitive = null | boolean | number | string;
export type JcsJsonValue =
  | JcsJsonPrimitive
  | JcsJsonValue[]
  | { [key: string]: JcsJsonValue };

/**
 * Deepest nesting of arrays and objects a value may have and still have a
 * canonical form. Without a limit the answer for a very deep value is a stack
 * overflow, which depends on the JavaScript engine: the browser and the server
 * could then disagree on whether the same value can be hashed. The limit is
 * far above what an editor document or its steps nest to and far below any
 * engine's stack; it changes only on both sides at once.
 */
export const MAX_JCS_DEPTH = 256;

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

function serialize(
  value: unknown,
  active: WeakSet<object>,
  depth: number,
): string {
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
  // Checked before descending, so the recursion itself never goes deeper.
  if (depth >= MAX_JCS_DEPTH) {
    fail("nesting too deep");
  }

  active.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index++) {
        // map() and every() skip holes, so a sparse array would hash as a shorter one.
        if (!(index in value)) {
          fail("sparse array");
        }
        items.push(serialize(value[index], active, depth + 1));
      }
      return "[" + items.join(",") + "]";
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
        `${JSON.stringify(key)}:${serialize(descriptor.value, active, depth + 1)}`,
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
  return serialize(value, new WeakSet<object>(), 0);
}

export function jcsUtf8Bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeJcs(value));
}
