/**
 * Login configuration (B-6; D-09, docs/BACKEND.md 4.3). Students sign in with
 * AAI@EduHr alone. The fake OIDC provider ("demo prijava") exists only
 * locally and in CI: with NODE_ENV=production no variable, flag or issuer
 * can select it, and loading such a configuration throws at startup.
 *
 * Errors name the variable, never its value, so a secret cannot reach a log.
 */
export type AuthProvider = "aai-eduhr" | "fake-oidc";

export interface AuthConfig {
  provider: AuthProvider;
  issuer: URL;
  clientId: string;
  clientSecret: string;
  redirectUri: URL;
  /** True only for the fake provider over http on a loopback host. */
  allowInsecureRequests: boolean;
  /** Pinned ID token algorithm; anything else, `none` included, is refused. */
  idTokenAlg: IdTokenAlg;
  /** Allowed clock skew for `iat`, `exp` and `nbf`. */
  clockToleranceSeconds: number;
}

const ID_TOKEN_ALGS = ["RS256", "PS256", "ES256", "EdDSA"] as const;
export type IdTokenAlg = (typeof ID_TOKEN_ALGS)[number];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Names that never resolve to a production identity provider.
const RESERVED_SUFFIXES = [".localhost", ".test", ".example", ".invalid", ".local"];

export class AuthConfigError extends Error {
  override name = "AuthConfigError";
}

type Env = Readonly<Record<string, string | undefined>>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") throw new AuthConfigError(`${name} is not set`);
  return value;
}

function url(env: Env, name: string): URL {
  try {
    return new URL(required(env, name));
  } catch (error) {
    if (error instanceof AuthConfigError) throw error;
    throw new AuthConfigError(`${name} is not a URL`);
  }
}

// The URL parser already turns every IPv4 spelling (decimal, hex, short
// forms) into dotted decimal and keeps IPv6 in brackets.
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * A production issuer or redirect URI names a public DNS host: the AAI@EduHr
 * issuer and Ductus itself always do. So every IP literal is refused, not
 * only loopback (127/8, 0.0.0.0, ::1, ::ffff:…) but private ranges too, and
 * so are single-label names and reserved suffixes. A trailing dot is the
 * same host and is ignored.
 */
function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (host === "" || host.startsWith("[") || IPV4_LITERAL.test(host) || !host.includes(".")) return false;
  return !RESERVED_SUFFIXES.some((s) => host.endsWith(s));
}

export function loadAuthConfig(env: Env = process.env): AuthConfig {
  const production = env.NODE_ENV === "production";
  const provider = required(env, "DUCTUS_AUTH_PROVIDER");
  if (provider !== "aai-eduhr" && provider !== "fake-oidc") {
    throw new AuthConfigError("DUCTUS_AUTH_PROVIDER must be aai-eduhr or fake-oidc");
  }
  if (provider === "fake-oidc" && production) {
    throw new AuthConfigError("the fake OIDC provider is prohibited in production (D-09)");
  }

  const issuer = url(env, "OIDC_ISSUER");
  const redirectUri = url(env, "OIDC_REDIRECT_URI");
  const insecure = issuer.protocol === "http:";
  if (production) {
    // A production build talks to a real provider over TLS, whatever the
    // provider variable says.
    for (const [name, value] of [
      ["OIDC_ISSUER", issuer],
      ["OIDC_REDIRECT_URI", redirectUri],
    ] as const) {
      if (value.protocol !== "https:" || !isPublicHost(value.hostname)) {
        throw new AuthConfigError(`${name} must be an https URL of a public host in production`);
      }
    }
  } else if (insecure && (provider !== "fake-oidc" || !LOOPBACK_HOSTS.has(issuer.hostname))) {
    throw new AuthConfigError("OIDC_ISSUER may use http only for the fake provider on a loopback host");
  } else if (issuer.protocol !== "http:" && issuer.protocol !== "https:") {
    throw new AuthConfigError("OIDC_ISSUER must be an http(s) URL");
  }

  const alg = env.OIDC_ID_TOKEN_ALG ?? "RS256";
  if (!(ID_TOKEN_ALGS as readonly string[]).includes(alg)) {
    throw new AuthConfigError("OIDC_ID_TOKEN_ALG is not an allowed asymmetric algorithm");
  }
  const tolerance = Number(env.OIDC_CLOCK_TOLERANCE_SECONDS ?? "30");
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 120) {
    throw new AuthConfigError("OIDC_CLOCK_TOLERANCE_SECONDS must be an integer from 0 to 120");
  }

  return {
    provider,
    issuer,
    clientId: required(env, "OIDC_CLIENT_ID"),
    clientSecret: required(env, "OIDC_CLIENT_SECRET"),
    redirectUri,
    allowInsecureRequests: !production && insecure,
    idTokenAlg: alg as IdTokenAlg,
    clockToleranceSeconds: tolerance,
  };
}
