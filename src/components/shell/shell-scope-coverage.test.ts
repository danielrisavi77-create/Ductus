import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * D-118 sign-out dialog (#476 c.6396619831 §6 U5): the shell's sign-out reads
 * the signed-in person's journal before it posts, so every page in the shell
 * hands it the scope. Read from the source, like session-mark-coverage.
 */
const ROOT = process.cwd();

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pages(path);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

/** Every `<AppShell ...>` opening tag of a source, attributes included. */
function shellTags(source: string): string[] {
  const tags: string[] = [];
  for (let at = source.indexOf("<AppShell"); at !== -1; at = source.indexOf("<AppShell", at + 1)) {
    let depth = 0;
    let end = at;
    for (; end < source.length; end += 1) {
      const c = source[end];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) break;
    }
    tags.push(source.slice(at, end + 1));
  }
  return tags;
}

const shellPages = pages(join(ROOT, "app")).filter((file) => readFileSync(file, "utf8").includes("<AppShell"));

describe("every page in the shell hands its sign-out the scope (U5)", () => {
  it("finds the shell's pages", () => {
    const names = shellPages.map((file) => relative(ROOT, file).replaceAll("\\", "/"));
    expect(names).toEqual(expect.arrayContaining([
      "app/upis/page.tsx",
      "app/upis/kolegij/[courseId]/page.tsx",
      "app/zadatak/[id]/page.tsx",
      "app/rad/page.tsx",
      "app/rad/[assignmentId]/predaja/page.tsx",
      "app/nastavnik/page.tsx",
      "app/nastavnik/brz-put/page.tsx",
      "app/nastavnik/zadatak/novi/page.tsx",
      "app/nastavnik/rad/[id]/page.tsx",
    ]));
  });

  it.each(shellPages.map((file) => [relative(ROOT, file).replaceAll("\\", "/"), file]))("%s passes scope", (_name, file) => {
    const tags = shellTags(readFileSync(file, "utf8"));
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).toMatch(/\sscope=\{/);
  });

  it("the shell requires it and its default sign-out reads it", () => {
    const source = readFileSync(join(ROOT, "src/components/shell/AppShell.tsx"), "utf8");
    expect(source).toMatch(/^\s*scope: string \| null;$/m);
    expect(source).toMatch(/<ShellLogout\s+scope=\{scope\}/);
    expect(source).not.toContain('action="/api/auth/logout"');
  });

  it("a tag without the scope is caught", () => {
    expect(shellTags('<AppShell session={s} role={r} crumbs={[a]}>')[0]).not.toMatch(/\sscope=\{/);
  });
});
