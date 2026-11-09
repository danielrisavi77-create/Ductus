/**
 * Invented values for the DAN-586 redaction tests; none of them is or was a
 * real secret. The redactor must see secret-shaped strings (a key followed by
 * a value, a URL with a user and a password, a JWT, a Basic credential), yet
 * the test source must not hold one, or a secret scanner reads an invented
 * value as a leaked credential (GitGuardian 39832826 on #1744). So every such
 * string is joined here at run time from parts that are harmless on their own.
 */

const join = (...parts: string[]): string => parts.join("");

/** The canary: one invented word that must never reach a log line. */
export const CANARY = join("kanarinac", "7Qx9", "Lm2Pz4", "Rt8Vw");

/** A token-shaped invented value whose tail is a long digit run. */
export const DIGIT_TAIL_TOKEN = join("kanarinac", "ABCDEFGHIJKLMN", "123456789");

/** A short invented secret with no token shape, caught only by its key. */
export const SHORT = join("zel", "eni");

/** A short invented bearer credential. */
export const SHORT_BEARER = join("abc", "123");

/** `key`, a separator and `value`, e.g. `pair("k", "=", "v")`. */
export function pair(key: string, separator: string, value: string): string {
  return join(key, separator, value);
}

/** A JSON object text with one key, e.g. `{"k":"v"}`. */
export function jsonPair(key: string, value: unknown): string {
  return JSON.stringify(Object.fromEntries([[key, value]]));
}

/** A URL with a user and a password before the host. */
export function urlWithUser(scheme: string, user: string, password: string, rest: string): string {
  return join(scheme, "://", user, ":", password, "@", rest);
}

/** A Basic credential for `user:password`, as base64. */
export function basic(user: string, password: string): string {
  return Buffer.from(join(user, ":", password)).toString("base64");
}

/** An invented, unsigned JWT: base64url header and claims, then a fake signature. */
export function inventedJwt(subject: string, signature: string): string {
  const part = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  return [part({ alg: "HS256" }), part({ sub: subject }), signature].join(".");
}
