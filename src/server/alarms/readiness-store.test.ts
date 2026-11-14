import { afterEach, describe, expect, it, vi } from "vitest";

const withActor = vi.fn();
vi.mock("@/server/db", () => ({ withActor: (...args: unknown[]) => withActor(...args) }));

import { readinessAlarms } from "./readiness-store";

// DAN-184: the in-app channel is written only through the two RPCs, with the
// closed kind and the process's reporter as the only values, and not at all while the database is down.
describe("readinessAlarms", () => {
  afterEach(() => withActor.mockReset());

  it("borrows no connection while the database probe is not ok, then writes what it owes", async () => {
    const seen: Array<[string, unknown[] | undefined]> = [];
    withActor.mockImplementation(async (token, fn) => {
      expect(token).toBeNull();
      return fn({
        query: async (sql: string, values?: unknown[]) => {
          seen.push([sql, values]);
          return { rows: sql.includes("resolve_ops_alarm") ? [{ closed: true }] : [{}] };
        },
      });
    });
    await readinessAlarms.observe({ database: "nedostupno", storage: "nije_konfigurirano" });
    await readinessAlarms.observe({ database: "unknown" });
    expect(withActor).not.toHaveBeenCalled();
    await readinessAlarms.observe({ database: "ok", storage: "nije_konfigurirano" });
    // One statement per write and no session setting of its own: the alarm
    // shares withActor with /api/ready and must not add to its probes' queries.
    // The reporter is one random UUID for the whole process, the same in
    // every write.
    const reporter = seen[0]?.[1]?.[1];
    expect(reporter).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(seen).toEqual([
      ["SELECT identity.raise_ops_alarm($1, $2)", ["ready_database", reporter]],
      ["SELECT identity.resolve_ops_alarm($1, $2) AS closed", ["ready_database", reporter]],
      ["SELECT identity.resolve_ops_alarm($1, $2) AS closed", ["ready_storage", reporter]],
    ]);
  });

  it("reads a refused resolve as held and does not repeat it within the refresh interval", async () => {
    const seen: string[] = [];
    withActor.mockImplementation(async (_token, fn) =>
      fn({
        query: async (sql: string) => {
          seen.push(sql);
          return { rows: sql.includes("resolve_ops_alarm") ? [{ closed: false }] : [{}] };
        },
      }),
    );
    await readinessAlarms.observe({ database: "ok", queue: "nedostupno" });
    await readinessAlarms.observe({ database: "ok", queue: "ok" });
    // Held by another replica: the next ok within REFRESH_MS writes nothing.
    await readinessAlarms.observe({ database: "ok", queue: "ok" });
    expect(seen).toEqual([
      "SELECT identity.raise_ops_alarm($1, $2)",
      "SELECT identity.resolve_ops_alarm($1, $2) AS closed",
    ]);
  });
});
