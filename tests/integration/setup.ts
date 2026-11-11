import { foreignDatabaseUrls } from "./loopback-database-url";

// F-019: the integration tests create, drop and write to databases, so they
// run only against this machine's database on the local port. Each set URL is
// checked before any test file loads; an unset one falls back to the local
// stack in the test itself.

const foreign = foreignDatabaseUrls(process.env);
if (foreign.length > 0) {
  throw new Error(
    `Integration tests run only against the local database (loopback host, port 54329 or 5432, no query): ${foreign.join(", ")}`,
  );
}
