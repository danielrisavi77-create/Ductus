/**
 * The Content-Security-Policy of every page (DAN-489, M1.6b). The target and
 * the inventory it rests on are in docs/engineering/sigurnosna-zaglavlja.md.
 *
 * middleware.ts builds a new policy for each page request: Next.js reads the
 * nonce from the request header and puts it on its own scripts. Our only
 * inline script is THEME_SCRIPT, allowed by its hash, so the policy needs no
 * 'unsafe-inline' and no 'unsafe-eval' on the build. Only `next dev` adds
 * them, for fast refresh and the error overlay.
 *
 * The module runs in the middleware (edge) runtime: Web Crypto only.
 */

/**
 * sha256 of THEME_SCRIPT (src/components/shell/theme.ts), base64. A constant,
 * because the middleware must not hash on every request; the unit test
 * recomputes it from the script, so a change to the script fails the test.
 */
export const THEME_SCRIPT_HASH = "sha256-w5EUkO0mfeWuprqAVvvDQYH6baexqP0/rQ+LVq3kZ6I=";

/** API responses carry no markup to run; nothing may load from them. */
export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const NONCE_BYTES = 16; // 128 bits
const NONCE = /^[A-Za-z0-9+/]{22}==$/;
const HASH = /^sha256-[A-Za-z0-9+/]{43}=$/;

export type PolicyOptions = {
  nonce: string;
  /** `next dev`: adds 'unsafe-eval' to scripts and 'unsafe-inline' to styles. */
  development: boolean;
  /** Origin of the identity provider; null keeps form-action at 'self'. */
  issuerOrigin: string | null;
};

/** A fresh nonce: 128 random bits, base64. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  return btoa(String.fromCharCode(...bytes));
}

/** The CSP source of a script's text, `sha256-<base64>`. */
export async function scriptHash(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return `sha256-${btoa(String.fromCharCode(...digest))}`;
}

/**
 * The origin of OIDC_ISSUER, or null when it is missing or not an http(s)
 * URL. Sign-out is a form POST whose 303 leads to the provider's
 * end_session, and form-action applies to that redirect. A bad value narrows
 * the policy to 'self'; it never widens it.
 */
export function issuerOriginOf(issuer: string | undefined): string | null {
  if (!issuer) return null;
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.origin;
}

/** The page policy for one request. Throws on a malformed nonce or hash. */
export function pageContentSecurityPolicy({ nonce, development, issuerOrigin }: PolicyOptions, hash: string = THEME_SCRIPT_HASH): string {
  if (!NONCE.test(nonce)) throw new Error("CSP nonce must be 128 bits in base64");
  if (!HASH.test(hash)) throw new Error("CSP script hash must be a sha256 source");
  const script = ["'self'", `'nonce-${nonce}'`, `'${hash}'`, "'strict-dynamic'"];
  const style = ["'self'"];
  if (development) {
    script.push("'unsafe-eval'");
    style.push("'unsafe-inline'");
  }
  const formAction = issuerOrigin === null ? "'self'" : `'self' ${issuerOrigin}`;
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    `style-src ${style.join(" ")}`,
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    `form-action ${formAction}`,
    "frame-ancestors 'none'",
  ].join("; ");
}
