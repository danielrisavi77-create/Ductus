// One rule for the database URLs of the integration tests, the same as
// e2e/login/local-db-url.ts: a postgres URL whose host is this machine, with
// no query and no fragment (F-167), on the local port (F-019).
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const PROTOCOLS = new Set(["postgres:", "postgresql:"]);
// 54329: compose, the native stack and CI; 5432: scripts/db/native-db.mjs.
// A URL without a port would take PGPORT from the environment.
const LOCAL_PORTS = new Set(["54329", "5432"]);
// Text that the driver and URL could split differently: whitespace, a
// backslash, a second "@" or a "%" that is no escape.
const AMBIGUOUS = /[\s\\]|@.*@|%(?![0-9A-Fa-f]{2})/u;

/** True only for a plain postgres URL on this machine. */
export function isLoopbackDatabaseUrl(url: string): boolean {
  if (url.includes("?") || url.includes("#") || AMBIGUOUS.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return PROTOCOLS.has(parsed.protocol) && LOOPBACK_HOSTS.has(parsed.hostname) && LOCAL_PORTS.has(parsed.port);
}

/** Returns the URL unchanged, or throws the test's own message. */
export function requireLoopbackDatabaseUrl(url: string, message: string): string {
  if (!isLoopbackDatabaseUrl(url)) throw new Error(message);
  return url;
}

/** The variables the integration tests read a database URL from. */
export const DATABASE_URL_VARIABLES = ["DATABASE_URL", "APP_DATABASE_URL", "AUTH_DATABASE_URL"] as const;

/** Names of the set variables whose URL is not a local database. */
export function foreignDatabaseUrls(env: Record<string, string | undefined>): string[] {
  return DATABASE_URL_VARIABLES.filter((name) => env[name] !== undefined && !isLoopbackDatabaseUrl(env[name] ?? ""));
}
