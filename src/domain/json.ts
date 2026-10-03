/**
 * Narrowing helpers for untrusted parsed JSON.
 *
 * Pure TypeScript, no imports: every module that reads a payload it did not
 * write — an RPC answer, a stored document, ProseMirror JSON, a posted server
 * action argument — needs the same two rules, and had its own copy of them
 * before F1-13. One copy means one place the prototype rule can be read, and
 * one place its tests point at.
 */

/**
 * A *plain* object, not merely an object.
 *
 * The prototype check is the part that matters (F1-10). A class instance, an
 * array or a `JSON.parse`-forged `__proto__` carrier is not the payload we
 * were promised, and reading its properties as if it were is how a forged
 * shape gets trusted.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Own, non-inherited property. `in` and a bare index would both walk the
 * prototype chain, so `{"__proto__": ...}` or a `status` of `"constructor"`
 * would otherwise sail through.
 */
export function ownProperty(value: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
}
