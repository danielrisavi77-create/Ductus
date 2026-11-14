import { describe, expect, it } from "vitest";

import { OPS_ALARM_KINDS, opsAlarmCategory, readinessAlarmTargets } from "./alarm";

// DAN-184 contract (#1836, c.6821517800), input classes (1) to (6).
describe("readinessAlarmTargets", () => {
  it.each([
    ["(1) ok resolves", { database: "ok" }, { ready_database: "resolved" }],
    ["(2) nedostupno raises", { storage: "nedostupno" }, { ready_storage: "raised" }],
    ["(3) nije_konfigurirano is not a fault", { queue: "nije_konfigurirano" }, { ready_queue: "resolved" }],
    ["(4) a missing capability changes nothing", {}, {}],
    ["(5) unknown names and values are ignored", { cache: "nedostupno", signing: "down", queue: 1 }, {}],
    [
      "all four at once",
      { database: "ok", storage: "nedostupno", signing: "nedostupno", queue: "ok" },
      { ready_database: "resolved", ready_storage: "raised", ready_signing: "raised", ready_queue: "resolved" },
    ],
  ])("%s", (_name, capabilities, expected) => {
    expect(readinessAlarmTargets(capabilities)).toEqual(expected);
  });

  it("(5) reads only own keys, not the prototype", () => {
    const inherited = Object.create({ database: "nedostupno" }) as Record<string, unknown>;
    expect(readinessAlarmTargets(inherited)).toEqual({});
  });

  it("(5) a non-object is no input", () => {
    for (const value of [null, undefined, "nedostupno", 3, ["nedostupno"]]) {
      expect(readinessAlarmTargets(value)).toEqual({});
    }
  });
});

describe("opsAlarmCategory", () => {
  it("signing is the security alarm, the rest are operational", () => {
    expect(OPS_ALARM_KINDS.map((kind) => [kind, opsAlarmCategory(kind)])).toEqual([
      ["ready_database", "operational"],
      ["ready_storage", "operational"],
      ["ready_queue", "operational"],
      ["ready_signing", "security"],
    ]);
  });
});
