import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// D-200 P2 (DAN-296): every accepted state-changing request counts as session
// activity, so every route handler that answers POST, PUT, PATCH or DELETE
// is wrapped in counted(). The exceptions are named: the auth routes, which
// open or close the session and must not touch it, and the handlers that
// refuse every such method (the API catch-all and the GET-only reads that
// answer the other methods with their GET refusal).
const REPO = process.cwd();
const METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;
const UNCOUNTED_DIR = "app/api/auth/";
const REFUSALS = new Set(["GET", "notFound", "notAllowed"]);

function routes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routes(path);
    return entry.name === "route.ts" ? [relative(REPO, path).replaceAll("\\", "/")] : [];
  });
}

/** How `file` exports `method`: "counted", a refusal name, "function", another name, or null. */
function exportOf(source: string, method: string): string | null {
  if (new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).test(source)) return "function";
  if (new RegExp(`export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`).test(source)) return "re-export";
  const match = new RegExp(`export\\s+const\\s+${method}\\s*(?::[^=]+)?=\\s*([A-Za-z_$][\\w$]*)\\s*(\\()?`).exec(source);
  if (!match) return null;
  return match[1] === "counted" && match[2] === "(" ? "counted" : match[1];
}

const all = routes(join(REPO, "app"));

describe("session activity on state-changing routes", () => {
  it("finds the route handlers", () => {
    expect(all).toContain("app/api/submission/route.ts");
    expect(all).toContain("app/api/teacher/fast-path/route.ts");
    expect(all).toContain("app/api/evidence/replay/route.ts");
  });

  it("wraps every POST, PUT, PATCH and DELETE outside the auth routes in counted() or refuses it", () => {
    const uncounted = all
      .filter((file) => !file.startsWith(UNCOUNTED_DIR))
      .flatMap((file) => {
        const source = readFileSync(join(REPO, file), "utf8");
        return METHODS.flatMap((method) => {
          const how = exportOf(source, method);
          return how === null || how === "counted" || REFUSALS.has(how) ? [] : [`${file} ${method}: ${how}`];
        });
      });
    expect(uncounted).toEqual([]);
  });

  it("reads each form of export it may meet", () => {
    expect(exportOf("export async function POST(r) {}", "POST")).toBe("function");
    expect(exportOf("export function PUT(r) {}", "PUT")).toBe("function");
    expect(exportOf("export const POST = counted(post);", "POST")).toBe("counted");
    expect(exportOf("export const POST: Handler = counted(post);", "POST")).toBe("counted");
    expect(exportOf("export const POST = post;", "POST")).toBe("post");
    expect(exportOf("export const PATCH = GET;", "PATCH")).toBe("GET");
    expect(exportOf("export { post as POST };", "POST")).toBe("re-export");
    expect(exportOf("export const GET = get;", "POST")).toBeNull();
  });
});
