import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Project skills exist once per runtime (docs/MULTI-ACCOUNT.md §5). The
// .claude and .agents copies of a skill must be byte-identical; D-114 names
// .agents/skills as canonical for the six previously drifting skills. Skills
// from the ductura-engineering plugin are canonical there and both runtime
// copies are thin adapters that pin the canonical SKILL.md by SHA-256.
const root = fileURLToPath(new URL("../../", import.meta.url));
const runtimes = [".claude/skills", ".agents/skills"] as const;
const plugin = "plugins/ductura-engineering/skills";

// Skills that intentionally exist in one runtime only.
const singleLocation: Record<string, string> = {
  "supabase-postgres-best-practices":
    "third-party copy in .claude/skills only, not an adapter (docs/REPOZITORIJI.md, DAN-96)",
};

function skillNames(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    .sort();
}

const [claude, agents] = runtimes.map(skillNames) as [string[], string[]];
const shared = claude.filter((name) => agents.includes(name));

describe("skill copies", () => {
  it("has every skill in both runtimes unless listed as single-location", () => {
    for (const name of [...new Set([...claude, ...agents])]) {
      const where = runtimes.filter((dir) => existsSync(join(root, dir, name)));
      if (name in singleLocation) {
        expect(where, `${name} is listed as single-location but exists in both`).toHaveLength(1);
      } else {
        expect(where, `${name} exists only in ${where.join(", ")}`).toEqual([...runtimes]);
      }
    }
  });

  it("keeps the .claude and .agents copies of each skill byte-identical", () => {
    const drift: string[] = [];
    for (const name of shared) {
      const [a, b] = runtimes.map((dir) => join(root, dir, name));
      const [fa, fb] = [files(a!), files(b!)];
      for (const file of [...new Set([...fa, ...fb])].sort()) {
        const key = `${name}/${file}`;
        if (!fa.includes(file) || !fb.includes(file)) {
          drift.push(`${key}: only in ${fa.includes(file) ? runtimes[0] : runtimes[1]}`);
        } else if (!readFileSync(join(a!, file)).equals(readFileSync(join(b!, file)))) {
          drift.push(`${key}: content differs`);
        }
      }
    }
    expect(drift, "skill copies must stay aligned with the canonical project skills").toEqual([]);
  });

  it("pins each plugin skill's canonical SKILL.md in both runtime adapters", () => {
    const names = skillNames(plugin);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const digest = createHash("sha256")
        .update(readFileSync(join(root, plugin, name, "SKILL.md")))
        .digest("hex");
      for (const dir of runtimes) {
        const adapter = join(dir, name, "SKILL.md");
        expect(existsSync(join(root, adapter)), `${adapter} missing`).toBe(true);
        const pinned = /SHA256: `([0-9a-f]{64})`/.exec(readFileSync(join(root, adapter), "utf8"))?.[1];
        expect(pinned, `${adapter} pins a different canonical digest than ${plugin}/${name}/SKILL.md`).toBe(
          digest,
        );
      }
      // agents/ and assets/ live only in the canonical plugin package; the
      // adapters link to it instead of copying them.
    }
  });
});
