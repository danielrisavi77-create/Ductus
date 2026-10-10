// @vitest-environment node
import { describe, expect, it } from "vitest";

import { newNodeId, paragraphNode, textNode, type CanonicalDocument } from "@/domain/document";
import { planRecovery, type PlanRecoveryInput, type RecoverySource } from "./recovery";

function doc(text: string): CanonicalDocument {
  return {
    schemaVersion: 1,
    nodes: [paragraphNode(newNodeId(() => "aaaaaaaa-0000-4000-8000-000000000001"), [textNode(text)])],
  };
}

const PENDING = doc("New pending text");
const SNAPSHOT = doc("Snapshot text");

function input(pendingAt: string | null, snapshotAt: string | null): PlanRecoveryInput {
  return {
    journalReadable: true,
    pendingNewest: { document: PENDING, revision: 7, at: pendingAt },
    snapshot: { document: SNAPSHOT, revision: 6, at: snapshotAt },
    serverDocument: null,
    serverRevision: null,
  };
}

describe("planRecovery — validated canonical UTC timestamps", () => {
  // These cases catch treating arbitrary text as readable or letting calendar
  // normalization convert an invalid date into a winning salvage candidate.
  it.each<{ name: string; pendingAt: string | null; snapshotAt: string | null; source: RecoverySource }>([
    { name: "invalid snapshot loses to valid pending", pendingAt: "2026-10-06T12:00:00.000Z", snapshotAt: "not-a-timestamp", source: "pending" },
    { name: "invalid pending loses to valid snapshot", pendingAt: "not-a-timestamp", snapshotAt: "2026-10-06T12:00:00.000Z", source: "snapshot" },
    { name: "two unknown strings retain pending tie", pendingAt: "broken", snapshotAt: "unknown", source: "pending" },
    { name: "missing pending and invalid snapshot retain pending tie", pendingAt: null, snapshotAt: "not-a-timestamp", source: "pending" },
    { name: "equal instants retain pending tie", pendingAt: "2026-10-06T12:00:00.000Z", snapshotAt: "2026-10-06T12:00:00.000Z", source: "pending" },
    { name: "valid newer pending wins", pendingAt: "2026-10-06T12:00:00.001Z", snapshotAt: "2026-10-06T12:00:00.000Z", source: "pending" },
    { name: "valid newer snapshot wins", pendingAt: "2026-10-06T12:00:00.000Z", snapshotAt: "2026-10-06T12:00:00.001Z", source: "snapshot" },
    { name: "invalid February date is unknown", pendingAt: "2026-02-28T12:00:00.000Z", snapshotAt: "2026-02-30T12:00:00.000Z", source: "pending" },
    { name: "non-leap February 29 is unknown", pendingAt: "2026-02-28T12:00:00.000Z", snapshotAt: "2026-02-29T12:00:00.000Z", source: "pending" },
    { name: "valid leap day is ranked", pendingAt: "2024-02-28T12:00:00.000Z", snapshotAt: "2024-02-29T12:00:00.000Z", source: "snapshot" },
    { name: "April 31 is unknown", pendingAt: "2026-04-30T12:00:00.000Z", snapshotAt: "2026-04-31T12:00:00.000Z", source: "pending" },
    { name: "hour 24 is unknown", pendingAt: "2026-10-06T12:00:00.000Z", snapshotAt: "2026-10-06T24:00:00.000Z", source: "pending" },
    { name: "invalid month is unknown", pendingAt: "2026-10-06T12:00:00.000Z", snapshotAt: "2026-13-01T12:00:00.000Z", source: "pending" },
    { name: "day zero is unknown", pendingAt: "2026-10-06T12:00:00.000Z", snapshotAt: "2026-10-00T12:00:00.000Z", source: "pending" },
    { name: "invalid seconds are unknown", pendingAt: "2026-10-06T12:00:00.000Z", snapshotAt: "2026-10-06T12:00:60.000Z", source: "pending" },
  ])("$name", ({ pendingAt, snapshotAt, source }) => {
    const given = input(pendingAt, snapshotAt);
    const before = structuredClone(given);
    const plan = planRecovery(given);
    expect(plan.salvage?.source).toBe(source);
    expect(plan.salvage?.document).toEqual(source === "pending" ? PENDING : SNAPSHOT);
    expect(plan.salvage?.revision).toBe(source === "pending" ? 7 : 6);
    expect(plan.canSalvageLocal).toBe(true);
    expect(plan.recommended).toBe("salvage-local");
    expect(given).toEqual(before);
  });

  it.each([
    "2026-10-07T00:00:00+02:00",
    "2026-10-07T00:00:00.000+00:00",
    "2026-10-07T00:00:00Z",
    "2026-10-07",
    "2026-10-07T00:00:00.000",
    "2026-10-07T00:00:00.0000Z",
    "2026-10-07t00:00:00.000z",
    " 2026-10-07T00:00:00.000Z ",
  ])("treats noncanonical format %s as unknown without claiming offset support", (at) => {
    expect(planRecovery(input("2026-10-06T12:00:00.000Z", at)).salvage?.source).toBe("pending");
    expect(planRecovery(input(at, "2026-10-06T12:00:00.000Z")).salvage?.source).toBe("snapshot");
  });

  it.each(["pending", "snapshot"] as const)("keeps a sole valid %s document with an invalid timestamp", (source) => {
    const given = input("not-a-timestamp", "not-a-timestamp");
    if (source === "pending") given.snapshot = null;
    else given.pendingNewest = null;
    const plan = planRecovery(given);
    expect(plan.canSalvageLocal).toBe(true);
    expect(plan.salvage?.source).toBe(source);
    expect(plan.salvage?.document).toEqual(source === "pending" ? PENDING : SNAPSHOT);
  });
});
