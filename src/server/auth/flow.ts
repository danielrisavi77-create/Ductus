import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { identityFromClaims } from "./claims";
import type { AuthConfig } from "./config";
import { isProviderUnavailable, newLoginChecks, type LoginChecks, type OidcClient } from "./oidc";
import { DEFAULT_RETURN_TO, safeReturnTo } from "./return-to";
import { newSessionToken, SESSION_COOKIE_NAME } from "./session-token";

/**
 * The login, callback and logout routes (B-6; docs/BACKEND.md 4.3), as plain
 * Request to Response functions so tests drive them without Next.js. Every
 * failure ends on one neutral Croatian page: the browser learns neither which
 * check failed nor whether an institution exists. Logs carry a stage and an
 * error code, never a value from the request or the provider.
 */
export interface OpenSessionPort {
  (input: { issuer: string; subject: string; uniqueId: string; homeOrg: string; tokenHash: Buffer }): Promise<
    { ok: true; expires: Date } | { ok: false; reason: "refused" | "conflict" }
  >;
}

export interface AuthDeps {
  config: AuthConfig;
  oidc: OidcClient;
  openSession: OpenSessionPort;
  /** Closes the session behind a raw cookie token; false when there was none. */
  closeSession: (token: string) => Promise<boolean>;
}

/** The pending login attempt: state, nonce, PKCE verifier and where to go after. */
export const LOGIN_COOKIE_NAME = "__Host-ductus_login";
const LOGIN_COOKIE_MAX_AGE = 600;
const RANDOM_VALUE = /^[A-Za-z0-9_-]{43}$/;

const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

function cookie(name: string, value: string, attributes: string): string {
  // __Host-: Secure, Path=/ and no Domain, so the cookie belongs to this host alone.
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; ${attributes}`;
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

interface Attempt extends LoginChecks {
  returnTo: string;
}

function encodeAttempt(attempt: Attempt): string {
  return Buffer.from(JSON.stringify({ v: 1, ...attempt })).toString("base64url");
}

// The cookie is not signed: it is __Host- and HttpOnly, so whoever can write
// it already controls this origin. It is still parsed as untrusted input.
function decodeAttempt(value: string | undefined): Attempt | undefined {
  if (!value || value.length > 1024) return undefined;
  try {
    const raw: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof raw !== "object" || raw === null) return undefined;
    const { v, state, nonce, codeVerifier, returnTo } = raw as Record<string, unknown>;
    if (v !== 1) return undefined;
    for (const random of [state, nonce, codeVerifier]) {
      if (typeof random !== "string" || !RANDOM_VALUE.test(random)) return undefined;
    }
    return {
      state: state as string,
      nonce: nonce as string,
      codeVerifier: codeVerifier as string,
      returnTo: safeReturnTo(returnTo),
    };
  } catch {
    return undefined;
  }
}

function errorCode(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? `${error.name}:${code}` : error.name;
  }
  return "unknown";
}

function logFailure(stage: string, detail: string): void {
  console.error("login failed", stage, detail);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The neutral page every failure ends on. */
export function failurePage(status: 400 | 403 | 503, extraHeaders: Headers = new Headers()): Response {
  const body = status === 503 ? t.auth.unavailableBody : t.auth.failedBody;
  const html = `<!doctype html>
<html lang="hr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(t.auth.failedTitle)} · ${escapeHtml(t.app.name)}</title></head>
<body><main><h1>${escapeHtml(t.auth.failedTitle)}</h1><p>${escapeHtml(body)}</p>
<p><a href="/api/auth/login">${escapeHtml(t.auth.retry)}</a> · <a href="/">${escapeHtml(t.auth.home)}</a></p></main></body></html>`;
  const headers = new Headers(extraHeaders);
  for (const [k, v] of Object.entries(NO_STORE)) headers.set(k, v);
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(html, { status, headers });
}

function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({ location, ...NO_STORE });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
}

/** GET /api/auth/login?returnTo=/path */
export async function startLogin(request: Request, deps: AuthDeps): Promise<Response> {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
  const checks = newLoginChecks();
  let location: URL;
  try {
    location = await deps.oidc.authorizationUrl(checks);
  } catch (error) {
    logFailure("authorize", errorCode(error));
    return failurePage(503);
  }
  return redirect(location.href, [
    cookie(LOGIN_COOKIE_NAME, encodeAttempt({ ...checks, returnTo }), `Max-Age=${LOGIN_COOKIE_MAX_AGE}`),
  ]);
}

const clearedLoginCookie = () => cookie(LOGIN_COOKIE_NAME, "", "Max-Age=0");

/** GET /api/auth/callback?code=…&state=… */
export async function finishLogin(request: Request, deps: AuthDeps): Promise<Response> {
  // The attempt is single use: whatever happens next, its cookie is cleared,
  // so a replayed callback finds no state to match.
  const cleared = new Headers({ "set-cookie": clearedLoginCookie() });
  const attempt = decodeAttempt(readCookie(request, LOGIN_COOKIE_NAME));
  if (!attempt) {
    logFailure("callback", "no_attempt");
    return failurePage(400, cleared);
  }

  let verified;
  try {
    verified = await deps.oidc.verify(new URL(request.url), attempt);
  } catch (error) {
    logFailure("verify", errorCode(error));
    return failurePage(isProviderUnavailable(error) ? 503 : 400, cleared);
  }

  const claims = identityFromClaims(verified.idToken, verified.userinfo);
  if (!claims.ok) {
    logFailure("claims", claims.reason);
    return failurePage(403, cleared);
  }

  const { token, tokenHash } = newSessionToken();
  let opened;
  try {
    opened = await deps.openSession({ issuer: verified.issuer, ...claims.identity, tokenHash });
  } catch (error) {
    logFailure("open_session", errorCode(error));
    return failurePage(503, cleared);
  }
  if (!opened.ok) {
    logFailure("open_session", opened.reason);
    return failurePage(opened.reason === "refused" ? 403 : 400, cleared);
  }

  // A session cookie the browser already had (another user's, or one planted
  // before login) is closed, never reused: the new session has a new token.
  const previous = readCookie(request, SESSION_COOKIE_NAME);
  if (previous) {
    await deps.closeSession(previous).catch((error: unknown) => logFailure("close_previous", errorCode(error)));
  }

  return redirect(new URL(attempt.returnTo, deps.config.redirectUri.origin).href, [
    clearedLoginCookie(),
    cookie(SESSION_COOKIE_NAME, token, `Expires=${opened.expires.toUTCString()}`),
  ]);
}

/**
 * The request comes from a page of this origin: Sec-Fetch-Site when the
 * browser sends it, Origin otherwise. A request with neither is refused.
 */
export function isSameOrigin(request: Request, origin: string): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  return request.headers.get("origin") === origin;
}

/** POST /api/auth/logout */
export async function logout(request: Request, deps: AuthDeps): Promise<Response> {
  if (!isSameOrigin(request, deps.config.redirectUri.origin)) {
    logFailure("logout", "cross_origin");
    return failurePage(403);
  }
  const clearedSession = cookie(SESSION_COOKIE_NAME, "", "Max-Age=0");
  const token = readCookie(request, SESSION_COOKIE_NAME);
  if (token) {
    try {
      await deps.closeSession(token);
    } catch (error) {
      // The cookie is cleared all the same; the session then ends at expiry.
      logFailure("logout", errorCode(error));
    }
  }
  return redirect(new URL(DEFAULT_RETURN_TO, deps.config.redirectUri.origin).href, [clearedSession]);
}
