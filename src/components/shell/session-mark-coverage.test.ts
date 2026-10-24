import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * F-113 t.1 (D-118): a sign-in returns to whichever page asked for it, so
 * every page that reads the session cookie has to mark the session for the
 * other tabs of the browser, directly or through a component it renders
 * (AppShell renders SessionObserver). Read from the source, like the other
 * structural checks: rendering server components needs a request.
 */
const ROOT = process.cwd();
const MARK = /<SessionObserver[\s/>]/;
const IMPORT = /import\s+(\w+)\s+from\s+"((?:@\/components\/|\.\.?\/)[^"]+)"/g;

function sourceFile(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, "src", spec.slice(2)) : resolve(dirname(from), spec);
  for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Whether `file` renders the session mark itself or through a component it renders. */
function marksSession(file: string, seen = new Set<string>()): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  const source = readFileSync(file, "utf8");
  if (MARK.test(source)) return true;
  for (const [, name, spec] of source.matchAll(IMPORT)) {
    if (!new RegExp(`<${name}[\\s/>]`).test(source)) continue;
    const target = sourceFile(file, spec);
    if (target !== null && marksSession(target, seen)) return true;
  }
  return false;
}

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pages(path);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

const cookiePages = pages(join(ROOT, "app")).filter((file) =>
  readFileSync(file, "utf8").includes("SESSION_COOKIE_NAME"),
);

describe("session mark on every page that reads the session cookie (F-113 t.1)", () => {
  it("finds the pages that a sign-in can return to", () => {
    const names = cookiePages.map((file) => relative(ROOT, file).replaceAll("\\", "/"));
    expect(names).toEqual(expect.arrayContaining([
      "app/page.tsx",
      "app/prijava/page.tsx",
      "app/rad/page.tsx",
      "app/upis/page.tsx",
      "app/zadatak/[id]/page.tsx",
      "app/nastavnik/brz-put/page.tsx",
    ]));
  });

  it.each(cookiePages.map((file) => [relative(ROOT, file).replaceAll("\\", "/"), file]))(
    "%s marks the session",
    (_name, file) => {
      expect(marksSession(file)).toBe(true);
    },
  );

  it("the shared shell marks it from a session every caller has to pass", () => {
    const shell = join(ROOT, "src/components/shell/AppShell.tsx");
    expect(marksSession(shell)).toBe(true);
    const source = readFileSync(shell, "utf8");
    expect(source).toMatch(/^\s*session: ShellSession;$/m);
    expect(source).toContain("<SessionObserver tag={session.tag} at={session.at} />");
  });

  it("a component without the mark does not count", () => {
    expect(marksSession(join(ROOT, "src/components/shell/SessionObserver.tsx"))).toBe(false);
  });
});
