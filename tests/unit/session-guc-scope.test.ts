import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// docs/BACKEND.md 4.3: a setting that outlives its transaction follows the
// pooled connection to the next request. Neither our code nor the driver may
// use SET without LOCAL or set_config(..., false).
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);
const driverEntry = require.resolve("pg");
const driver = dirname(driverEntry);
const driverPool = dirname(createRequire(driverEntry).resolve("pg-pool"));

function sessionScoped(source: string): string[] {
  const calls = source.match(/set_config\s*\([^)]*\)/gi) ?? [];
  // SET where a statement starts: after a quote, a semicolon or a comment, in
  // any case. SET LOCAL and SET TRANSACTION end with the transaction.
  const statements = source.match(/(?:["'`;]|\*\/|--[^\n]*\n)\s*SET\s+(?!LOCAL\s|TRANSACTION\s|CONSTRAINTS\s)[A-Za-z_]/gi) ?? [];
  return [...calls.filter((call) => !/,\s*true\s*\)$/.test(call)), ...statements];
}

function sources(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.(ts|tsx|js|mjs)$/.test(file) && !/node_modules|\.test\./.test(file))
    .map((file) => join(directory, file));
}

describe("session-scoped settings", () => {
  it("the check recognises what it forbids", () => {
    expect(sessionScoped("q(\"SELECT set_config('app.session_token', $1, false)\")")).toHaveLength(1);
    expect(sessionScoped("q('SET app.session_token = 1'); q(`SET SESSION ROLE x`)")).toHaveLength(2);
    expect(sessionScoped("q(\"SELECT set_config('a', $1, true)\"); q('SET LOCAL ROLE x')")).toEqual([]);
    // QA on #148: lower case, after a semicolon, after a comment.
    expect(sessionScoped("q('set app.session_token = 1')")).toHaveLength(1);
    expect(sessionScoped("q('SELECT 1; SET app.session_token = 1')")).toHaveLength(1);
    expect(sessionScoped("q(`COMMIT;set role ductus_app`)")).toHaveLength(1);
    expect(sessionScoped("q('SET SESSION AUTHORIZATION it_login')")).toHaveLength(1);
    expect(sessionScoped("q(`/* x */ SET role x`); q(`-- x\n  Set role y`)")).toHaveLength(2);
    expect(sessionScoped("q(`set local role x; SET TRANSACTION READ ONLY`); q('UPDATE t SET a = 1')")).toEqual([]);
  });

  it.each([
    ["src", join(REPO_ROOT, "src")],
    ["app", join(REPO_ROOT, "app")],
    ["pg", driver],
    ["pg-pool", driverPool],
  ])("%s has none", (_name, directory) => {
    const files = sources(directory);
    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap((file) => sessionScoped(readFileSync(file, "utf8")).map((hit) => `${file}: ${hit}`))).toEqual([]);
  });
});
