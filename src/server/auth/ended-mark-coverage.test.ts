import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * DAN-99, contract on #1836: the institution and teacher screens, and the
 * teacher GET routes a person can open by typing the address, read the session
 * cookie only through liveSessionToken, so a session this browser has ended
 * shows no data there. Read from the source, like the other structural checks;
 * both lists are found on disk, so a new screen or GET route is checked too
 * (orchestrator, c.6798559359 item 2).
 */
const ROOT = process.cwd();

function files(dir: string, name: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path, name);
    return entry.name === name ? [path] : [];
  });
}

/** Whether a route module answers GET, the method an address typed in the browser uses. */
function answersGet(source: string): boolean {
  return /export\s+(?:async\s+function|const|function)\s+GET\b/.test(source)
    || /export\s*\{[^}]*\bGET\b[^}]*\}/.test(source);
}

const GET_ROUTES = files(join(ROOT, "app/api/teacher"), "route.ts")
  .filter((file) => answersGet(readFileSync(file, "utf8")))
  .map((file) => relative(ROOT, file).replaceAll("\\", "/"))
  .sort();

const SCREENS = [...files(join(ROOT, "app/nastavnik"), "page.tsx"), ...files(join(ROOT, "app/ustanova"), "page.tsx")]
  .map((file) => relative(ROOT, file).replaceAll("\\", "/"))
  .sort();

describe("ended sessions on institution and teacher screens (DAN-99)", () => {
  it("covers every screen named in the contract", () => {
    expect(SCREENS).toEqual(expect.arrayContaining([
      "app/nastavnik/page.tsx",
      "app/nastavnik/brz-put/page.tsx",
      "app/nastavnik/mentorstva/page.tsx",
      "app/nastavnik/zadatak/novi/page.tsx",
      "app/nastavnik/zadatak/[assignmentId]/uredi/page.tsx",
      "app/nastavnik/rad/[id]/page.tsx",
      "app/ustanova/page.tsx",
      "app/ustanova/pravila/page.tsx",
      "app/ustanova/kolegiji/page.tsx",
      "app/ustanova/korisnici/page.tsx",
    ]));
  });

  it("finds every teacher GET route named in the contract, and only routes that answer GET", () => {
    expect(GET_ROUTES).toEqual(expect.arrayContaining([
      "app/api/teacher/courses/route.ts",
      "app/api/teacher/mentorships/route.ts",
      "app/api/teacher/mentorships/[mentorshipId]/route.ts",
      "app/api/teacher/assignments/[assignmentId]/submissions/route.ts",
    ]));
    expect(GET_ROUTES).not.toContain("app/api/teacher/fast-path/route.ts");
  });

  it("would find a new GET route however it is exported", () => {
    expect(answersGet("export async function GET(request: NextRequest) {}")).toBe(true);
    expect(answersGet("export function GET() {}")).toBe(true);
    expect(answersGet("export const GET = handler;")).toBe(true);
    expect(answersGet("const handler = () => {};\nexport { handler as GET };")).toBe(true);
    expect(answersGet("export async function POST(request: NextRequest) {}")).toBe(false);
    expect(answersGet("export const GETTER = 1;")).toBe(false);
  });

  it.each([...SCREENS, ...GET_ROUTES])("%s reads the session only through liveSessionToken", (file) => {
    const source = readFileSync(join(ROOT, file), "utf8");
    expect(source).not.toMatch(/\.get\(\s*SESSION_COOKIE_NAME\s*\)/);
    expect(source).not.toContain("SESSION_COOKIE_NAME");
    if (source.includes("cookies")) expect(source).toMatch(/liveSessionToken\((await cookies\(\)|request\.cookies)\)/);
  });

  it("each GET route passes the live token on", () => {
    for (const file of GET_ROUTES) {
      expect(readFileSync(join(ROOT, file), "utf8")).toContain("sessionToken: liveSessionToken(request.cookies)");
    }
  });
});
