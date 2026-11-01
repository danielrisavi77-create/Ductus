import { describe, expect, it } from "vitest";

import { newNodeId, paragraphNode, textNode, type CanonicalDocument } from "@/domain/document";

import { planRecovery } from "./recovery";

/**
 * M0.1 (DAN-376, #1071): recovery case of the core port that had no Ductus
 * test (map: docs/engineering/prijenos-jezgre-M0.1-jednakovrijednost.md).
 * Every text here is invented.
 */

const SERVER: CanonicalDocument = {
  schemaVersion: 1,
  nodes: [paragraphNode(newNodeId(() => "bbbbbbbb-0000-4000-8000-000000000001"), [textNode("Izmišljena verzija s poslužitelja")])],
};

describe("M0.1 recovery: unreadable store", () => {
  it("2: an unreadable journal with a valid server answer recommends the server's version", () => {
    const plan = planRecovery({
      journalReadable: false, snapshot: null, pendingNewest: null, serverDocument: SERVER, serverRevision: 7,
    });

    expect(plan.recommended).toBe("adopt-server");
    expect(plan.canAdoptServer).toBe(true);
    expect(plan.canSalvageLocal).toBe(false);
    expect(plan.options.map((option) => option.choice)).toEqual(["adopt-server", "salvage-local"]);
    expect(plan.options[1]).toEqual({ choice: "salvage-local", available: false, blockedBy: "journal-unreadable", candidate: null });
    expect(plan.salvage).toBeNull();
    expect(plan.adopt).toMatchObject({ document: SERVER, revision: 7, nextBaseRevision: 7, source: null });
  });

  it("2: an unreadable journal with a damaged leftover row still names the journal as the reason", () => {
    const plan = planRecovery({
      journalReadable: false,
      snapshot: { document: { schemaVersion: 9, nodes: "smeće" }, revision: 3, at: "2026-10-10T20:00:00.000Z" },
      pendingNewest: null,
      serverDocument: SERVER,
      serverRevision: 7,
    });

    expect(plan.recommended).toBe("adopt-server");
    expect(plan.options[1]?.blockedBy).toBe("journal-unreadable");
  });

  it.each([null, -1, 1.5])("2: without a usable server revision (%s) nothing is recommended", (serverRevision) => {
    const plan = planRecovery({
      journalReadable: false, snapshot: null, pendingNewest: null, serverDocument: SERVER, serverRevision,
    });

    expect(plan.recommended).toBeNull();
    expect(plan.options.map((option) => option.blockedBy)).toEqual(["journal-unreadable", "server-unavailable"]);
  });
});
