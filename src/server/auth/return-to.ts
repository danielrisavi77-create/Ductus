/**
 * Where the browser goes after login (docs/BACKEND.md 4.3). Only a path of
 * this application is accepted; anything that a browser could read as
 * another origin falls back to the default page. The value is stored with
 * the login attempt (state), never read from the callback query.
 */
export const DEFAULT_RETURN_TO = "/";

const MAX_LENGTH = 512;
const BASE = "https://ductus.invalid";
// C0 and C1 controls, line and paragraph separators, and invisible format
// characters (zero-width, bidi), which browsers strip or reinterpret.
const UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) {
    return DEFAULT_RETURN_TO;
  }
  // "//host" and "/\host" are protocol-relative in browsers; a backslash is
  // never needed in our paths.
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || UNSAFE.test(value)) {
    return DEFAULT_RETURN_TO;
  }
  let parsed: URL;
  try {
    parsed = new URL(value, BASE);
  } catch {
    return DEFAULT_RETURN_TO;
  }
  // Login routes would only loop back into the flow.
  if (parsed.origin !== BASE || parsed.pathname.startsWith("/api/")) return DEFAULT_RETURN_TO;
  return parsed.pathname + parsed.search + parsed.hash;
}
