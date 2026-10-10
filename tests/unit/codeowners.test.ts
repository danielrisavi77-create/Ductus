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

async function d97Paths(): Promise<string[]> {
  const url = pathToFileURL(`${root}scripts/orchestrator/orchestrator-core.mjs`).href;
  const mod = (await import(/* @vite-ignore */ url)) as { D97_PATHS: string[] };
  return mod.D97_PATHS;
}

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
