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
  const open = `<${name}`;
  for (let at = source.indexOf(open); at !== -1; at = source.indexOf(open, at + 1)) {
    if (!/[\s>]/.test(source[at + open.length] ?? "")) continue;
    let depth = 0;
    let end = at;
    for (; end < source.length; end += 1) {
      const c = source[end];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) break;
    }
    found.push(source.slice(at, end + 1));
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

  it("ShellLogout sends the editor's request and calls nothing ended without the route's confirmation (DAN-99, F-285)", () => {
    const source = readFileSync(join(ROOT, "src/components/shell/ShellLogout.tsx"), "utf8");
    expect(source).toContain("signOutHere(session, browserSignOutDeps())");
    // Only the latest attempt's confirmation follows on; anything else is unconfirmed.
    expect(source).toContain("reached && mine === attempt.current ? followLogoutNatively() : unanswered(mine)");
    expect(source).toContain("() => unanswered(mine)");
    expect(source).toMatch(/const unanswered = \(mine: number\) => \{\s*if \(mine !== attempt\.current\) return;/);
    // The device message is never shown from the shell: nothing sets it.
    expect(source).toContain("signedOutHere={false}");
    expect(source).not.toMatch(/setSignedOutHere|signedOutHere=\{(?!false\})/);
    expect(source).toContain("unconfirmed={unconfirmed}");
    // "Ostani" retires the attempt that may still be running.
    expect(source).toMatch(/const stay = \(\) => \{\s*attempt\.current \+= 1;/);
    // Only where the page reads the mark; elsewhere the form posts as before.
    expect(source).toMatch(/if \(!endsOnDevice\) \{\s*formRef\.current\?\.submit\(\);\s*return;\s*\}\s*const mine = \+\+attempt\.current;\s*void signOutHere/);
    // Without JS the form still posts (I5).
    expect(source).toContain('<form ref={formRef} method="post" action="/api/auth/logout"');
    const shell = readFileSync(join(ROOT, "src/components/shell/AppShell.tsx"), "utf8");
    expect(tags(shell, "ShellLogout")[0]).toContain("endsOnDevice={endsOnDevice}");
    const editor = readFileSync(join(ROOT, "src/components/editor/LocalDocument.tsx"), "utf8");
    expect(editor).toMatch(/import \{ followLogoutNatively, postLogout \} from "@\/client\/logout-request";/);
  });

  it("the editor's sign-out reads with it and leaves without posting", () => {
    const source = readFileSync(join(ROOT, "src/components/editor/LocalDocument.tsx"), "utf8");
    expect(source).toMatch(/editorSignOutPlan\(.*, scope, \{ session \}\);/);
    expect(source).not.toMatch(/readLogoutHold\(scope\)/);
    expect(source).toMatch(/next === "leave"\)\s*\{\s*window\.location\.assign\("\/"\);\s*return;/);
  });

  // A page whose server does not read the mark would keep rendering for a
  // session the dialog calls ended (student screens, `/`).
  it.each(files.filter((file) => /[\\/]page\.tsx$/.test(file)).flatMap((file) =>
    tags(readFileSync(file, "utf8"), "AppShell").map((tag) => [relative(ROOT, file).replaceAll("\\", "/"), file, tag] as const)))(
    "%s ends on the device only where it reads the mark", (_name, file, tag) => {
      expect(/\sendsOnDevice[\s=>]/.test(tag)).toBe(readFileSync(file, "utf8").includes("liveSessionToken("));
    });

  it("a tag without the session is caught", () => {
    const [tag] = tags('<ShellLogout scope={s} className="a">', "ShellLogout");
    expect(tag).not.toMatch(/\ssession=\{/);
  });
});
