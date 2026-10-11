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
  if (parsed.origin !== BASE || isApiPath(parsed.pathname)) return DEFAULT_RETURN_TO;
  // The parser removes dot segments, so "/.//host" and "/%2e//host" come out
  // as "//host". What is returned is what must be safe, so check it again.
  const result = parsed.pathname + parsed.search + parsed.hash;
  if (result.startsWith("//") || result.startsWith("/\\")) return DEFAULT_RETURN_TO;
  return result;
}

// Decoding rounds before an encoded path counts as unreadable.
const MAX_DECODE_ROUNDS = 3;

/**
 * True for "/api" and anything below it, however the path is spelled:
 * any letter case, percent-encoded letters or slashes, and encodings
 * nested up to MAX_DECODE_ROUNDS deep. A path that does not decode
 * cleanly within that bound also counts, so the check fails closed.
 */
function isApiPath(pathname: string): boolean {
  let path = pathname;
  for (let round = 0; round <= MAX_DECODE_ROUNDS; round += 1) {
    const lower = path.toLowerCase();
    if (lower === "/api" || lower.startsWith("/api/")) return true;
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return true;
    }
    if (decoded === path) return false;
    path = decoded;
  }
  return true;
}
