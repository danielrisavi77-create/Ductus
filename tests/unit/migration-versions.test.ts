import { readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

// dbmate keys schema_migrations by the version before the first "_": of two
// migrations with the same version, the one applied second is skipped without
// an error. Two PRs that pick the same version therefore pass CI each on its
// own and break the database only after both are merged.
const DIRECTORY = new URL("../../db/migrations/", import.meta.url);

describe("db/migrations versions", () => {
  it("names every migration with a 14-digit version and gives no version twice", () => {
    const names = readdirSync(DIRECTORY).filter((name) => name.endsWith(".sql"));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    const seen = new Map<string, string>();
    const repeated: string[] = [];
    for (const name of names) {
      const version = name.slice(0, 14);
      const first = seen.get(version);
      if (first) repeated.push(`${first} and ${name}`);
      else seen.set(version, name);
    }
    expect(repeated).toStrictEqual([]);
  });
});
