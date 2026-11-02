import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// D-91 measure 6 (docs/BACKEND.md 4.8 point 6): the six group roles are
// listed in three files that must agree. The roles migration creates any
// role the bootstrap missed, the bootstrap creates them first, and the check
// migration stops a deploy when one of them is not as the migrations expect.
// A role added to one list and not the others would be created, or checked,
// in one place only.
const ROOT = new URL("../../../", import.meta.url);
const FILES = {
  rolesMigration: "db/migrations/20261003210000_roles.sql",
  bootstrap: "db/local/migrator.sql",
  checkMigration: "db/migrations/20261101201000_roles_check.sql",
} as const;

/** The quoted names inside `group_roles CONSTANT text[] := ARRAY[...]`. */
function groupRoles(sql: string): string[] {
  const lists = [...sql.matchAll(/group_roles\s+CONSTANT\s+text\[\]\s*:=\s*ARRAY\[([^\]]*)\]/g)];
  if (lists.length !== 1) throw new Error(`expected one group_roles list, found ${lists.length}`);
  const body = lists[0][1].replace(/--[^\n]*/g, "");
  const names = [...body.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  const rest = body.replace(/'[^']*'/g, "").replace(/[\s,]/g, "");
  if (rest !== "") throw new Error(`unexpected text in the group_roles list: ${rest}`);
  return names;
}

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, ROOT)), "utf8");
}

describe("the group role lists", () => {
  const lists = Object.fromEntries(
    Object.entries(FILES).map(([key, path]) => [key, groupRoles(read(path))]),
  ) as Record<keyof typeof FILES, string[]>;

  it("are the six group roles in the roles migration", () => {
    expect(lists.rolesMigration).toEqual([
      "ductus_app", "ductus_worker", "ductus_retention", "ductus_evidence", "ductus_identity", "ductus_auth",
    ]);
  });

  it("are the same, in the same order, in the bootstrap and in the check migration", () => {
    expect(lists.bootstrap).toEqual(lists.rolesMigration);
    expect(lists.checkMigration).toEqual(lists.rolesMigration);
  });

  it("notices a role missing, added or renamed in one list", () => {
    const sql = (names: string) => `DECLARE\n  group_roles CONSTANT text[] := ARRAY[\n    ${names}\n  ];`;
    const base = lists.rolesMigration.map((name) => `'${name}'`);
    expect(groupRoles(sql(base.join(", ")))).toEqual(lists.rolesMigration);
    expect(groupRoles(sql(base.slice(1).join(", ")))).not.toEqual(lists.rolesMigration);
    expect(groupRoles(sql([...base, "'ductus_extra'"].join(", ")))).not.toEqual(lists.rolesMigration);
    expect(groupRoles(sql(base.join(", ").replace("ductus_worker", "ductus_workers")))).not.toEqual(lists.rolesMigration);
  });

  it("the check migration only reads: its up section has no statement that changes anything", () => {
    const sql = read(FILES.checkMigration);
    // One marker each, or the up section is cut where a comment names one.
    expect(sql.match(/migrate:(up|down)/g)).toEqual(["migrate:up", "migrate:down"]);
    const up = sql.slice(sql.indexOf("-- migrate:up"), sql.indexOf("-- migrate:down")).replace(/--[^\n]*/g, "")
      .replace(/'[^']*'/g, "''");
    expect(up).toMatch(/RAISE EXCEPTION/);
    expect(up).not.toMatch(/\b(CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE|COMMENT|SECURITY|SET)\b/i);
  });

  it("reads a list with comments and refuses one it cannot read", () => {
    expect(groupRoles("group_roles CONSTANT text[] := ARRAY[\n 'a', -- one 'quoted' word\n 'b'\n];")).toEqual(["a", "b"]);
    expect(() => groupRoles("no list here")).toThrow("found 0");
    expect(() => groupRoles("group_roles CONSTANT text[] := ARRAY['a'];\ngroup_roles CONSTANT text[] := ARRAY['b'];")).toThrow("found 2");
    expect(() => groupRoles("group_roles CONSTANT text[] := ARRAY['a' || 'b'];")).toThrow("unexpected text");
  });
});
