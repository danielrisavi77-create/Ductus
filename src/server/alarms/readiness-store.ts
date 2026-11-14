import { randomUUID } from "node:crypto";

import { withActor } from "@/server/db";
import { logEvent } from "@/server/log/logger";

import { createAlarmTracker } from "./readiness-alarms";

// This process's reporter: a random UUID made when the module loads, so every
// replica holds its own fault records in identity.ops_alarm_fault. It names
// no person and no machine, and a restart is a new reporter.
const reporter = randomUUID();

// One statement per write. The functions carry their own lock_timeout, so a
// write that waits on another replica's open alarm gives its connection back
// to the pool; the write sends no session setting of its own (DAN-585).
function raise(kind: string): Promise<void> {
  return withActor(null, async (tx) => {
    await tx.query("SELECT identity.raise_ops_alarm($1, $2)", [kind, reporter]);
  });
}

// True when the alarm is closed or none was open; false when another
// replica's fresh fault record keeps it open.
function resolve(kind: string): Promise<boolean> {
  return withActor(null, async (tx) => {
    const { rows } = await tx.query<{ closed: boolean }>("SELECT identity.resolve_ops_alarm($1, $2) AS closed", [
      kind,
      reporter,
    ]);
    return rows[0]?.closed === true;
  });
}

/**
 * The process's readiness alarms (DAN-184), delivered to identity.ops_alarm.
 * A failed write is logged with its closed kind only and retried on the next
 * readiness check; nothing is written while the database probe is not "ok".
 * A replica that sees a fault refreshes its raise, and a resolve held by
 * another replica is tried again, at most every REFRESH_MS.
 */
export const readinessAlarms = createAlarmTracker(
  {
    raise,
    resolve,
  },
  (op, kind) => logEvent("error", "ops_alarm_write_failed", { op, kind }),
  // The channel is a table: with the database probe not "ok" a write could
  // only hang or fail and would take one more connection during the outage.
  (capabilities) =>
    typeof capabilities === "object" &&
    capabilities !== null &&
    (capabilities as Record<string, unknown>).database === "ok",
);
