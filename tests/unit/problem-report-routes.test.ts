import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BROWSER_FAMILIES,
  PROBLEM_REPORT_CATEGORIES,
  PROBLEM_REPORT_DESCRIPTION_MAX,
  PROBLEM_REPORT_ROUTES,
  isAppVersion,
  isProblemDescription,
  problemReportRoute,
} from "@/domain/support/problem-report";
import { SYNC_STATES } from "@/domain/sync/states";

// DAN-431: the migration's CHECKs and the domain module are one contract; a
// value one accepts and the other refuses is a report lost or a class widened.
const ROOT = join(import.meta.dirname, "..", "..");
const MIGRATION = readFileSync(join(ROOT, "db/migrations/20261112110000_problem_report.sql"), "utf8");
const UP = MIGRATION.slice(0, MIGRATION.indexOf("-- migrate:down"));

/** The quoted members of a `CHECK (route IN (...))` that replaces problem_report_route_check. */
function routeCheck(sql: string): string[] {
  const match = /ADD CONSTRAINT problem_report_route_check\s+CHECK \(route IN \(([^)]*)\)\)/.exec(sql);
  if (!match?.[1]) throw new Error("no route CHECK");
  return [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1] ?? "");
}

/** Later migrations that replace the route CHECK, oldest first (DAN-429, /stanje). */
const ROUTE_MIGRATIONS = readdirSync(join(ROOT, "db/migrations"))
  .filter((name) => name > "20261112110000_problem_report.sql" && name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(join(ROOT, "db/migrations", name), "utf8"))
  .filter((sql) => sql.includes("problem_report_route_check"))
  .map((sql) => ({ up: sql.slice(0, sql.indexOf("-- migrate:down")), down: sql.slice(sql.indexOf("-- migrate:down")) }));

/** Every `page.tsx` under app/, as the route template Next.js serves it. */
function appPages(dir = join(ROOT, "app")): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...appPages(path));
    else if (entry.name === "page.tsx") {
      const folder = relative(join(ROOT, "app"), dir).split(sep).join("/");
      found.push(folder === "" ? "/" : `/${folder}`);
    }
  }
  return found.sort();
}

/** The quoted members of `column ... IN (...)` in the table's CHECK. */
function checkSet(column: string): string[] {
  const match = new RegExp(`\\n  ${column} text[^\\n]*CHECK \\(${column} IN \\(([^)]*)\\)`, "s").exec(UP);
  if (!match?.[1]) throw new Error(`no CHECK set for ${column}`);
  return [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1] ?? "");
}

/**
 * Routes the CHECK already allows ahead of their pages, and the PRs that add
 * the page (orchestrator, #1836 c.6820309956, c.6820715294, c.6821821996). None
 * is left: /kako-radi is on main (#1973) and /stanje has its page in this PR.
 * A route allowed here only while its page is absent; once the page is on the
 * branch the route must be in the domain set.
 */
const ROUTES_AHEAD_OF_PAGE: readonly string[] = [];

function pageFile(route: string): string {
  return join(ROOT, route === "/" ? "app/page.tsx" : `app${route}/page.tsx`);
}

describe("DAN-431 problem report: migration and domain agree", () => {
  it("every closed set is the same in both", () => {
    const latest = ROUTE_MIGRATIONS.at(-1);
    expect(latest).toBeDefined();
    const ahead = ROUTES_AHEAD_OF_PAGE.filter((route) => !existsSync(pageFile(route)));
    expect(routeCheck(latest?.up ?? "")).toEqual([...PROBLEM_REPORT_ROUTES, ...ahead].sort());
    expect([...PROBLEM_REPORT_ROUTES].sort()).toEqual([...PROBLEM_REPORT_ROUTES]);
    for (const route of ahead) expect(PROBLEM_REPORT_ROUTES).not.toContain(route);
    expect(checkSet("category")).toEqual([...PROBLEM_REPORT_CATEGORIES]);
    expect(checkSet("browser_family")).toEqual([...BROWSER_FAMILIES]);
    expect(checkSet("sync_state")).toEqual([...SYNC_STATES]);
  });

  it("each route CHECK keeps every earlier route, and its down removes only routes it added", () => {
    let before = checkSet("route");
    for (const { up, down } of ROUTE_MIGRATIONS) {
      const after = routeCheck(up);
      const restored = routeCheck(down);
      expect(after.filter((route) => !before.includes(route))).not.toEqual([]);
      expect(before.filter((route) => !after.includes(route))).toEqual([]);
      expect([...after].sort()).toEqual(after);
      // The down keeps every earlier route, stays inside the up, and removes at least one route.
      expect(before.filter((route) => !restored.includes(route))).toEqual([]);
      expect(restored.filter((route) => !after.includes(route))).toEqual([]);
      expect(restored.length).toBeLessThan(after.length);
      before = after;
    }
    expect(before).toContain("/stanje");
    expect(before).toContain("/kako-radi");
    expect(before).toContain("/rad/[assignmentId]/dnevnik-pristupa");
  });

  it("the /kako-radi down removes only /kako-radi", () => {
    const own = ROUTE_MIGRATIONS.find(({ up }) => routeCheck(up).includes("/kako-radi"));
    expect(own).toBeDefined();
    const after = routeCheck(own?.up ?? "");
    expect(routeCheck(own?.down ?? "")).toEqual(after.filter((route) => route !== "/kako-radi"));
  });

  it("the /stanje down removes only /stanje", () => {
    const own = ROUTE_MIGRATIONS.find(({ up }) => routeCheck(up).includes("/stanje"));
    expect(own).toBeDefined();
    const after = routeCheck(own?.up ?? "");
    expect(routeCheck(own?.down ?? "")).toEqual(after.filter((route) => route !== "/stanje"));
  });

  it("the description length, the app version pattern and the character classes are the same", () => {
    expect(UP).toContain(`char_length(description) BETWEEN 1 AND ${PROBLEM_REPORT_DESCRIPTION_MAX}`);
    const source = readFileSync(join(ROOT, "src/domain/support/problem-report.ts"), "utf8");
    const tsVersion = /const APP_VERSION = \/(.*)\/;/.exec(source)?.[1];
    expect(tsVersion).toBeDefined();
    expect(UP).toContain(`app_version ~ '${tsVersion}'`);
    const tsVisible = /const VISIBLE =\s*\/(\[\^[^\]]*\])\/u;/.exec(source)?.[1];
    expect(tsVisible).toBeDefined();
    expect(UP).toContain(`description ~ '${tsVisible}'`);
    const tsBidi = /const BIDI = \/\[([^\]]*)\]\/u;/.exec(source)?.[1];
    expect(tsBidi).toBeDefined();
    expect(UP).toMatch(new RegExp(`description !~ '\\[[^\\]]*${tsBidi?.replace(/\\/g, "\\\\")}\\]'`));
  });

  it("the shared limits hold at their edges in the domain", () => {
    expect(isProblemDescription("x".repeat(PROBLEM_REPORT_DESCRIPTION_MAX))).toBe(true);
    expect(isProblemDescription("x".repeat(PROBLEM_REPORT_DESCRIPTION_MAX + 1))).toBe(false);
    expect(isAppVersion("9999.9999.9999+" + "f".repeat(40))).toBe(true);
    expect(isAppVersion("10000.0.0")).toBe(false);
  });
});

describe("DAN-431 problem report: route templates are real pages", () => {
  it.each(PROBLEM_REPORT_ROUTES)("%s has an app page", (route) => {
    expect(existsSync(pageFile(route))).toBe(true);
  });

  it("every app page has a route template, so a new page cannot be reported without one", () => {
    const pages = appPages();
    expect(pages.length).toBeGreaterThan(20);
    expect(pages.filter((page) => !(PROBLEM_REPORT_ROUTES as readonly string[]).includes(page))).toEqual([]);
  });

  it.each(PROBLEM_REPORT_ROUTES)("%s maps back to itself", (route) => {
    expect(problemReportRoute(route)).toBe(route);
  });
});
