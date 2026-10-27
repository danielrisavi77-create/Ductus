import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// #946: the postgres image's first-run setup server listens on the Unix socket
// only and is then stopped. A socket health check passed against it, and the
// next step met "the database system is shutting down". Over TCP the check
// passes only for the real server.
test("the postgres health check reaches the server over TCP, not the socket", () => {
  const compose = readFileSync(new URL("../../compose.yaml", import.meta.url), "utf8");
  const service = compose.split(/\n  (?=[a-z][\w-]*:\n)/).find((part) => part.startsWith("postgres:"));
  assert.ok(service, "compose.yaml has a postgres service");
  const check = service.match(/healthcheck:\s*\n\s*test:\s*(\[.*\])/)?.[1];
  assert.ok(check, "the postgres service has a health check");
  assert.match(check, /pg_isready\b[^"]*\s-h 127\.0\.0\.1\b/);
});
