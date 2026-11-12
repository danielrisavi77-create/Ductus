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

function files(dir: string, names: readonly string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path, names);
    return names.includes(entry.name) ? [path] : [];
  });
}

const relativePath = (file: string) => relative(ROOT, file).replaceAll("\\", "/");

/** Whether a route module answers GET, the method an address typed in the browser uses. */
function answersGet(source: string): boolean {
  return /export\s+(?:async\s+function|const|function)\s+GET\b/.test(source)
    || /export\s*\{[^}]*\bGET\b[^}]*\}/.test(source);
}

const GET_ROUTES = files(join(ROOT, "app/api/teacher"), ["route.ts"])
  .filter((file) => answersGet(readFileSync(file, "utf8")))
  .map(relativePath)
  .sort();

// Pages, layouts and route handlers under the two screen trees (QA pre-review
// on #1942, finding 2): a layout or a route placed beside a screen reads the
// same cookie.
const SCREEN_TREES = ["app/nastavnik", "app/ustanova"];
const SCREENS = SCREEN_TREES
  .flatMap((tree) => files(join(ROOT, tree), ["page.tsx", "layout.tsx", "route.ts"]))
  .map(relativePath)
  .sort();

/** The session cookie read by its name, through the constant or spelled out. */
const RAW_SESSION_READ = /SESSION_COOKIE_NAME|ductus_session/;

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

  it("would catch the cookie read by its constant or by its spelled-out name", () => {
    expect(RAW_SESSION_READ.test("jar.get(SESSION_COOKIE_NAME)?.value")).toBe(true);
    expect(RAW_SESSION_READ.test('jar.get("__Host-ductus_session")?.value')).toBe(true);
    expect(RAW_SESSION_READ.test("liveSessionToken(await cookies())")).toBe(false);
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
    expect(source).not.toMatch(RAW_SESSION_READ);
    if (source.includes("cookies")) expect(source).toMatch(/liveSessionToken\((await cookies\(\)|request\.cookies)\)/);
  });

  it("each GET route passes the live token on", () => {
    for (const file of GET_ROUTES) {
      expect(readFileSync(join(ROOT, file), "utf8")).toContain("sessionToken: liveSessionToken(request.cookies)");
    }
  });
});
