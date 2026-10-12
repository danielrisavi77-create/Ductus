import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const owner = "@danielrisavi77-create";

const rules = readFileSync(`${root}.github/CODEOWNERS`, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"))
  .map((line) => line.split(/\s+/));

const patterns = new Set(rules.map(([pattern]) => pattern));

type Core = { D97_PATHS: string[]; d97Matches: (files: string[]) => string[] };

async function core(): Promise<Core> {
  const url = pathToFileURL(`${root}scripts/orchestrator/orchestrator-core.mjs`).href;
  return (await import(/* @vite-ignore */ url)) as Core;
}

async function d97Paths(): Promise<string[]> {
  return (await core()).D97_PATHS;
}

// Owned for the record, but outside D-97: product rules, not rules about who
// may write, review, merge or bypass a check.
const ownedOutsideD97 = new Set(["/docs/PRODUCT.md"]);

describe("CODEOWNERS covers the D-97 paths", () => {
  it("gives every rule the owner account and no rule clears an owner", () => {
    for (const [pattern, ...owners] of rules) {
      expect(pattern?.startsWith("!"), `${pattern} negates ownership`).toBe(false);
      expect(owners, `${pattern} owners`).toEqual([owner]);
    }
  });

  it("has a rule for every path in D97_PATHS", async () => {
    const paths = await d97Paths();
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const expected = path.endsWith("/") ? `/${path}**` : `/${path}`;
      expect(patterns.has(expected), `${path} -> ${expected}`).toBe(true);
    }
  });

  it("has every owned path in D97_PATHS, so the list is never narrower than this file", async () => {
    const { d97Matches } = await core();
    const missing = [...patterns]
      .filter((pattern) => !ownedOutsideD97.has(pattern))
      .filter((pattern) => {
        expect(pattern, "an owned pattern is a rooted file or a rooted directory/**").toMatch(/^\/[^*]+(\/\*\*)?$/);
        const path = pattern.slice(1).replace(/\*\*$/, "any/file.txt");
        return d97Matches([path]).length === 0;
      });
    expect(missing).toEqual([]);
  });

  it("covers the governance paths named by DAN-138 and the whole agent plugin", () => {
    for (const expected of [
      "/.claude/settings.json",
      "/.claude/skills/**",
      "/.claude/agents/**",
      "/scripts/hooks/**",
      "/scripts/orchestrator/**",
      "/lefthook.yml",
      "/docs/ORKESTRATOR.md",
      "/plugins/ductura-engineering/**",
    ]) {
      expect(patterns.has(expected), expected).toBe(true);
    }
  });
});
