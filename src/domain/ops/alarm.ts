/**
 * Operational and security alarms (DAN-184, M11.9-P01). An alarm is one kind
 * from a closed set and nothing else: no person, institution, work, message or
 * error code ever goes with it (PRODUCT 5). The same set is checked by
 * identity.ops_alarm and its RPCs (20261112200000_ops_alarm.sql).
 */
export const OPS_ALARM_KINDS = ["ready_database", "ready_storage", "ready_queue", "ready_signing"] as const;
export type OpsAlarmKind = (typeof OPS_ALARM_KINDS)[number];
export type OpsAlarmCategory = "operational" | "security";
export type OpsAlarmTarget = "raised" | "resolved";

export function opsAlarmCategory(kind: OpsAlarmKind): OpsAlarmCategory {
  return kind === "ready_signing" ? "security" : "operational";
}

const READINESS_KIND: Readonly<Record<string, OpsAlarmKind>> = Object.freeze({
  database: "ready_database",
  storage: "ready_storage",
  queue: "ready_queue",
  signing: "ready_signing",
});

/**
 * What the readiness report says about each alarm: "nedostupno" raises it,
 * "ok" and "nije_konfigurirano" (not set up is not a fault) resolve it. A
 * capability the report leaves out, an unknown name or any other value says
 * nothing, so the alarm keeps its state.
 */
export function readinessAlarmTargets(capabilities: unknown): Partial<Record<OpsAlarmKind, OpsAlarmTarget>> {
  const targets: Partial<Record<OpsAlarmKind, OpsAlarmTarget>> = {};
  if (typeof capabilities !== "object" || capabilities === null || Array.isArray(capabilities)) return targets;
  for (const [name, kind] of Object.entries(READINESS_KIND)) {
    if (!Object.hasOwn(capabilities, name)) continue;
    const status = (capabilities as Record<string, unknown>)[name];
    if (status === "nedostupno") targets[kind] = "raised";
    else if (status === "ok" || status === "nije_konfigurirano") targets[kind] = "resolved";
  }
  return targets;
}
