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
  // The name may be a quoted identifier, "set_config" or, in a TS string,
  // \"set_config\"; the closing quote belongs to the name.
  for (const match of source.matchAll(/\bset_config\b(?:\\?")?/gi)) {
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
// LOOP, in any case. What follows SET is read by opensSessionSet.
const STATEMENT_SET = /(?:^|["'`;]|\$[A-Za-z_]*\$|\*\/|--[^\n]*\n|\b(?:BEGIN|THEN|ELSE|LOOP)\b)\s*SET\b/gi;

/**
 * Index of the next character that is not whitespace or a comment, with
 * PostgreSQL's nested block comments: "/* a /* b *\/ c *\/" is one comment.
 */
function skipSqlSpace(source: string, i: number): number {
  for (;;) {
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source.startsWith("--", i)) {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end + 1;
    } else if (source.startsWith("/*", i)) {
      let depth = 0;
      do {
        if (source.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (source.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      } while (depth > 0 && i < source.length);
    } else return i;
  }
}

// SET LOCAL, SET TRANSACTION and SET CONSTRAINTS end with the transaction;
// "SET SESSION CHARACTERISTICS" is still caught.
const TRANSACTION_SCOPED = new Set(["LOCAL", "TRANSACTION", "CONSTRAINTS"]);

/**
 * Whether the SET that ends at i outlives its transaction. A comment counts
 * as whitespace, as it does for PostgreSQL. A comment is read both as
 * PostgreSQL nests it and as a flat one; either reading that leaves a
 * session SET is enough.
 */
function opensSessionSet(source: string, i: number): boolean {
  return [skipSqlSpace, skipSpace].some((skip) => {
    const start = skip(source, i);
    if (!/["A-Za-z_]/.test(source[start] ?? "")) return false;
    const word = /^[A-Za-z_]\w*/.exec(source.slice(start))?.[0] ?? "";
    const end = start + word.length;
    return !TRANSACTION_SCOPED.has(word.toUpperCase()) || skip(source, end) === end;
  });
}

/** Each forbidden set_config call, and each SET statement up to its line end. */
function sessionScoped(source: string): string[] {
  const calls = setConfigArguments(source)
    .filter((args) => args.length !== 3 || !isLiteralTrue(args[2]))
    .map((args) => `set_config(${args.join(",")})`);
  const statements = [...source.matchAll(STATEMENT_SET)]
    .map((match) => match.index + match[0].length)
    .filter((end) => opensSessionSet(source, end))
    .map((end) => {
      const start = end - "SET".length;
      const lineEnd = source.indexOf("\n", start);
      return source.slice(start, lineEnd === -1 ? source.length : lineEnd);
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

/** A relative path with "/" between its parts, where on Windows relative() gives db\schema.sql. */
function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

/** The key a finding has in SQL_EXCEPTIONS. */
function findingKey(name: string, hit: string): string {
  return `${toPosix(name)}: ${hit.replace(/\s+/g, " ").trim()}`;
}

function sqlFindings(): string[] {
  const db = join(REPO_ROOT, "db");
  return sources(db, /\.sql$/).flatMap((file) => {
    const name = relative(REPO_ROOT, file);
    const source = readFileSync(file, "utf8");
    return sessionScoped(source).map((hit) => findingKey(name, hit));
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
      "SELECT pg_catalog.\"set_config\"('a', $1, true)",
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
      // QA on #1888: PostgreSQL reads "set_config" in quotes as the same name.
      "SELECT pg_catalog.\"set_config\"('app.session_token', 'x', false);",
      "SELECT \"set_config\"('a', $1, false)",
      "SELECT \"set_config\" /* r */ ('a', $1, false)",
      "SELECT pg_catalog.\"set_config\"-- r\n('a', $1, false)",
      'q("SELECT pg_catalog.\\"set_config\\"(\'a\', $1, false)")',
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

  // Review and QA on #1888: PostgreSQL reads a comment as whitespace, so a
  // comment between SET and the next word must not hide the statement.
  it.each([
    ["block comment", "SET /* r */ statement_timeout = 0;"],
    ["block comment, no space", "SET/* r */app.session_token = 'x';"],
    ["line comment", "SET -- r\n  statement_timeout = 0;"],
    ["line comment, no space", "SET--r\napp.session_token = 'x';"],
    ["nested block comment", "SET /* a /* b */ c */ app.x = 1;"],
    ["several comments", "SET /* a */ -- b\n /* c */ role x;"],
    ["comment before SET", "SELECT 1; /* r */ SET role x;"],
    ["comment, not LOCAL", "SET /* LOCAL */ app.x = 1;"],
    ["word starting with LOCAL", "SET /* r */ LOCAL_x = 1;"],
    ["in a string", "q(`SET/* r */app.session_token = 'x'`)"],
    ["in a PL/pgSQL block", "DO $$ BEGIN SET /* r */ role x; END $$;"],
    ["SESSION after a comment", "SET /* r */ SESSION AUTHORIZATION x;"],
    // Read flat, the comment ends at the first "*/" and leaves "c": the
    // check fails closed rather than trust one reading of the nesting.
    ["LOCAL after a nested comment", "SET /* a /* b */ c */ LOCAL role x;"],
  ])("finds SET without LOCAL past a comment: %s", (_name, source) => {
    expect(sessionScoped(source), source).toHaveLength(1);
  });

  it.each([
    ["LOCAL after a block comment", "SET /* r */ LOCAL role x;"],
    ["LOCAL after a line comment", "SET -- r\n LOCAL role x;"],
    ["comment after LOCAL", "SET LOCAL/* r */statement_timeout = 0;"],
    ["TRANSACTION after a comment", "SET/* r */TRANSACTION READ ONLY;"],
    ["CONSTRAINTS after a comment", "SET -- r\n CONSTRAINTS ALL DEFERRED;"],
    ["SET clause of an UPDATE", "UPDATE t SET /* r */ a = 1;"],
  ])("allows SET past a comment: %s", (_name, source) => {
    expect(sessionScoped(source), source).toEqual([]);
  });

  it.each([
    ["db\\schema.sql", "db/schema.sql"],
    ["db\\local\\migrator.sql", "db/local/migrator.sql"],
    ["db/tests\\010-roles-and-privileges.sql", "db/tests/010-roles-and-privileges.sql"],
    ["db/schema.sql", "db/schema.sql"],
  ])("compares the path %s to the exceptions as %s", (name, posix) => {
    expect(findingKey(name, "SET  statement_timeout = 0;\n")).toBe(`${posix}: SET statement_timeout = 0;`);
  });

  it("finds a listed exception under a Windows path", () => {
    expect(Object.keys(SQL_EXCEPTIONS)).toContain(findingKey("db\\schema.sql", "SET statement_timeout = 0;"));
    expect(Object.keys(SQL_EXCEPTIONS)).toContain(findingKey("db\\local\\migrator.sql", "SET ROLE ductus_migrator;"));
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
