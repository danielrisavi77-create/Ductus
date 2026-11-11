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

// A dollar-quote tag as PostgreSQL reads it: empty, or a letter or "_" and
// then letters, digits or "_". Right after a name character "$" belongs to
// the name, and "$1" is a parameter.
const DOLLAR_TAG = String.raw`\$(?:[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)?\$`;
const NAME_CHAR = /[\w$\u0080-\uffff]/;
const DOLLAR_START = new RegExp(`^${DOLLAR_TAG}`);

/** Index just past the dollar quote that starts at i, or i. */
function skipDollarQuote(source: string, i: number): number {
  if (NAME_CHAR.test(source[i - 1] ?? "")) return i;
  const tag = DOLLAR_START.exec(source.slice(i))?.[0];
  if (!tag) return i;
  const end = source.indexOf(tag, i + tag.length);
  return end === -1 ? source.length : end + tag.length;
}

/**
 * Index just past a comment, a string, a quoted name or a dollar quote that
 * starts at i, or i, by PostgreSQL's rules: block comments nest, a quote is
 * escaped by doubling it, and a backslash escapes only in an E'...' string.
 */
function skipSqlOpaque(source: string, i: number): number {
  if (source.startsWith("--", i)) {
    const end = source.indexOf("\n", i);
    return end === -1 ? source.length : end + 1;
  }
  if (source.startsWith("/*", i)) {
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
    return i;
  }
  const dollar = skipDollarQuote(source, i);
  if (dollar !== i) return dollar;
  const escapes = /[eE]/.test(source[i]) && source[i + 1] === "'" && !NAME_CHAR.test(source[i - 1] ?? "");
  const quote = escapes ? "'" : source[i];
  if (quote !== "'" && quote !== '"') return i;
  let j = escapes ? i + 2 : i + 1;
  while (j < source.length) {
    if (escapes && source[j] === "\\") j += 2;
    else if (source[j] !== quote) j++;
    else if (source[j + 1] === quote) j += 2;
    else return j + 1;
  }
  return source.length;
}

/**
 * The same as the text of a TS or JS file reads it: "//" comments, a block
 * comment ending at its first "*\/", and a backslash escape in any quote.
 */
function skipHostOpaque(source: string, i: number): number {
  const rest = source.slice(i);
  if (rest.startsWith("--") || rest.startsWith("//")) {
    const end = source.indexOf("\n", i);
    return end === -1 ? source.length : end + 1;
  }
  if (rest.startsWith("/*")) {
    const end = source.indexOf("*/", i + 2);
    return end === -1 ? source.length : end + 2;
  }
  const dollar = skipDollarQuote(source, i);
  if (dollar !== i) return dollar;
  const quote = source[i];
  if (quote === "'" || quote === '"' || quote === "`") {
    let j = i + 1;
    while (j < source.length && source[j] !== quote) j += source[j] === "\\" ? 2 : 1;
    return Math.min(j + 1, source.length);
  }
  return i;
}

type SkipOpaque = (source: string, i: number) => number;

// The check reads every text both ways and fails closed: a call or a SET that
// either reading lets outlive its transaction is a finding.
const READINGS: SkipOpaque[] = [skipSqlOpaque, skipHostOpaque];

/** Index of the next character that is not whitespace or a comment. */
function skipSpace(source: string, i: number, skipOpaque: SkipOpaque): number {
  for (;;) {
    while (i < source.length && /\s/.test(source[i])) i++;
    if (!source.startsWith("--", i) && !source.startsWith("/*", i)) return i;
    i = skipOpaque(source, i);
  }
}

interface SetConfigCall {
  index: number;
  args: string[];
  closed: boolean;
}

/**
 * The arguments of every set_config call, split at the commas of its own
 * parentheses. Strings, comments and nested calls inside an argument stay
 * whole, so a text like ", true)" inside one is no argument.
 */
function setConfigCalls(source: string, skipOpaque: SkipOpaque): SetConfigCall[] {
  const calls: SetConfigCall[] = [];
  // The name may be a quoted identifier, "set_config" or, in a TS string,
  // \"set_config\"; the closing quote belongs to the name.
  for (const match of source.matchAll(/\bset_config\b(?:\\?")?/gi)) {
    let i = skipSpace(source, match.index + match[0].length, skipOpaque);
    if (source[i] !== "(") continue;
    const args: string[] = [];
    let depth = 0;
    let start = ++i;
    let closed = false;
    while (i < source.length) {
      const next = skipOpaque(source, i);
      if (next !== i) {
        i = next;
        continue;
      }
      const char = source[i];
      if (char === "(") depth++;
      else if (char === ")" && depth-- === 0) {
        closed = true;
        break;
      } else if (char === "," && depth === 0) {
        args.push(source.slice(start, i));
        start = i + 1;
      }
      i++;
    }
    args.push(source.slice(start, i));
    calls.push({ index: match.index, args, closed });
  }
  return calls;
}

/** The literal word true, with only whitespace and comments around it. */
function isLiteralTrue(argument: string, skipOpaque: SkipOpaque): boolean {
  const start = skipSpace(argument, 0, skipOpaque);
  if (!/^true/i.test(argument.slice(start, start + 4))) return false;
  return skipSpace(argument, start + 4, skipOpaque) === argument.length;
}

// SET where a statement starts: at the start of the text, after a quote, a
// semicolon, a dollar quote, a comment, or a PL/pgSQL BEGIN, THEN, ELSE or
// LOOP, in any case. What follows SET is read by opensSessionSet.
const STATEMENT_SET = new RegExp(
  String.raw`(?:^|["'\`;]|(?<![\w$\u0080-\uffff])${DOLLAR_TAG}|\*\/|--[^\n]*\n|\b(?:BEGIN|THEN|ELSE|LOOP)\b)\s*SET\b`,
  "gi",
);

// SET LOCAL, SET TRANSACTION and SET CONSTRAINTS end with the transaction;
// "SET SESSION CHARACTERISTICS" is still caught.
const TRANSACTION_SCOPED = new Set(["LOCAL", "TRANSACTION", "CONSTRAINTS"]);

/**
 * Whether the SET that ends at i outlives its transaction. A comment counts
 * as whitespace, as it does for PostgreSQL. Read flat, "/* a /* b *\/ c *\/"
 * leaves "c"; either reading that leaves a session SET is enough.
 */
function opensSessionSet(source: string, i: number): boolean {
  return READINGS.some((skipOpaque) => {
    const start = skipSpace(source, i, skipOpaque);
    if (!/["A-Za-z_]/.test(source[start] ?? "")) return false;
    const word = /^[A-Za-z_]\w*/.exec(source.slice(start))?.[0] ?? "";
    const end = start + word.length;
    return !TRANSACTION_SCOPED.has(word.toUpperCase()) || skipSpace(source, end, skipOpaque) === end;
  });
}

/** Each forbidden set_config call, and each SET statement up to its line end. */
function sessionScoped(source: string): string[] {
  // One finding per call, worded as the first reading that rejects it.
  const calls = new Map<number, string>();
  for (const skipOpaque of READINGS) {
    for (const call of setConfigCalls(source, skipOpaque)) {
      if (calls.has(call.index)) continue;
      if (call.closed && call.args.length === 3 && isLiteralTrue(call.args[2], skipOpaque)) continue;
      calls.set(call.index, `set_config(${call.args.join(",")})`);
    }
  }
  const statements = [...source.matchAll(STATEMENT_SET)]
    .map((match) => match.index + match[0].length)
    .filter((end) => opensSessionSet(source, end))
    .map((end) => {
      const start = end - "SET".length;
      const lineEnd = source.indexOf("\n", start);
      return source.slice(start, lineEnd === -1 ? source.length : lineEnd);
    });
  return [...calls.values(), ...statements];
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

  // Review and QA on #1888, second round: the third argument as PostgreSQL
  // reads it, past nested comments, dollar quotes with any tag, E-strings,
  // doubled quotes and quoted names that hold ", true)".
  it.each([
    ["nested comment, one level", "SELECT set_config('app.session_token', 'x', /* a /* b */ true) */ false);"],
    ["nested comment, two levels", "SELECT set_config('a', 'x', /* a /* b /* c */ true) */ */ false);"],
    ["nested comments side by side", "set_config('a', $1, /* a /* b */ /* c */ true) */ false)"],
    ["nested comment around true", "set_config('a', $1, /* a /* b */ true */ false)"],
    ["unclosed nested comment", "set_config('a', $1, /* a /* b */ true)"],
    ["dollar tag with a digit", "SELECT set_config('app.session_token', $k3$x, true)$k3$, false);"],
    ["empty dollar tag", "set_config('a', $$x, true)$$, false)"],
    ["dollar tag starting with an underscore", "set_config('a', $_t$x, true)$_t$, false)"],
    ["dollar tag with an underscore and a digit", "set_config('a', $t_1$x, true)$t_1$, false)"],
    ["dollar tag with a letter outside ASCII", "set_config('a', $č$x, true)$č$, false)"],
    ["dollar quote closed only by its own tag", "set_config('a', $a$x, true)$b$ $a$, false)"],
    [", true) in a string", "set_config('a', ', true)', false)"],
    [", true) after a doubled quote", "set_config('a', 'it'', true)', false)"],
    [", true) in an E-string", "set_config('a', E'\\', true) ', false)"],
    [", true) in a lower case e-string", "set_config('a', e'\\', true) ', false)"],
    ["backslash in a standard string", "set_config('a', '\\', false) --', true)"],
    [", true) in a quoted name", 'set_config(\'a\', "x"", true)", false)'],
    [", true) in a dollar quote", "set_config('a', $q$, true)$q$, false)"],
  ])("rejects set_config whose real third argument is not true: %s", (_name, source) => {
    expect(sessionScoped(source), source).toHaveLength(1);
  });

  it.each([
    ["dollar tag with a digit", "set_config('a', $k3$x, false)$k3$, true)"],
    ["empty dollar tag", "set_config('a', $$x$$, true)"],
    ["dollar tag with an underscore", "set_config('a', $_t1$x$_t1$, true)"],
    ["positional parameter", "set_config($1, $2, true)"],
    ["E-string", "set_config('a', E'it\\'s', true)"],
    ["doubled quote", "set_config('a', 'it''s, false)', true)"],
    ["quoted name", 'set_config(\'a\', "x"", false)", true)'],
    ["comment around true", "set_config('a', $1, /* a */ true -- b\n)"],
  ])("accepts set_config whose real third argument is true: %s", (_name, source) => {
    expect(sessionScoped(source), source).toEqual([]);
  });

  it.each([
    ["dollar tag with a digit", "DO $k3$ SET role x; $k3$;"],
    ["dollar tag with an underscore", "DO $_b$\nSET app.x = '1';\n$_b$;"],
  ])("finds SET right after a dollar quote: %s", (_name, source) => {
    expect(sessionScoped(source), source).toHaveLength(1);
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
