import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * F-137: every sign-out reads with the session its page was rendered under.
 * Read from the source, like shell-scope-coverage: rendering server
 * components needs a request.
 */
const ROOT = process.cwd();

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) ? [path] : [];
  });
}

/** Every opening tag `<name ...>` of a source, attributes included. */
function tags(source: string, name: string): string[] {
  const found: string[] = [];
  const open = new RegExp(`<${name}[\\s>]`, "g");
  for (const match of source.matchAll(open)) {
    let depth = 0;
    let end = match.index;
    for (; end < source.length; end += 1) {
      const c = source[end];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) break;
    }
    found.push(source.slice(match.index, end + 1));
  }
  return found;
}

const files = [...sources(join(ROOT, "app")), ...sources(join(ROOT, "src"))];

describe.each([["ShellLogout"], ["LocalDocumentProvider"]])("every <%s> gets the page's session", (name) => {
  const uses = files.flatMap((file) =>
    tags(readFileSync(file, "utf8"), name).map((tag) => [relative(ROOT, file).replaceAll("\\", "/"), tag] as const));

  it("is used", () => {
    expect(uses.length).toBeGreaterThan(0);
  });

  it.each(uses)("%s", (_file, tag) => {
    expect(tag).toMatch(/\ssession=\{/);
    expect(tag).not.toMatch(/\ssession=\{\s*(null|undefined)\s*\}/);
  });
});

describe("the sign-outs read with the session", () => {
  it("the shell hands ShellLogout its session", () => {
    const [tag] = tags(readFileSync(join(ROOT, "src/components/shell/AppShell.tsx"), "utf8"), "ShellLogout");
    expect(tag).toMatch(/\ssession=\{session\.tag === null \? null : \{ tag: session\.tag, at: session\.at \}\}/);
  });

  it("ShellLogout reads with it and leaves without posting", () => {
    const source = readFileSync(join(ROOT, "src/components/shell/ShellLogout.tsx"), "utf8");
    expect(source).toContain("readLogoutHold(scope, { session })");
    expect(source).toMatch(/step\.kind === "leave"\)\s*\{\s*window\.location\.assign\("\/"\);\s*return;/);
  });

  it("the editor's sign-out reads with it and leaves without posting", () => {
    const source = readFileSync(join(ROOT, "src/components/editor/LocalDocument.tsx"), "utf8");
    expect(source).toMatch(/editorSignOutPlan\(.*, scope, \{ session \}\);/);
    expect(source).not.toMatch(/readLogoutHold\(scope\)/);
    expect(source).toMatch(/next === "leave"\)\s*\{\s*window\.location\.assign\("\/"\);\s*return;/);
  });

  it("a tag without the session is caught", () => {
    const [tag] = tags('<ShellLogout scope={s} className="a">', "ShellLogout");
    expect(tag).not.toMatch(/\ssession=\{/);
  });
});
