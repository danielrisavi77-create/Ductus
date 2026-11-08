import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * DAN-313: a page that answers some callers with notFound() must not export a
 * static `metadata` title. The browser applies that title after the 404 is
 * drawn, so the tab would name a page that "does not exist". Read from the
 * source, like shell-scope-coverage.
 */
const ROOT = process.cwd();

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pages(path);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

const hiding = pages(join(ROOT, "app")).filter((file) => /\bnotFound\(\)/.test(readFileSync(file, "utf8")));

describe("a page that hides itself behind notFound() keeps the 404 title", () => {
  it("finds /ustanova, /ustanova/korisnici (DAN-581), /ustanova/kolegiji (DAN-591) and /ustanova/pravila (DAN-590) among those pages", () => {
    const found = hiding.map((file) => relative(ROOT, file).replaceAll("\\", "/"));
    expect(found).toContain("app/ustanova/page.tsx");
    expect(found).toContain("app/ustanova/korisnici/page.tsx");
    expect(found).toContain("app/ustanova/kolegiji/page.tsx");
    expect(found).toContain("app/ustanova/pravila/page.tsx");
  });

  it.each(hiding.map((file) => [relative(ROOT, file).replaceAll("\\", "/"), file]))("%s has no static metadata", (_name, file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(/export\s+const\s+metadata\b/);
  });
});
