import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { OPS_ALARM_KINDS, type OpsAlarmKind } from "@/domain/ops/alarm";

import { createAlarmTracker, type AlarmStore } from "./readiness-alarms";

// DAN-184 contract (#1836, c.6821517800): whatever the reports and store
// failures, writes name only kinds from the closed set, each kind's writes
// alternate raise and resolve, and once the store works the stored state is
// the last report's, with every fault seen since the last stored state written.
const status = fc.constantFrom("ok", "nedostupno", "nije_konfigurirano", "down", 0, null);
const report = fc.dictionary(fc.constantFrom("database", "storage", "signing", "queue", "codes", "cache"), status);
const step = fc.record({ report, storeUp: fc.boolean(), concurrent: fc.boolean() });

test.prop([fc.array(step, { maxLength: 40 })])("no transition is lost", async (steps) => {
  let up = true;
  const writes: Array<["raise" | "resolve", string]> = [];
  const store: AlarmStore = {
    raise: async (kind) => {
      if (!up) throw new Error("down");
      writes.push(["raise", kind]);
    },
    resolve: async (kind) => {
      if (!up) throw new Error("down");
      writes.push(["resolve", kind]);
    },
  };
  const tracker = createAlarmTracker(store);
  const last = new Map<OpsAlarmKind, "raised" | "resolved">();
  const faultSince = new Set<OpsAlarmKind>();
  const kindOf: Record<string, OpsAlarmKind> = {
    database: "ready_database",
    storage: "ready_storage",
    signing: "ready_signing",
    queue: "ready_queue",
  };
  for (const { report: r, storeUp, concurrent } of steps) {
    up = storeUp;
    for (const [name, value] of Object.entries(r)) {
      const kind = kindOf[name];
      if (!kind) continue;
      if (value === "nedostupno") {
        last.set(kind, "raised");
        faultSince.add(kind);
      } else if (value === "ok" || value === "nije_konfigurirano") last.set(kind, "resolved");
    }
    await (concurrent ? Promise.all([tracker.observe(r), tracker.observe(r)]) : tracker.observe(r));
  }
  up = true;
  await tracker.observe({});

  for (const [op, kind] of writes) {
    expect(["raise", "resolve"]).toContain(op);
    expect(OPS_ALARM_KINDS).toContain(kind);
  }
  for (const kind of OPS_ALARM_KINDS) {
    const ops = writes.filter(([, k]) => k === kind).map(([op]) => op);
    for (let i = 1; i < ops.length; i++) {
      if (ops[i] === "raise") expect(ops[i - 1]).toBe("resolve");
    }
    if (faultSince.has(kind)) expect(ops).toContain("raise");
    const final = last.get(kind);
    if (final === "raised") expect(ops.at(-1)).toBe("raise");
    if (final === "resolved") expect(ops.at(-1)).toBe("resolve");
    if (final === undefined) expect(ops).toEqual([]);
  }
});
