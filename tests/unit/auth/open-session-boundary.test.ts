import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// F-042 (DAN-174), D-09: `openSession` is reached only from the login
// routes. Three modules hand it on, and each may be imported only by the
// module named here: the session opener by the db module, `openSession` of
// the db module by the login dependencies, and the login dependencies by the
// three login routes. Every module of src/, app/ and the repository root is
// parsed with the TypeScript compiler, so comments, line breaks and quote
// style do not matter. A dynamic import or require whose module is not a
// constant string counts too, since its target cannot be read. Colocated
// tests are not shipped code and are left out.
const REPO = process.cwd();
const DB = "src/server/db";
const OPEN_SESSION = "src/server/db/open-session";
const LOGIN_DEPS = "src/server/auth/deps";
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const OPENERS = new Set(["openSession", "createOpenSession"]);

function files(dir: string, deep: boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return deep && entry.name !== "node_modules" ? files(path, deep) : [];
    return SOURCE.test(entry.name) && !TEST_FILE.test(entry.name) ? [path] : [];
  });
}

const posix = (path: string) => path.replaceAll("\\", "/");

/** The module a specifier names, relative to the repository, or null for a package. */
function target(file: string, specifier: string): string | null {
  let path: string;
  if (specifier.startsWith("@/")) path = join(REPO, "src", specifier.slice(2));
  else if (specifier.startsWith(".")) path = resolve(dirname(file), specifier);
  else return null;
  return posix(relative(REPO, path))
    .replace(SOURCE, "")
    .replace(/\/index$/, "");
}

/** May `importer` (relative to the repository) take this from the module `named`? */
function allowed(importer: string, named: string): boolean {
  if (named === OPEN_SESSION) return importer === "src/server/db/index.ts";
  if (named === DB) return importer === "src/server/auth/deps.ts";
  if (named === LOGIN_DEPS) return /^app\/api\/auth\/(?:login|callback|logout)\/route\.ts$/.test(importer);
  return true;
}

/** Whether a static import or export takes a session opener from the db module. */
function takesOpener(clause: ts.ImportClause | ts.NamedExportBindings | undefined): boolean {
  if (!clause) return true; // `export * from`
  if (ts.isNamespaceExport(clause) || ts.isNamespaceImport(clause)) return true;
  if (ts.isNamedExports(clause)) return clause.elements.some((e) => OPENERS.has((e.propertyName ?? e.name).text));
  if (clause.isTypeOnly) return false;
  const bindings = clause.namedBindings;
  if (!bindings) return clause.name !== undefined;
  if (ts.isNamespaceImport(bindings)) return true;
  return bindings.elements.some((e) => !e.isTypeOnly && OPENERS.has((e.propertyName ?? e.name).text));
}

/** Every way the text of `file` reaches a guarded module that it may not, as short descriptions. */
function guardedImports(file: string, text: string): string[] {
  const importer = posix(relative(REPO, file));
  const found: string[] = [];
  const check = (specifier: string, takes: boolean, how: string) => {
    const named = target(file, specifier);
    if (named === null || allowed(importer, named)) return;
    if (named === OPEN_SESSION || named === LOGIN_DEPS || (named === DB && takes)) found.push(`${how} ${specifier}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.importClause?.isTypeOnly) check(node.moduleSpecifier.text, takesOpener(node.importClause), "imports");
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) check(node.moduleSpecifier.text, takesOpener(node.exportClause), "re-exports");
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (ts.isStringLiteralLike(expression)) check(expression.text, true, "requires");
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteralLike(argument)) check(argument.text, true, "loads");
      else found.push("loads a module named at run time");
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
  return found;
}

function scan(): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const all = [...files(REPO, false), ...files(join(REPO, "src"), true), ...files(join(REPO, "app"), true)];
  for (const file of all) {
    const found = guardedImports(file, readFileSync(file, "utf8"));
    if (found.length > 0) result.set(posix(relative(REPO, file)), found);
  }
  return result;
}

describe("openSession import boundary", () => {
  it("is crossed by no module outside the login path", () => {
    expect(Object.fromEntries(scan())).toEqual({});
  });

  it("parses the real login path and allows exactly it", () => {
    const deps = join(REPO, "src", "server", "auth", "deps.ts");
    const db = join(REPO, "src", "server", "db", "index.ts");
    const route = join(REPO, "app", "api", "auth", "callback", "route.ts");
    // The same text from another module is refused, so the scan is not empty by accident.
    const elsewhere = join(REPO, "src", "server", "evidence", "x.ts");
    for (const real of [deps, db, route]) {
      const text = readFileSync(real, "utf8");
      expect(guardedImports(real, text)).toEqual([]);
      expect(guardedImports(elsewhere, text.replaceAll('"./', '"@/server/db/'))).not.toEqual([]);
    }
  });

  const at = join(REPO, "src", "server", "evidence", "x.ts");
  it.each([
    ["a named import", 'import { openSession } from "@/server/db";'],
    ["a renamed import", 'import {\n  withActor,\n  openSession as open,\n} from "@/server/db";'],
    ["a semicolon in a comment", 'import {\n  withActor, // a; b\n  openSession,\n} from "@/server/db";'],
    ["the factory", 'import { createOpenSession } from "@/server/db/open-session";'],
    ["a namespace import", 'import * as db from "@/server/db";'],
    ["a relative path", 'import { openSession } from "../db/index";'],
    ["a re-export", 'export { openSession } from "@/server/db";'],
    ["a star re-export", 'export * from "@/server/db";'],
    ["a dynamic import", 'const db = await import("@/server/db");'],
    ["a backtick specifier", "const db = await import(`@/server/db`);"],
    ["a computed specifier", 'const at = "@/server/db";\nconst db = await import(at);'],
    ["a require", 'const db = require("@/server/db");'],
    ["the login dependencies", 'import { authRoute } from "@/server/auth/deps";'],
    ["the login dependencies by a relative path", 'import { authRoute } from "../auth/deps";'],
  ])("finds %s", (_name, text) => {
    expect(guardedImports(at, text)).not.toEqual([]);
  });

  it.each([
    ["withActor alone", 'import { withActor } from "@/server/db";'],
    ["a type", 'import type { OpenSessionInput } from "@/server/db";'],
    ["a type of the login dependencies", 'import type { AuthDeps } from "@/server/auth/flow";'],
    ["another module", 'import { openSession } from "@/server/auth/flow";'],
    ["a name in a comment", '// import { openSession } from "@/server/db";\nexport const x = 1;'],
  ])("passes %s", (_name, text) => {
    expect(guardedImports(at, text)).toEqual([]);
  });
});
