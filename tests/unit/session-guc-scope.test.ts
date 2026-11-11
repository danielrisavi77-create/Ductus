import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
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

/** Index just past a quoted text, a comment or a dollar quote that starts at i, or i. */
function skipOpaque(source: string, i: number): number {
  const rest = source.slice(i);
  if (rest.startsWith("--") || rest.startsWith("//")) {
    const end = source.indexOf("\n", i);
    return end === -1 ? source.length : end + 1;
  }
  if (rest.startsWith("/*")) {
    const end = source.indexOf("*/", i + 2);
    return end === -1 ? source.length : end + 2;
  }
  const dollar = /^\$[A-Za-z_]*\$/.exec(rest);
  if (dollar) {
    const end = source.indexOf(dollar[0], i + dollar[0].length);
    return end === -1 ? source.length : end + dollar[0].length;
  }
  const quote = source[i];
  if (quote === "'" || quote === '"' || quote === "`") {
    let j = i + 1;
    while (j < source.length && source[j] !== quote) j += source[j] === "\\" ? 2 : 1;
    return Math.min(j + 1, source.length);
  }
  return i;
}

/** Index of the next character that is not whitespace or a comment. */
function skipSpace(source: string, i: number): number {
  for (;;) {
    while (i < source.length && /\s/.test(source[i])) i++;
    const rest = source.slice(i);
    if (!rest.startsWith("--") && !rest.startsWith("/*")) return i;
    i = skipOpaque(source, i);
  }
}

/**
 * The arguments of every set_config call, split at the commas of its own
 * parentheses. Strings, comments and nested calls inside an argument stay
 * whole, so a text like ", true)" inside one is no argument.
 */
function setConfigArguments(source: string): string[][] {
  const calls: string[][] = [];
  for (const match of source.matchAll(/\bset_config\b/gi)) {
    let i = skipSpace(source, match.index + match[0].length);
    if (source[i] !== "(") continue;
    const args: string[] = [];
    let depth = 0;
    let start = ++i;
    while (i < source.length) {
      const next = skipOpaque(source, i);
      if (next !== i) {
        i = next;
        continue;
      }
      const char = source[i];
      if (char === "(") depth++;
      else if (char === ")" && depth-- === 0) break;
      else if (char === "," && depth === 0) {
        args.push(source.slice(start, i));
        start = i + 1;
      }
      i++;
    }
    args.push(source.slice(start, i));
    calls.push(args);
  }
  return calls;
}

/** The literal word true, with only whitespace and comments around it. */
function isLiteralTrue(argument: string): boolean {
  const bare = argument.replace(/\/\*[\s\S]*?\*\/|--[^\n]*/g, "").trim();
  return /^true$/i.test(bare);
}

// SET where a statement starts: at the start of the text, after a quote, a
// semicolon, a dollar quote, a comment, or a PL/pgSQL BEGIN, THEN, ELSE or
// LOOP, in any case. SET LOCAL, SET TRANSACTION and SET CONSTRAINTS end with
// the transaction; "SET SESSION CHARACTERISTICS" is still caught.
const STATEMENT_SET =
  /(?:^|["'`;]|\$[A-Za-z_]*\$|\*\/|--[^\n]*\n|\b(?:BEGIN|THEN|ELSE|LOOP)\b)\s*SET\s+(?!LOCAL\s|TRANSACTION\s|CONSTRAINTS\s)["A-Za-z_]/gi;

/** Each forbidden set_config call, and each SET statement up to its line end. */
function sessionScoped(source: string): string[] {
  const calls = setConfigArguments(source)
    .filter((args) => args.length !== 3 || !isLiteralTrue(args[2]))
    .map((args) => `set_config(${args.join(",")})`);
  const statements = [...source.matchAll(STATEMENT_SET)].map((match) => {
    const start = match.index + match[0].toUpperCase().lastIndexOf("SET");
    const end = source.indexOf("\n", start);
    return source.slice(start, end === -1 ? source.length : end);
  });
  return [...calls, ...statements];
}

function sources(directory: string, pattern = /\.(ts|tsx|js|mjs)$/): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((file) => pattern.test(file) && !/node_modules|\.test\./.test(file))
    .map((file) => join(directory, file));
}

// Session settings in SQL that never runs on the application's pool, each
// with its reason. The key is the file and the text the check reports.
const PG_DUMP = "pg_dump preamble: dbmate loads the snapshot over its own connection, never through the pool";
const SQL_EXCEPTIONS: Record<string, string> = {
  "db/schema.sql: SET statement_timeout = 0;": PG_DUMP,
  "db/schema.sql: SET lock_timeout = 0;": PG_DUMP,
  "db/schema.sql: SET idle_in_transaction_session_timeout = 0;": PG_DUMP,
  "db/schema.sql: SET transaction_timeout = 0;": PG_DUMP,
  "db/schema.sql: SET client_encoding = 'UTF8';": PG_DUMP,
  "db/schema.sql: SET standard_conforming_strings = on;": PG_DUMP,
  "db/schema.sql: set_config('search_path', '', false)": PG_DUMP,
  "db/schema.sql: SET check_function_bodies = false;": PG_DUMP,
  "db/schema.sql: SET xmloption = content;": PG_DUMP,
  "db/schema.sql: SET client_min_messages = warning;": PG_DUMP,
  "db/schema.sql: SET row_security = off;": PG_DUMP,
  "db/schema.sql: SET default_tablespace = '';": PG_DUMP,
  "db/schema.sql: SET default_table_access_method = heap;": PG_DUMP,
  "db/local/migrator.sql: SET ROLE ductus_migrator;":
    "local provisioning over its own psql session, ended with RESET ROLE; never the pool",
  "db/tests/010-roles-and-privileges.sql: SET on ductus_app for the local login is noticed'":
    "a pgTAP test description, not a statement; pgTAP runs over its own psql session",
};

function sqlFindings(): string[] {
  const db = join(REPO_ROOT, "db");
  return sources(db, /\.sql$/).flatMap((file) => {
    const name = relative(REPO_ROOT, file);
    const source = readFileSync(file, "utf8");
    return sessionScoped(source).map((hit) => `${name}: ${hit.replace(/\s+/g, " ").trim()}`);
  });
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

  // F-019: the last argument must be the literal true; anything else can be
  // false when it runs.
  it("accepts set_config only with a literal true as its third argument", () => {
    for (const source of [
      "set_config('a', $1, true)",
      "SET_CONFIG ( 'a' , $1 , TRUE )",
      "pg_catalog.set_config('a', format('%s', $1), true)",
      "set_config /* why */ ('a', $1, /* local */ true)",
      "set_config('a', ', false)', true)",
      "// set_config with is_local false is forbidden",
    ]) {
      expect(sessionScoped(source), source).toEqual([]);
    }
    for (const source of [
      "set_config('a', $1, $2)",
      "set_config('a', $1, is_local)",
      "q(`SELECT set_config('a', $1, ${local})`)",
      "set_config('a', $1, NOT false)",
      "set_config('a', $1, 'true')",
      "set_config('a', $1, true OR false)",
      "set_config('a', ', true)', false)",
      "set_config('a', format('%s', x), false)",
      "set_config /* x */ ('a', $1, false)",
      "set_config\n('a', $1, false)",
      "set_config('a', $1)",
      "set_config('a', $1, true, false)",
    ]) {
      expect(sessionScoped(source), source).toHaveLength(1);
    }
  });

  it("finds SET where an SQL file or a PL/pgSQL block starts a statement", () => {
    expect(sessionScoped("SET role ductus_app;")).toHaveLength(1);
    expect(sessionScoped("DO $$ BEGIN SET role x; END $$;")).toHaveLength(1);
    expect(sessionScoped("DO $body$\nSET app.x = '1';\n$body$;")).toHaveLength(1);
    expect(sessionScoped("IF a THEN set role x; ELSE Set role y; END IF;")).toHaveLength(2);
    expect(sessionScoped('SELECT 1;\nSET "app.x" = 1;')).toHaveLength(1);
    expect(sessionScoped("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;")).toHaveLength(1);
    for (const source of [
      "UPDATE t\n   SET a = 1;",
      "INSERT INTO t VALUES (1) ON CONFLICT (id) DO UPDATE SET a = 1;",
      "CREATE FUNCTION f() RETURNS void LANGUAGE sql\n    SET search_path TO '' AS $$ SELECT 1 $$;",
      "ALTER TABLE t ALTER COLUMN a SET DEFAULT 1;",
      "REFERENCES t (id) ON DELETE SET NULL",
      "BEGIN;\nSET LOCAL role ductus_app;\nCOMMIT;",
    ]) {
      expect(sessionScoped(source), source).toEqual([]);
    }
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

  it("db has none outside the listed exceptions, and every exception is still there", () => {
    const findings = sqlFindings();
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.filter((finding) => !(finding in SQL_EXCEPTIONS))).toEqual([]);
    expect(Object.keys(SQL_EXCEPTIONS).filter((key) => !findings.includes(key))).toEqual([]);
  });
});
