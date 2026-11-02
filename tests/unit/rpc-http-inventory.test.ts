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
// SQL is read by one scanner that tells code from '...' and E'...'
// literals, "..." identifiers, $tag$ bodies and comments; volatility is read
// outside literals and brackets (two volatility words stop the test), and a
// write is looked for in the body without comments.
// A definition the parser cannot read, or an unclosed literal, body or
// comment, stops the test. A function has a route when a call "schema.name("
// appears, outside comments, in a file that some app/api/**/route.ts reaches
// through its imports. A call is matched
// without regard to case and with optional space before "(".
//
// Known limits (separate ticket): GRANT is not read (the reason in the list
// covers who may call a function); a name built at run time or a call
// through EXECUTE format(...) is not seen; a quoted function name stops the
// test and is not counted as a route; a call in a module a route imports
// counts even if it never runs; MERGE, TRUNCATE and COPY are not counted as
// writes; U&'...' literals are not read.

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

type Part = {
  kind: "code" | "string" | "ident" | "dollar" | "comment";
  text: string;
};

const DOLLAR_RE = /\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/y;
const IDENT_CHAR = /[A-Za-z_0-9$]/;

/**
 * Splits SQL into code, '...' and E'...' literals, "..." identifiers,
 * $tag$ bodies and comments (-- and nested block comments). An unclosed
 * literal, identifier, body or comment stops the inventory.
 */
export function scanSql(sql: string): Part[] {
  const parts: Part[] = [];
  let code = "";
  const push = (kind: Part["kind"], text: string) => {
    if (code) parts.push({ kind: "code", text: code });
    code = "";
    parts.push({ kind, text });
  };
  let i = 0;
  while (i < sql.length) {
    const char = sql[i] ?? "";
    const before = sql[i - 1] ?? "";
    DOLLAR_RE.lastIndex = i;
    const tag =
      char === "$" && !IDENT_CHAR.test(before)
        ? DOLLAR_RE.exec(sql)?.[0]
        : undefined;
    if (tag) {
      const end = sql.indexOf(tag, i + tag.length);
      if (end < 0) throw new Error("unclosed dollar quote");
      push("dollar", sql.slice(i, end + tag.length));
      i = end + tag.length;
    } else if (char === "'" || char === '"') {
      // E'...' takes backslash escapes; both forms double the quote to escape it.
      const escapes =
        char === "'" &&
        /[Ee]/.test(before) &&
        !IDENT_CHAR.test(sql[i - 2] ?? "");
      let end = i + 1;
      for (;;) {
        if (end >= sql.length) throw new Error("unclosed quote");
        if (escapes && sql[end] === "\\") end += 2;
        else if (sql[end] === char && sql[end + 1] === char) end += 2;
        else if (sql[end] === char) break;
        else end += 1;
      }
      push(char === "'" ? "string" : "ident", sql.slice(i, end + 1));
      i = end + 1;
    } else if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      const stop = end < 0 ? sql.length : end;
      push("comment", sql.slice(i, stop));
      i = stop;
    } else if (sql.startsWith("/*", i)) {
      // Block comments nest in PostgreSQL.
      let depth = 0;
      let end = i;
      do {
        if (end >= sql.length) throw new Error("unclosed block comment");
        if (sql.startsWith("/*", end)) depth += 1;
        else if (sql.startsWith("*/", end)) depth -= 1;
        else {
          end += 1;
          continue;
        }
        end += 2;
      } while (depth > 0);
      push("comment", sql.slice(i, end));
      i = end;
    } else {
      code += char;
      i += 1;
    }
  }
  if (code) parts.push({ kind: "code", text: code });
  return parts;
}

/** Splits SQL into statements on ";" in code only, and drops comments. */
export function statements(sql: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const part of scanSql(sql)) {
    if (part.kind === "comment") current += " ";
    else if (part.kind !== "code") current += part.text;
    else {
      const pieces = part.text.split(";");
      current += pieces.shift() ?? "";
      for (const piece of pieces) {
        if (current.trim()) out.push(current.trim());
        current = piece;
      }
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** The functions that exist after every migration's up part, by schema.name. */
export function catalogue(
  files: { name: string; sql: string }[],
): Map<string, Fn> {
  const fns = new Map<string, Fn>();
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    // dbmate reads the marker only at the start of a line.
    const up = file.sql.split(/^--\s*migrate:down/m)[0] ?? "";
    let parsed: string[];
    try {
      parsed = statements(up);
    } catch (error) {
      throw new Error(`${file.name}: ${(error as Error).message}`);
    }
    for (const statement of parsed) {
      const parts = scanSql(statement);
      // Code with literals, quoted identifiers and bodies as empty tokens.
      const head = parts
        .map((part) =>
          part.kind === "code"
            ? part.text
            : part.kind === "ident"
              ? '""'
              : "''",
        )
        .join("");
      const created =
        /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_]+\.[a-z_0-9]+)\s*\(/i.exec(
          statement,
        );
      // The body is the dollar-quoted part right after AS.
      const at = parts.findIndex(
        (part, index) =>
          part.kind === "dollar" &&
          /\bAS\s*$/i.test(parts[index - 1]?.text ?? ""),
      );
      const quoted = parts[at]?.text;
      const tag = quoted ? /^\$[^$]*\$/.exec(quoted)?.[0] : undefined;
      const body =
        quoted && tag ? quoted.slice(tag.length, -tag.length) : undefined;
      if (/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i.test(head)) {
        // A definition this parser cannot read stops the inventory instead
        // of silently leaving a function out of it.
        if (!created?.[1] || body === undefined)
          throw new Error(`${file.name}: unreadable function definition`);
        // Attributes sit outside brackets; a SET value is not one.
        let attributes = head;
        while (/\([^()]*\)/.test(attributes))
          attributes = attributes.replace(/\([^()]*\)/g, " ");
        attributes = attributes.replace(
          /\bSET\s+[\w.]+\s*(?:=|\bTO\b)\s*(?:''|""|[\w.]+)(?:\s*,\s*(?:''|""|[\w.]+))*/gi,
          " ",
        );
        const volatility =
          attributes.match(/\b(?:VOLATILE|STABLE|IMMUTABLE)\b/gi) ?? [];
        if (volatility.length > 1)
          throw new Error(`${file.name}: ambiguous volatility`);
        fns.set(created[1].toLowerCase(), {
          volatile: !/^(?:STABLE|IMMUTABLE)$/i.test(volatility[0] ?? ""),
          trigger: /\bRETURNS\s+trigger\b/i.test(attributes),
          // Literals stay in the body, so EXECUTE 'DELETE FROM ...' still counts.
          body: scanSql(body)
            .map((part) => (part.kind === "comment" ? " " : part.text))
            .join(""),
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

/** Whether text calls schema.name, in any case and with optional space before "(". */
export function calls(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z_0-9.])${escaped}\\s*\\(`, "i").test(text);
}

/** Callable, non-trigger functions that write directly or through a function they call. */
export function stateChanging(fns: Map<string, Fn>): string[] {
  const writes = new Set(
    [...fns].filter(([, fn]) => WRITE_RE.test(fn.body)).map(([name]) => name),
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, fn] of fns) {
      if (writes.has(name)) continue;
      if ([...writes].some((callee) => calls(fn.body, callee))) {
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
const hasRoute = (name: string) => calls(routed, name);
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

  it("counts a call written in another case or with space before the bracket", () => {
    const parsed = catalogue([
      {
        name: "1.sql",
        sql: [
          "CREATE FUNCTION s.w() RETURNS void LANGUAGE sql AS $$ UPDATE s.t SET a = 1; $$;",
          "CREATE FUNCTION s.spaced() RETURNS void LANGUAGE sql AS $$ SELECT s.w (); $$;",
          "CREATE FUNCTION s.upper() RETURNS void LANGUAGE sql AS $$ SELECT S.W(); $$;",
          "CREATE FUNCTION s.other() RETURNS void LANGUAGE sql AS $$ SELECT s.wx(); $$;",
        ].join("\n"),
      },
    ]);
    expect(stateChanging(parsed).sort()).toStrictEqual([
      "s.spaced",
      "s.upper",
      "s.w",
    ]);
    expect(calls("x.s.w()", "s.w")).toBe(false);
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

  it("reads a definition after a block comment", () => {
    const parsed = catalogue([
      {
        name: "1.sql",
        sql: "/* opis /* ugniježđeno */ ; */ CREATE FUNCTION s.w() RETURNS void LANGUAGE sql VOLATILE AS $$ UPDATE s.t SET a = 1; $$;",
      },
    ]);
    expect(stateChanging(parsed)).toStrictEqual(["s.w"]);
  });

  it("reads volatility outside literals and keeps writes after -- in a literal", () => {
    const parsed = catalogue([
      {
        name: "1.sql",
        sql: [
          "CREATE FUNCTION s.label(p_label text DEFAULT 'stable') RETURNS void LANGUAGE sql VOLATILE AS $$ DELETE FROM s.t WHERE a IS NOT NULL; $$;",
          'CREATE FUNCTION s.named("stable" int) RETURNS void LANGUAGE sql AS $$ DELETE FROM s.t; $$;',
          "CREATE FUNCTION s.bare(stable int) RETURNS TABLE (immutable int) LANGUAGE sql SET search_path = stable AS $$ DELETE FROM s.t RETURNING 1; $$;",
          "CREATE FUNCTION s.dash() RETURNS void LANGUAGE plpgsql VOLATILE AS $$ BEGIN PERFORM '--'; DELETE FROM s.t; END; $$;",
          "CREATE FUNCTION s.escaped() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE NOTICE E'\\';--'; DELETE FROM s.t; END $$;",
          "CREATE FUNCTION s.fixed(p text DEFAULT $$a$$) RETURNS void LANGUAGE sql AS $$ DELETE FROM s.t; $$;",
          "CREATE FUNCTION s.read() RETURNS int LANGUAGE sql STABLE AS $$ SELECT 1; $$;",
          "/* not a marker: -- migrate:down */",
          "CREATE FUNCTION s.after() RETURNS void LANGUAGE sql AS $$ DELETE FROM s.t; $$;",
        ].join("\n"),
      },
    ]);
    expect(parsed.get("s.read")?.volatile).toBe(false);
    expect(stateChanging(parsed)).toStrictEqual([
      "s.after",
      "s.bare",
      "s.dash",
      "s.escaped",
      "s.fixed",
      "s.label",
      "s.named",
    ]);
  });

  it("stops on two volatility words", () => {
    expect(() =>
      catalogue([
        {
          name: "1.sql",
          sql: "CREATE FUNCTION s.w() RETURNS void LANGUAGE sql STABLE VOLATILE AS $$ DELETE FROM s.t; $$;",
        },
      ]),
    ).toThrow("1.sql: ambiguous volatility");
  });

  it("stops on an unclosed quote, body or comment", () => {
    for (const sql of [
      "CREATE FUNCTION s.w() RETURNS void LANGUAGE sql AS $$ DELETE FROM s.t;",
      "SELECT 'open;",
      "/* open",
    ])
      expect(() => catalogue([{ name: "1.sql", sql }])).toThrow(
        /^1\.sql: unclosed/,
      );
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

  it("stops when a function definition does not start its statement", () => {
    expect(() =>
      catalogue([
        {
          name: "1.sql",
          sql: "SELECT 1 CREATE FUNCTION s.w() RETURNS void LANGUAGE sql AS $$ UPDATE s.t SET a = 1; $$;",
        },
      ]),
    ).toThrow("1.sql: unreadable function definition");
  });

  it("drops calls inside line and block comments but keeps string contents", () => {
    const stripped = stripComments(
      [
        "const note = 0; /* institution.create_course( */",
        "// institution.remove_student(",
        '// import "@/server/probe";',
        '/* import { x } from "./hidden"; */',
        "const url = 'https://example.test/a';",
        "await sql`SELECT institution.publish_assignment_version(${id})`;",
      ].join("\n"),
    );
    expect(stripped).not.toContain("institution.create_course(");
    expect(stripped).not.toContain("institution.remove_student(");
    expect(stripped).not.toContain("@/server/probe");
    expect(stripped).not.toContain("./hidden");
    expect(stripped).toContain("https://example.test/a");
    expect(stripped).toContain("institution.publish_assignment_version(");
  });
});
