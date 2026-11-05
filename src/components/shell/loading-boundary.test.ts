import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/*
 * DAN-570 (#1541): Next.js renders the client chunks of a loading.tsx or
 * template.tsx boundary as `<script src async>` without the request nonce
 * (create-component-styles-and-scripts.js), and the page policy has
 * 'strict-dynamic', so the browser refuses them. Turbopack's chunk loader then
 * waits on a script that already failed, hydration of the page never ends and
 * a control such as "Upiši" stays disabled (F-7 on WebKit). A boundary that
 * reaches no client module has no such chunk. This scanner walks the import
 * graph of every boundary and names the first client module it reaches.
 */

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** Packages a server boundary may import: none of them is a client reference. */
const SERVER_PACKAGES = new Set(["react", "next/server", "next/headers", "server-only"]);
const STYLE = /\.(css|scss|sass)$/;
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs"];

type Files = (path: string) => string | undefined;

function hasUseClient(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === "use client") return true;
  }
  return false;
}

/** Specifiers that load code at runtime; type-only imports and exports are left out. */
function runtimeSpecifiers(source: ts.SourceFile): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.importClause?.isTypeOnly) found.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function resolveLocal(from: string, specifier: string, files: Files): string {
  const base = specifier.startsWith("@/") ? join("src", specifier.slice(2)) : join(dirname(from), specifier);
  const candidates = [base, ...EXTENSIONS.map((ext) => base + ext), ...EXTENSIONS.map((ext) => join(base, "index" + ext))];
  const hit = candidates.find((candidate) => files(candidate) !== undefined);
  // Fail closed: an import the scanner cannot follow could be a client module.
  if (!hit) throw new Error(`cannot resolve ${specifier} from ${from}`);
  return hit;
}

/** The import chain from `entry` to the first client module, or null when there is none. */
export function clientChain(entry: string, files: Files): string[] | null {
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]): string[] | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    const text = files(file);
    if (text === undefined) throw new Error(`cannot read ${file}`);
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
    if (hasUseClient(source)) return chain;
    for (const specifier of runtimeSpecifiers(source)) {
      if (STYLE.test(specifier)) continue;
      const local = specifier.startsWith(".") || specifier.startsWith("@/");
      if (!local) {
        if (!SERVER_PACKAGES.has(specifier)) return [...chain, specifier];
        continue;
      }
      const found = walk(resolveLocal(file, specifier, files), [...chain, specifier]);
      if (found) return found;
    }
    return null;
  };
  return walk(entry, [entry]);
}

function memoryFiles(entries: Record<string, string>): Files {
  return (path) => entries[path.replace(/\\/g, "/")];
}

describe("clientChain (DAN-570 input classes)", () => {
  const header = 'export default function H() { return null; }\n';
  it.each<[string, Record<string, string>, string[] | null]>([
    ["a direct directive", { "app/loading.tsx": '"use client";\nexport default 1;\n' }, ["app/loading.tsx"]],
    ["a single-quoted directive after a comment", { "app/loading.tsx": "// note\n'use client';\nexport default 1;\n" }, ["app/loading.tsx"]],
    ["'use client' that is not a directive", { "app/loading.tsx": 'const s = "x";\n"use client";\nexport default s;\n' }, null],
    [
      "a client module through @/",
      { "app/loading.tsx": 'import H from "@/c/H";\nexport default H;\n', "src/c/H.tsx": '"use client";\n' + header },
      ["app/loading.tsx", "@/c/H"],
    ],
    [
      "a client module through a relative import and an index",
      { "app/x/loading.tsx": 'import H from "../c";\nexport default H;\n', "app/c/index.ts": '"use client";\n' + header },
      ["app/x/loading.tsx", "../c"],
    ],
    [
      "next/link two levels down",
      {
        "app/loading.tsx": 'import H from "@/c/H";\nexport default H;\n',
        "src/c/H.tsx": 'import Link from "next/link";\n' + header,
      },
      ["app/loading.tsx", "@/c/H", "next/link"],
    ],
    ["an unknown package", { "app/loading.tsx": 'import x from "some-widget";\nexport default x;\n' }, ["app/loading.tsx", "some-widget"]],
    ["react and next/server", { "app/loading.tsx": 'import { createElement } from "react";\nimport { connection } from "next/server";\nexport default [createElement, connection];\n' }, null],
    [
      "type-only clauses skipped, an inline type specifier still loads the module",
      {
        "app/loading.tsx": 'import type { P } from "@/c/H";\nimport { type Q } from "next/link";\nexport type { R } from "@/c/H";\nexport default 1 as unknown as P;\n',
        "src/c/H.tsx": '"use client";\n' + header,
      },
      ["app/loading.tsx", "next/link"],
    ],
    ["a stylesheet and a CSS module", { "app/loading.tsx": 'import "./a.css";\nimport s from "@/c/b.module.css";\nexport default s;\n' }, null],
    [
      "a re-export",
      { "app/loading.tsx": 'export { default } from "@/c/H";\n', "src/c/H.tsx": '"use client";\n' + header },
      ["app/loading.tsx", "@/c/H"],
    ],
    [
      "a dynamic import",
      { "app/loading.tsx": 'export default () => import("@/c/H");\n', "src/c/H.tsx": '"use client";\n' + header },
      ["app/loading.tsx", "@/c/H"],
    ],
    [
      "an import cycle without a client module",
      { "app/loading.tsx": 'import "@/c/a";\nexport default 1;\n', "src/c/a.ts": 'import "./b";\n', "src/c/b.ts": 'import "./a";\n' },
      null,
    ],
  ])("%s", (_name, entries, expected) => {
    const entry = Object.keys(entries)[0]!;
    expect(clientChain(entry, memoryFiles(entries))).toEqual(expected);
  });

  it("refuses an import it cannot resolve", () => {
    const files = memoryFiles({ "app/loading.tsx": 'import H from "./missing";\nexport default H;\n' });
    expect(() => clientChain("app/loading.tsx", files)).toThrow(/cannot resolve \.\/missing/);
  });
});

function boundaries(dir: string): string[] {
  return readdirSync(join(REPO_ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return boundaries(path);
    return /^(loading|template)\.(tsx|ts|jsx|js)$/.test(entry.name) ? [path] : [];
  });
}

const repoFiles: Files = (path) => {
  const absolute = resolve(REPO_ROOT, path);
  if (!absolute.startsWith(REPO_ROOT) || !existsSync(absolute)) return undefined;
  try {
    return readFileSync(absolute, "utf8");
  } catch {
    return undefined;
  }
};

describe("loading and template boundaries in app/ (DAN-570)", () => {
  const found = boundaries("app");

  it("are found", () => {
    expect(found.map((path) => relative(REPO_ROOT, join(REPO_ROOT, path)))).toContain(join("app", "upis", "loading.tsx"));
  });

  it.each(found)("%s reaches no client module", (path) => {
    expect(clientChain(path, repoFiles)).toBeNull();
  });
});
