import { createHash, randomBytes } from "node:crypto";

/**
 * The session cookie (docs/BACKEND.md 4.3). The token is 32 random bytes in
 * base64url, the only format withActor and app.current_actor() accept. The
 * database stores its SHA-256 alone; the raw token exists only in the
 * Set-Cookie header and the browser.
 */
export const SESSION_COOKIE_NAME = "__Host-ductus_session";

export function newSessionToken(): { token: string; tokenHash: Buffer } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

/** Same digest as the database: sha256(convert_to(token, 'UTF8')). */
export function hashSessionToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export interface SessionCookieOptions {
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: "/";
  expires: Date;
}

// The __Host- prefix needs Secure and Path=/ and forbids Domain, so the
// cookie is bound to this exact host. Lax keeps it on the top-level redirect
// back from the provider and off cross-site subrequests.
export function sessionCookieOptions(expires: Date): SessionCookieOptions {
  return { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires };
}

/** Logout clears the cookie with the same attributes, or the browser keeps it. */
export function clearedSessionCookieOptions(): SessionCookieOptions {
  return sessionCookieOptions(new Date(0));
}
