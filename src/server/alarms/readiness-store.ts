import { withActor } from "@/server/db";
import { logEvent } from "@/server/log/logger";

import { createAlarmTracker } from "./readiness-alarms";

// Same bound as the readiness probes: the database cancels a write past it, so
// a hanging write hands its connection back to the pool (DAN-585).
const STATEMENT_LIMIT_SQL = "SELECT pg_catalog.set_config('statement_timeout', '2000ms', true)";

function call(sql: string, kind: string): Promise<void> {
  return withActor(null, async (tx) => {
    await tx.query(STATEMENT_LIMIT_SQL);
    await tx.query(sql, [kind]);
  });
}

/**
 * The process's readiness alarms (DAN-184), delivered to identity.ops_alarm.
 * A failed write is logged with its closed kind only and retried on the next
 * readiness check; nothing is written while the database probe is not "ok".
 */
export const readinessAlarms = createAlarmTracker(
  {
    raise: (kind) => call("SELECT identity.raise_ops_alarm($1)", kind),
    resolve: (kind) => call("SELECT identity.resolve_ops_alarm($1)", kind),
  },
  (op, kind) => logEvent("error", "ops_alarm_write_failed", { op, kind }),
  // The channel is a table: with the database probe not "ok" a write could
  // only hang or fail and would take one more connection during the outage.
  (capabilities) =>
    typeof capabilities === "object" &&
    capabilities !== null &&
    (capabilities as Record<string, unknown>).database === "ok",
);
