import { describe, expect, it } from "vitest";

import {
  emptyDocument,
  newNodeId,
  paragraphNode,
  textNode,
  type CanonicalDocument,
} from "@/domain/document";

import { planRecovery, type PlanRecoveryInput } from "./recovery";
import { RECOVERY_CHOICES } from "./states";

/** Deterministic node ids, so a document is comparable across two builds. */
function idSeq(prefix: string): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix.repeat(8)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

function doc(...paragraphs: string[]): CanonicalDocument {
  const nextId = idSeq("a");
  return {
    schemaVersion: 1,
    nodes: paragraphs.map((text) => paragraphNode(newNodeId(nextId), [textNode(text)])),
  };
}

const LOCAL = doc("Lokalni tekst koji nije poslan");
const SERVER = doc("Verzija s poslužitelja", "Drugi odlomak");

/** A store that holds nothing and a server that answered nothing. */
const NOTHING: PlanRecoveryInput = {
  journalReadable: true,
  snapshot: null,
  pendingNewest: null,
  serverDocument: null,
  serverRevision: null,
};

function input(overrides: Partial<PlanRecoveryInput>): PlanRecoveryInput {
  return { ...NOTHING, ...overrides };
}

describe("planRecovery — salvaging local text", () => {
  it("salvages the newest pending transaction when the snapshot is corrupt", () => {
    const plan = planRecovery(
      input({
        snapshot: { document: { schemaVersion: 9, nodes: "junk" }, revision: 3, at: "2026-09-19T10:00:00.000Z" },
        pendingNewest: { document: LOCAL, revision: 3, at: "2026-09-19T10:00:01.000Z" },
      }),
    );

    expect(plan.canSalvageLocal).toBe(true);
    expect(plan.salvage?.source).toBe("pending");
    expect(plan.salvage?.document).toEqual(LOCAL);
    expect(plan.salvage?.revision).toBe(3);
  });

  it("falls back to the snapshot when the queued transaction is corrupt", () => {
    const plan = planRecovery(
      input({
        snapshot: { document: LOCAL, revision: 4, at: "2026-09-19T10:00:00.000Z" },
        pendingNewest: { document: undefined, revision: 4, at: "2026-09-19T10:00:01.000Z" },
      }),
    );

    expect(plan.canSalvageLocal).toBe(true);
    expect(plan.salvage?.source).toBe("snapshot");
    expect(plan.salvage?.revision).toBe(4);
  });

  it("refuses to salvage when both local rows are corrupt", () => {
    const plan = planRecovery(
      input({
        snapshot: { document: { nodes: [] }, revision: 1, at: null },
        pendingNewest: { document: "not a document", revision: 1, at: null },
      }),
    );

    expect(plan.canSalvageLocal).toBe(false);
    expect(plan.salvage).toBeNull();
    expect(plan.options.find((o) => o.choice === "salvage-local")?.blockedBy).toBe(
      "local-unreadable",
    );
  });

  it("reports an unreadable journal as unreadable, never as empty", () => {
    const plan = planRecovery(input({ journalReadable: false }));

    expect(plan.canSalvageLocal).toBe(false);
    expect(plan.options.find((o) => o.choice === "salvage-local")?.blockedBy).toBe(
      "journal-unreadable",
    );
  });

  it("reports a readable but empty journal as empty", () => {
    const plan = planRecovery(NOTHING);

    expect(plan.options.find((o) => o.choice === "salvage-local")?.blockedBy).toBe(
      "nothing-local",
    );
  });

  it("prefers whichever local row was written last", () => {
    const older = doc("Stariji");
    const newer = doc("Noviji");

    const snapshotNewer = planRecovery(
      input({
        snapshot: { document: newer, revision: 2, at: "2026-09-19T12:00:05.000Z" },
        pendingNewest: { document: older, revision: 2, at: "2026-09-19T12:00:00.000Z" },
      }),
    );
    expect(snapshotNewer.salvage?.source).toBe("snapshot");
    expect(snapshotNewer.salvage?.document).toEqual(newer);

    const pendingNewer = planRecovery(
      input({
        snapshot: { document: older, revision: 2, at: "2026-09-19T12:00:00.000Z" },
        pendingNewest: { document: newer, revision: 2, at: "2026-09-19T12:00:05.000Z" },
      }),
    );
    expect(pendingNewer.salvage?.document).toEqual(newer);
  });

  it("breaks a timestamp tie in favour of the queued transaction", () => {
    const plan = planRecovery(
      input({
        snapshot: { document: doc("Snimka"), revision: 7, at: "2026-09-19T12:00:00.000Z" },
        pendingNewest: { document: LOCAL, revision: 7, at: "2026-09-19T12:00:00.000Z" },
      }),
    );

    expect(plan.salvage?.source).toBe("pending");
  });

  it("prefers a row with a readable timestamp over one without", () => {
    const plan = planRecovery(
      input({
        snapshot: { document: doc("Snimka"), revision: 7, at: "2026-09-19T12:00:00.000Z" },
        pendingNewest: { document: LOCAL, revision: 7, at: null },
      }),
    );

    expect(plan.salvage?.source).toBe("snapshot");
  });

  it("refuses a local row whose base revision could not survive a compare-and-set", () => {
    for (const revision of [-1, 1.5, Number.NaN, "3", null, Number.MAX_SAFE_INTEGER + 2]) {
      const plan = planRecovery(
        input({ snapshot: { document: LOCAL, revision, at: null } }),
      );
      expect(plan.canSalvageLocal, String(revision)).toBe(false);
    }
  });

  it("accepts revision 0 — a document that exists with nothing committed yet", () => {
    const plan = planRecovery(input({ snapshot: { document: LOCAL, revision: 0, at: null } }));

    expect(plan.canSalvageLocal).toBe(true);
    expect(plan.salvage?.revision).toBe(0);
  });
});

describe("planRecovery — adopting the server's document", () => {
  it("offers the server's document at the revision the server named", () => {
    const plan = planRecovery(input({ serverDocument: SERVER, serverRevision: 11 }));

    expect(plan.canAdoptServer).toBe(true);
    expect(plan.adopt?.document).toEqual(SERVER);
    expect(plan.adopt?.revision).toBe(11);
    expect(plan.adopt?.source).toBeNull();
  });

  it("refuses to adopt when the server could not be read", () => {
    const plan = planRecovery(input({ serverDocument: null, serverRevision: null }));

    expect(plan.canAdoptServer).toBe(false);
    expect(plan.options.find((o) => o.choice === "adopt-server")?.blockedBy).toBe(
      "server-unavailable",
    );
  });

  it("refuses a server answer whose document is not canonical", () => {
    const plan = planRecovery(
      input({ serverDocument: { schemaVersion: 1 }, serverRevision: 2 }),
    );

    expect(plan.canAdoptServer).toBe(false);
  });

  it("refuses a server revision that is not a whole, safe number", () => {
    for (const revision of [-1, 2.5, "4", null, undefined]) {
      const plan = planRecovery(input({ serverDocument: SERVER, serverRevision: revision }));
      expect(plan.canAdoptServer, String(revision)).toBe(false);
    }
  });
});

describe("planRecovery — the options it hands the panel", () => {
  it("always returns both options, in recommended-first order", () => {
    const both = planRecovery(
      input({
        snapshot: { document: LOCAL, revision: 1, at: null },
        serverDocument: SERVER,
        serverRevision: 5,
      }),
    );

    expect(both.options.map((o) => o.choice)).toEqual(["salvage-local", "adopt-server"]);
    expect(both.recommended).toBe("salvage-local");

    const serverOnly = planRecovery(input({ serverDocument: SERVER, serverRevision: 5 }));
    expect(serverOnly.options.map((o) => o.choice)).toEqual(["adopt-server", "salvage-local"]);
    expect(serverOnly.recommended).toBe("adopt-server");
  });

  it("covers exactly the declared choices", () => {
    const plan = planRecovery(NOTHING);
    expect(plan.options.map((o) => o.choice).sort()).toEqual([...RECOVERY_CHOICES].sort());
  });

  it("recommends nothing when neither version can be offered", () => {
    const plan = planRecovery(input({ journalReadable: false }));

    expect(plan.recommended).toBeNull();
    expect(plan.canSalvageLocal).toBe(false);
    expect(plan.canAdoptServer).toBe(false);
    for (const option of plan.options) {
      expect(option.available).toBe(false);
      expect(option.blockedBy).not.toBeNull();
      expect(option.candidate).toBeNull();
    }
  });

  it("counts blocks and words so the author can tell the versions apart", () => {
    const plan = planRecovery(
      input({
        snapshot: { document: LOCAL, revision: 1, at: null },
        serverDocument: SERVER,
        serverRevision: 5,
      }),
    );

    expect(plan.salvage).toMatchObject({ nodes: 1, words: 5 });
    expect(plan.adopt).toMatchObject({ nodes: 2, words: 5 });
  });

  it("counts an empty document honestly rather than refusing it", () => {
    const plan = planRecovery(
      input({ snapshot: { document: emptyDocument(), revision: 0, at: null } }),
    );

    expect(plan.canSalvageLocal).toBe(true);
    expect(plan.salvage).toMatchObject({ nodes: 1, words: 0 });
  });

  it("never mutates the input it was given", () => {
    const given = input({
      snapshot: { document: LOCAL, revision: 1, at: null },
      serverDocument: SERVER,
      serverRevision: 5,
    });
    const before = JSON.stringify(given);

    planRecovery(given);

    expect(JSON.stringify(given)).toBe(before);
  });

  it("marks an available option with no reason, and an unavailable one with one", () => {
    const plan = planRecovery(
      input({ snapshot: { document: LOCAL, revision: 1, at: null } }),
    );

    for (const option of plan.options) {
      expect(option.available).toBe(option.blockedBy === null);
      expect(option.available).toBe(option.candidate !== null);
    }
  });
});
