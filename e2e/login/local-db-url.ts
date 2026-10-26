// One place builds the test database URLs for the e2e seeds. They come from
// the same variables as before, with the compose database as the fallback,
// and only a database on this machine is accepted.
const ADMIN_FALLBACK = "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const APP_FALLBACK = "postgres://ductus_app_local:ductus-app-local-only@127.0.0.1:54329/ductus";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const PROTOCOLS = new Set(["postgres:", "postgresql:"]);

type Env = Readonly<Record<string, string | undefined>>;

/** Returns a plain local database URL unchanged, as scripts/demo/up.mjs accepts it, and throws otherwise. */
export function localDbUrl(url: string): string {
  const parsed = new URL(url);
  if (
    !PROTOCOLS.has(parsed.protocol) ||
    !LOCAL_HOSTS.has(parsed.hostname) ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("the e2e seed runs only against a local database");
  }
  return url;
}

/** The admin login of the compose database. */
export function localAdminUrl(env: Env = process.env): string {
  return localDbUrl(env.E2E_ADMIN_DATABASE_URL ?? ADMIN_FALLBACK);
}

/** The login of the web process, as the app server uses it. */
export function localAppUrl(env: Env = process.env): string {
  return localDbUrl(env.APP_DATABASE_URL ?? APP_FALLBACK);
}
