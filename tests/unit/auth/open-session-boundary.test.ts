import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

// F-042 (DAN-174), D-09: `openSession` is reached only from the login
// dependencies. Any other module of src/ or app/ that imports it, its
// factory or its module fails here; colocated tests are not shipped code and
// are left out. A dynamic import of the db module counts, since what it
// takes from the module cannot be read from the specifier.
const REPO = process.cwd();
const ALLOWED = new Set(["src/server/auth/deps.ts", "src/server/db/index.ts"]);
const DB_MODULE = "src/server/db";
const OPEN_SESSION_MODULE = "src/server/db/open-session";
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : files(path);
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

const STATIC = /\b(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/g;
const DYNAMIC = /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Every way `file`'s text reaches openSession, as short descriptions. */
function openSessionImports(file: string, text: string): string[] {
  const found: string[] = [];
  for (const [, , typeOnly, clause, specifier] of text.matchAll(STATIC)) {
    if (typeOnly) continue;
    const named = target(file, specifier);
    if (named === OPEN_SESSION_MODULE) found.push(`imports ${specifier}`);
    else if (named === DB_MODULE && /\b(?:openSession|createOpenSession)\b|\*/.test(clause)) {
      found.push(`takes openSession from ${specifier}`);
    }
  }
  for (const [, specifier] of text.matchAll(DYNAMIC)) {
    const named = target(file, specifier);
    if (named === OPEN_SESSION_MODULE || named === DB_MODULE) found.push(`loads ${specifier} at run time`);
  }
  return found;
}

function scan(): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const root of ["src", "app"]) {
    for (const file of files(join(REPO, root))) {
      const found = openSessionImports(file, readFileSync(file, "utf8"));
      if (found.length > 0) result.set(posix(relative(REPO, file)), found);
    }
  }
  return result;
}

describe("openSession import boundary", () => {
  it("is imported by the login dependencies and the db module alone", () => {
    const importers = scan();
    const outside = [...importers.keys()].filter((path) => !ALLOWED.has(path));
    expect(outside).toEqual([]);
    // The scan sees the two real importers, so it is not empty by accident.
    expect([...importers.keys()].sort()).toEqual([...ALLOWED].sort());
  });

  const at = join(REPO, "src", "server", "evidence", "x.ts");
  it.each([
    ["a named import", 'import { openSession } from "@/server/db";'],
    ["a renamed import", 'import {\n  withActor,\n  openSession as open,\n} from "@/server/db";'],
    ["the factory", 'import { createOpenSession } from "@/server/db/open-session";'],
    ["a namespace import", 'import * as db from "@/server/db";'],
    ["a relative path", 'import { openSession } from "../db/index";'],
    ["a re-export", 'export { openSession } from "@/server/db";'],
    ["a star re-export", 'export * from "@/server/db";'],
    ["a dynamic import", 'const db = await import("@/server/db");'],
  ])("finds %s", (_name, text) => {
    expect(openSessionImports(at, text)).not.toEqual([]);
  });

  it.each([
    ["withActor alone", 'import { withActor } from "@/server/db";'],
    ["a type", 'import type { OpenSessionInput } from "@/server/db";'],
    ["another module", 'import { openSession } from "@/server/auth/flow";'],
  ])("passes %s", (_name, text) => {
    expect(openSessionImports(at, text)).toEqual([]);
  });
});
