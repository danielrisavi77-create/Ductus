import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { accountPlace } from "./nav";

// #802 part B: a signed-in person always has a way out and a way home. The
// unit project does not compile JSX, so the shell is read from the source,
// like shell-scope-coverage; the decisions themselves are pure functions.
const SCOPE = "c2NvcGUtb2YtYW4taW52ZW50ZWQtcGVyc29u";
const shell = readFileSync(join(process.cwd(), "src/components/shell/AppShell.tsx"), "utf8");

describe("accountPlace", () => {
  it("gives the sign-out to anyone with a scope, also without a role", () => {
    expect(accountPlace(SCOPE, false)).toBe("signOut");
  });

  it("gives nothing without a scope (signed out, or a session that could not be read)", () => {
    expect(accountPlace(null, false)).toBe("none");
  });

  it("keeps the page's own account (the workspace's LocalLogout) in its place", () => {
    expect(accountPlace(SCOPE, true)).toBe("own");
    expect(accountPlace(null, true)).toBe("own");
  });
});

describe("AppShell sign-out and Početna (#802 part B)", () => {
  it("decides the account place by accountPlace, not by the role", () => {
    expect(shell).toContain("const place = accountPlace(scope, account !== undefined);");
    expect(shell).toMatch(/place === "signOut" \? \(/);
    expect(shell).not.toMatch(/\) : role !== null \? \(\s*<ShellLogout/);
  });

  it("shows the role label next to the sign-out only with a role", () => {
    expect(shell).toMatch(/lead=\{role !== null \? <span className=\{styles\.who\}>\{t\.shell\.role\[role\]\}<\/span> : null\}/);
  });

  it("leads the brand and the first crumb, Početna, to homeHref(role)", () => {
    expect(shell).toContain("const home = homeHref(role);");
    expect(shell).toMatch(/<Link className=\{styles\.brand\} href=\{home\}/);
    const crumbs = shell.slice(shell.indexOf("aria-label={t.shell.breadcrumb}"));
    expect(crumbs).toMatch(/^[^]*?<Link\s+className=\{styles\.homeCrumb\}\s+href=\{home\}[^]*?\{t\.shell\.homeCrumb\}[^]*?\{crumbs\.map/);
  });

  it("keeps Početna in the top bar, outside the side bar's drawer", () => {
    const topbar = shell.indexOf("<header className={styles.topbar}>");
    expect(topbar).toBeGreaterThan(shell.indexOf("</aside>"));
    expect(shell.indexOf("styles.homeCrumb")).toBeGreaterThan(topbar);
  });

  it("says Početna and uses no forbidden term in the new home texts", () => {
    expect(t.shell.homeCrumb).toBe("Početna");
    expect(findForbiddenTerms([t.shell.homeCrumb, ...Object.values(t.home)].join(" "))).toEqual([]);
  });
});
