// One rule for the database URLs of the integration tests, the same as
// e2e/login/local-db-url.ts: a postgres URL whose host is this machine, with
// no query and no fragment (F-167).
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const PROTOCOLS = new Set(["postgres:", "postgresql:"]);

/** True only for a plain postgres URL on this machine. */
export function isLoopbackDatabaseUrl(url: string): boolean {
  if (url.includes("?") || url.includes("#")) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return PROTOCOLS.has(parsed.protocol) && LOOPBACK_HOSTS.has(parsed.hostname);
}

/** Returns the URL unchanged, or throws the test's own message. */
export function requireLoopbackDatabaseUrl(url: string, message: string): string {
  if (!isLoopbackDatabaseUrl(url)) throw new Error(message);
  return url;
}
