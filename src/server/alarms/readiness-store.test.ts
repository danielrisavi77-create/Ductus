import { afterEach, describe, expect, it, vi } from "vitest";

const withActor = vi.fn();
vi.mock("@/server/db", () => ({ withActor: (...args: unknown[]) => withActor(...args) }));

import { readinessAlarms } from "./readiness-store";

// DAN-184: the in-app channel is written only through the two RPCs, with the
// closed kind as the one value, and not at all while the database is down.
describe("readinessAlarms", () => {
  afterEach(() => withActor.mockReset());

  it("borrows no connection while the database probe is not ok, then writes what it owes", async () => {
    const seen: Array<[string, unknown[] | undefined]> = [];
    withActor.mockImplementation(async (token, fn) => {
      expect(token).toBeNull();
      return fn({ query: async (sql: string, values?: unknown[]) => void seen.push([sql, values]) });
    });
    await readinessAlarms.observe({ database: "nedostupno", storage: "nije_konfigurirano" });
    await readinessAlarms.observe({ database: "unknown" });
    expect(withActor).not.toHaveBeenCalled();
    await readinessAlarms.observe({ database: "ok", storage: "nije_konfigurirano" });
    // One statement per write and no session setting of its own: the alarm
    // shares withActor with /api/ready and must not add to its probes' queries.
    expect(seen).toEqual([
      ["SELECT identity.raise_ops_alarm($1)", ["ready_database"]],
      ["SELECT identity.resolve_ops_alarm($1)", ["ready_database"]],
      ["SELECT identity.resolve_ops_alarm($1)", ["ready_storage"]],
    ]);
  });
});
