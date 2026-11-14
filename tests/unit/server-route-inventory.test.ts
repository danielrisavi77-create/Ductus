import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// DAN-714 (server plan S-0.2): docs/backend/server-route-inventory.md lists every
// app/api/**/route.ts with its method, caller, input, output and target task.
const ROOT = join(__dirname, "..", "..");
const DOC = join(ROOT, "docs", "backend", "server-route-inventory.md");
const TARGET_ID = /^S-(M|1D|1E)-[A-Za-z0-9*]+$|^S-1M-a$|^S-1E-d$/;

function routeFiles(dir = join(ROOT, "app", "api")): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...routeFiles(path));
    else if (name === "route.ts") found.push(relative(ROOT, path).split("\\").join("/"));
  }
  return found.sort();
}

function parseInventory(markdown: string): { file: string; cells: string[] }[] {
  const rows: { file: string; cells: string[] }[] = [];
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("| `app/api/")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    rows.push({ file: cells[0]?.replace(/^`|`$/g, "") ?? "", cells });
  }
  return rows;
}

const COLUMNS = 6; // file, method, caller, input, output, target
const RATE_LIMITS = [/institution\.enroll_with_code/, /ZD429/];

describe("server route inventory (DAN-714)", () => {
  const markdown = readFileSync(DOC, "utf8");
  const rows = parseInventory(markdown);
  const files = routeFiles();

  it("sees the route files (the check itself is not vacuous)", () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files).toContain("app/api/[...path]/route.ts");
  });

  it("lists every route.ts file and nothing else", () => {
    expect(rows.map((row) => row.file).sort()).toEqual(files);
  });

  it("has no duplicate rows", () => {
    const names = rows.map((row) => row.file);
    expect(new Set(names).size).toBe(names.length);
  });

  it("fills all columns of every row", () => {
    for (const row of rows) {
      expect(row.cells.length, row.file).toBe(COLUMNS);
      for (const cell of row.cells) expect(cell, row.file).not.toBe("");
    }
  });

  it("gives every route a target task id from the allowed families", () => {
    for (const row of rows) {
      const ids = (row.cells[5] ?? "").split(",").map((id) => id.trim().replace(/`/g, ""));
      expect(ids.length, row.file).toBeGreaterThan(0);
      for (const id of ids) expect(id, row.file).toMatch(TARGET_ID);
    }
  });

  it("names every existing request rate limit", () => {
    const section = markdown.split(/^## /m).find((part) => part.startsWith("Ograničenja broja zahtjeva")) ?? "";
    for (const pattern of RATE_LIMITS) expect(section).toMatch(pattern);
  });

  it("rejects malformed inventories (the parser sees what the test relies on)", () => {
    expect(parseInventory("| `app/api/x/route.ts` | GET | a | b | c | S-M-* |")).toHaveLength(1);
    expect(parseInventory("| app/api/x/route.ts | GET |")).toHaveLength(0);
    for (const bad of ["S-M", "S-2D-1", "S-1D", "S-1M-b", "x S-M-1", "S-1E-"]) {
      expect(TARGET_ID.test(bad), bad).toBe(false);
    }
    for (const good of ["S-M-*", "S-1D-3", "S-1M-a", "S-1E-d", "S-1E-*"]) {
      expect(TARGET_ID.test(good), good).toBe(true);
    }
  });
});
