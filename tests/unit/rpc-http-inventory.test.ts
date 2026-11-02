import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import exceptions from "./rpc-http-exceptions.json";

// M2 exit condition (docs/PROGRAM-RAZRADA.md, DAN-487): every RPC that changes
// state has an HTTP route, or a written reason in rpc-http-exceptions.json.
//
// The catalogue is read from db/migrations, not from a database: the up part
// of each file in version order, where a later CREATE OR REPLACE wins and a
// DROP FUNCTION removes the entry. A function changes state when its last
// definition is neither STABLE nor IMMUTABLE, does not return trigger, and its
// body writes (INSERT INTO, UPDATE, DELETE FROM) or calls a function that does.
// A definition the parser cannot read ($$ or $tag$ body) stops the test. It
// has a route when a call "schema.name(" appears, outside comments, in a file
// that some app/api/**/route.ts reaches through its imports.
//
// Known limits: GRANT is not read (the reason in the list covers who may call
// a function), and a name built at run time or reached through EXECUTE
// format(...) is not seen.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = join(ROOT, "db/migrations");
const API = join(ROOT, "app/api");

type Fn = { volatile: boolean; trigger: boolean; body: string };
type Exception = {
  function: string;
  status: string;
  reason: string;
  ticket?: string;
};

const DOLLAR_RE = /\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/y;

/** Splits SQL into statements on ";" outside dollar-quoted bodies ($$ or $tag$), quotes and line comments. */
export function statements(sql: string): string[] {
  const out: string[] = [];
  let current = "";
  let tag: string | null = null;
  let i = 0;
  while (i < sql.length) {
    DOLLAR_RE.lastIndex = i;
    const quote = sql[i] === "$" ? DOLLAR_RE.exec(sql)?.[0] : undefined;
    if (quote && (tag === null || tag === quote)) {
      tag = tag === null ? quote : null;
      current += quote;
      i += quote.length;
    } else if (tag === null && sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
    } else if (tag === null && sql[i] === "'") {
      const end = sql.indexOf("'", i + 1);
      const stop = end < 0 ? sql.length : end + 1;
      current += sql.slice(i, stop);
      i = stop;
    } else if (tag === null && sql[i] === ";") {
      if (current.trim()) out.push(current.trim());
      current = "";
      i += 1;
    } else {
      current += sql[i];
      i += 1;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const BODY_RE = /(\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$)([\s\S]*?)\1/;

/** The functions that exist after every migration's up part, by schema.name. */
export function catalogue(
  files: { name: string; sql: string }[],
): Map<string, Fn> {
  const fns = new Map<string, Fn>();
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const up = file.sql.split(/--\s*migrate:down/)[0] ?? "";
    for (const statement of statements(up)) {
      const created =
        /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_]+\.[a-z_0-9]+)\s*\(/i.exec(
          statement,
        );
      const body = BODY_RE.exec(statement)?.[2];
      if (/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i.test(statement)) {
        // A definition this parser cannot read stops the inventory instead
        // of silently leaving a function out of it.
        if (!created?.[1] || body === undefined)
          throw new Error(`${file.name}: unreadable function definition`);
      }
      if (created?.[1] && body !== undefined) {
        const head = statement.replace(BODY_RE, "");
        fns.set(created[1].toLowerCase(), {
          volatile: !/\b(?:STABLE|IMMUTABLE)\b/i.test(head),
          trigger: /\bRETURNS\s+trigger\b/i.test(head),
          body: body.replace(/--[^\n]*/g, ""),
        });
        continue;
      }
      const dropped =
        /^DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([a-z_]+\.[a-z_0-9]+)/i.exec(
          statement,
        );
      if (dropped?.[1]) fns.delete(dropped[1].toLowerCase());
    }
  }
  return fns;
}

const WRITE_RE =
  /\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]+\.[a-z_0-9]+|DELETE\s+FROM)\b/i;

/** Callable, non-trigger functions that write directly or through a function they call. */
export function stateChanging(fns: Map<string, Fn>): string[] {
  const writes = new Set(
    [...fns].filter(([, fn]) => WRITE_RE.test(fn.body)).map(([name]) => name),
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, fn] of fns) {
      if (writes.has(name)) continue;
      if ([...writes].some((callee) => fn.body.includes(`${callee}(`))) {
        writes.add(name);
        grew = true;
      }
    }
  }
  return [...fns]
    .filter(([name, fn]) => fn.volatile && !fn.trigger && writes.has(name))
    .map(([name]) => name)
    .sort();
}

function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(ROOT, "src", specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * TypeScript source without // and /* *\/ comments. String and template
 * literal contents stay, because SQL calls are written inside them.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const char = source[i] ?? "";
    if (char === "'" || char === '"' || char === "`") {
      let end = i + 1;
      while (end < source.length && source[end] !== char)
        end += source[end] === "\\" ? 2 : 1;
      out += source.slice(i, end + 1);
      i = end + 1;
    } else if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end;
    } else if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      out += " ";
      i = end < 0 ? source.length : end + 2;
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

/** Source of every file an app/api route reaches, without comments. */
function routeReachableSource(): string {
  const seen = new Map<string, string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    const text = stripComments(readFileSync(file, "utf8"));
    seen.set(file, text);
    for (const match of text.matchAll(
      /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g,
    )) {
      const next = match[1] ? resolveImport(file, match[1]) : null;
      if (next) visit(next);
    }
  };
  const routes = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) routes(path);
      else if (entry.name === "route.ts") visit(path);
    }
  };
  routes(API);
  return [...seen.values()].join("\n");
}

const files = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), "utf8") }));
const fns = catalogue(files);
const rpcs = stateChanging(fns);
const routed = routeReachableSource();
const hasRoute = (name: string) => routed.includes(`${name}(`);
const listed = exceptions as Exception[];

describe("RPC to HTTP inventory (DAN-487)", () => {
  it("reads a real catalogue, so an empty parse cannot pass", () => {
    expect(fns.size).toBeGreaterThan(50);
    expect(rpcs).toContain("institution.create_course");
    expect(hasRoute("institution.create_course")).toBe(true);
    expect(fns.has("institution.actor_has_role")).toBe(true);
    expect(rpcs).not.toContain("institution.actor_has_role");
    expect(rpcs).not.toContain("audit.reject_change");
  });

  it("gives every state-changing RPC an HTTP route or a listed reason", () => {
    const names = new Set(listed.map((entry) => entry.function));
    expect(
      rpcs.filter((name) => !hasRoute(name) && !names.has(name)),
    ).toStrictEqual([]);
  });

  it("lists only state-changing RPCs that still have no route", () => {
    expect(
      listed
        .filter((entry) => !rpcs.includes(entry.function))
        .map((entry) => entry.function),
    ).toStrictEqual([]);
    expect(
      listed
        .filter((entry) => hasRoute(entry.function))
        .map((entry) => entry.function),
    ).toStrictEqual([]);
    expect(new Set(listed.map((entry) => entry.function)).size).toBe(
      listed.length,
    );
  });

  it("gives every entry a reason, and a ticket when the route is still to come", () => {
    for (const entry of listed) {
      expect(["bez rute", "ruta dolazi"], entry.function).toContain(
        entry.status,
      );
      expect(entry.reason.trim().length, entry.function).toBeGreaterThan(20);
      if (entry.status === "ruta dolazi")
        expect(entry.ticket ?? "", entry.function).toMatch(/^DAN-\d+$/);
    }
  });
});

describe("catalogue parser", () => {
  it("lets a later definition and a drop decide, and follows calls to a writer", () => {
    const parsed = catalogue([
      {
        name: "2_b.sql",
        sql: "CREATE OR REPLACE FUNCTION s.f() RETURNS int LANGUAGE sql STABLE AS $$ SELECT 1; $$;\nDROP FUNCTION s.gone();",
      },
      {
        name: "1_a.sql",
        sql: [
          "-- migrate:up",
          "CREATE FUNCTION s.f() RETURNS void LANGUAGE sql AS $$ INSERT INTO s.t VALUES (1); $$;",
          "CREATE FUNCTION s.gone() RETURNS void LANGUAGE sql AS $$ DELETE FROM s.t; $$;",
          "CREATE FUNCTION s.w() RETURNS void LANGUAGE sql AS $$ UPDATE s.t SET a = 1; $$;",
          "CREATE FUNCTION s.caller() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM s.w(); END $$;",
          "CREATE FUNCTION s.note() RETURNS void LANGUAGE sql AS $$ -- INSERT INTO s.t\n SELECT 1; $$;",
          "CREATE FUNCTION s.trg() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN DELETE FROM s.t; END $$;",
          "-- migrate:down",
          "CREATE FUNCTION s.down() RETURNS void LANGUAGE sql AS $$ DELETE FROM s.t; $$;",
        ].join("\n"),
      },
    ]);
    expect([...parsed.keys()].sort()).toStrictEqual([
      "s.caller",
      "s.f",
      "s.note",
      "s.trg",
      "s.w",
    ]);
    expect(stateChanging(parsed)).toStrictEqual(["s.caller", "s.w"]);
  });

  it("does not split a statement on a semicolon inside a body or a quote", () => {
    expect(
      statements("SELECT ';'; CREATE FUNCTION s.f() AS $$ a; b; $$;"),
    ).toStrictEqual(["SELECT ';'", "CREATE FUNCTION s.f() AS $$ a; b; $$"]);
  });

  it("reads a body quoted with a tagged delimiter", () => {
    const parsed = catalogue([
      {
        name: "1.sql",
        sql: "CREATE FUNCTION s.w() RETURNS void LANGUAGE plpgsql AS $rpc$ BEGIN UPDATE s.t SET a = '$$'; END $rpc$;\nCREATE FUNCTION s.f() RETURNS int LANGUAGE sql STABLE AS $$ SELECT 1; $$;",
      },
    ]);
    expect([...parsed.keys()]).toStrictEqual(["s.w", "s.f"]);
    expect(stateChanging(parsed)).toStrictEqual(["s.w"]);
  });

  it("stops on a function definition it cannot read", () => {
    expect(() =>
      catalogue([
        {
          name: "1.sql",
          sql: "CREATE FUNCTION s.w() RETURNS void LANGUAGE sql AS 'UPDATE s.t SET a = 1';",
        },
      ]),
    ).toThrow("1.sql: unreadable function definition");
  });

  it("drops calls inside line and block comments but keeps string contents", () => {
    const stripped = stripComments(
      [
        "const note = 0; /* institution.create_course( */",
        "// institution.remove_student(",
        "const url = 'https://example.test/a';",
        "await sql`SELECT institution.publish_assignment_version(${id})`;",
      ].join("\n"),
    );
    expect(stripped).not.toContain("institution.create_course(");
    expect(stripped).not.toContain("institution.remove_student(");
    expect(stripped).toContain("https://example.test/a");
    expect(stripped).toContain("institution.publish_assignment_version(");
  });
});
