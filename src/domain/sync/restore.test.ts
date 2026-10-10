// @vitest-environment node
import { describe, expect, it } from "vitest";

import { emptyDocument } from "@/domain/document";

import { planDrain } from "./drain";
import type { JournalContents, JournalSnapshot, PendingTransaction } from "./journal-types";
import { chipContent, SYNC_STATE_LABELS } from "./labels";
import { restoreSyncState, TRANSIENT_SYNC_STATES } from "./restore";
import { SYNC_STATES, syncReducer, type SyncState } from "./states";

/**
 * F-8, attack plan #178: what a reload may and may not claim.
 * Every document, ID and text here is invented.
 */

const DOC = "22222222-2222-4222-8222-222222222222";
const AT = "2026-10-10T09:00:00.000Z";

function uuidSeq(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

const snapshot: JournalSnapshot = {
  documentId: DOC,
  revision: 4,
  document: emptyDocument(uuidSeq()),
  savedAt: AT,
};

function row(localSeq: number, clientTransactionId: string): PendingTransaction {
  return {
    documentId: DOC,
    localSeq,
    queuedAt: AT,
    tx: {
      kind: "REPLACE_DOCUMENT",
      clientTransactionId,
      baseRevision: 4,
      document: emptyDocument(uuidSeq()),
      createdAt: AT,
    },
  };
}

function recorded(
  state: SyncState,
  parts: Partial<Pick<JournalContents, "snapshot" | "pending">> = {},
): JournalContents {
  const pending = parts.pending ?? [];
  return {
    snapshot: parts.snapshot === undefined ? snapshot : parts.snapshot,
    pending,
    meta: { documentId: DOC, state, localSeq: pending.length },
  };
}

/** States that describe an operation in flight, by the tone the chip animates. */
const IN_FLIGHT = SYNC_STATES.filter(
  (state) => SYNC_STATE_LABELS[state].tone === "progress",
);

describe("restoreSyncState: a reload carries no operation in flight (#178 attack 4)", () => {
  it("names exactly the states the chip shows as in flight", () => {
    expect([...TRANSIENT_SYNC_STATES].sort()).toEqual([...IN_FLIGHT].sort());
    expect([...TRANSIENT_SYNC_STATES].sort()).toEqual(["SAVING_LOCAL", "SYNCING"]);
  });

  it.each(SYNC_STATES)("never resumes in an in-flight state from recorded %s", (state) => {
    for (const pending of [[], [row(1, "tx-a")]]) {
      for (const snap of [snapshot, null]) {
        const restored = restoreSyncState(recorded(state, { pending, snapshot: snap }));
        expect(IN_FLIGHT).not.toContain(restored);
        expect(chipContent(restored).tone).not.toBe("progress");
      }
    }
  });

  // One queued row only. With several rows and no persisted hold, planDrain
  // sends the newest one, not the one that was in flight (#183 attack 12).
  it("resumes a tab closed mid-send in LOCAL_DURABLE, with its single queued row still owed", () => {
    const contents = recorded("SYNCING", { pending: [row(1, "tx-a")] });
    const restored = restoreSyncState(contents);
    expect(restored).toBe("LOCAL_DURABLE");
    // Not stuck: the drain may start again from the restored state...
    expect(syncReducer(restored, { type: "SYNC_STARTED" })).toBe("SYNCING");
    // ...and the plan over the same one-row journal sends that row.
    const plan = planDrain(contents.pending, contents.meta);
    expect(plan.send?.tx.clientTransactionId).toBe("tx-a");
  });

  it("would otherwise be stuck: SYNCING has no way to start a send", () => {
    // The reason the recorded state cannot be trusted. Documents the machine,
    // does not change it: SYNC_STARTED is illegal in SYNCING.
    expect(syncReducer("SYNCING", { type: "SYNC_STARTED" })).toBe("SYNCING");
    expect(syncReducer("SAVING_LOCAL", { type: "LOCAL_SAVE_STARTED" })).toBe("SAVING_LOCAL");
  });

  it("resumes a tab closed mid-local-save in LOCAL_DURABLE when a snapshot is on disk", () => {
    const restored = restoreSyncState(recorded("SAVING_LOCAL", { pending: [row(1, "tx-a")] }));
    expect(restored).toBe("LOCAL_DURABLE");
    expect(syncReducer(restored, { type: "SYNC_STARTED" })).toBe("SYNCING");
  });

  it.each(TRANSIENT_SYNC_STATES)(
    "claims nothing for recorded %s when no snapshot is on disk",
    (state) => {
      const restored = restoreSyncState(recorded(state, { snapshot: null }));
      expect(restored).toBe("EDITING");
      // From EDITING a save can start again; nothing is claimed durable.
      expect(syncReducer(restored, { type: "LOCAL_SAVE_STARTED" })).toBe("SAVING_LOCAL");
    },
  );

  it.each(TRANSIENT_SYNC_STATES)(
    "never turns recorded %s into the server claim",
    (state) => {
      for (const pending of [[], [row(1, "tx-a")]]) {
        const restored = restoreSyncState(recorded(state, { pending }));
        expect(restored).not.toBe("SYNCED");
        expect(chipContent(restored).text).not.toBe(SYNC_STATE_LABELS.SYNCED.label);
      }
    },
  );

  it("treats a recorded in-flight state exactly like a journal without meta", () => {
    for (const state of TRANSIENT_SYNC_STATES) {
      for (const snap of [snapshot, null]) {
        expect(restoreSyncState(recorded(state, { snapshot: snap }))).toBe(
          restoreSyncState({ snapshot: snap, pending: [], meta: null }),
        );
      }
    }
  });
});

describe("restoreSyncState: what a reload must not clear (#178 attacks 8 and 21)", () => {
  it.each(["CONFLICT", "RECOVERY_REQUIRED"] as const)(
    "keeps %s sticky whatever else the journal holds",
    (state) => {
      for (const pending of [[], [row(1, "tx-a"), row(2, "tx-b")]]) {
        for (const snap of [snapshot, null]) {
          expect(restoreSyncState(recorded(state, { pending, snapshot: snap }))).toBe(state);
        }
      }
    },
  );

  it.each(["EDITING", "LOCAL_DURABLE", "SYNCED", "ERROR"] as const)(
    "restores the settled state %s as recorded",
    (state) => {
      expect(restoreSyncState(recorded(state))).toBe(state);
    },
  );

  it("does not trust a stored state the machine does not know", () => {
    for (const rogue of ["SAVED", "syncing", "", 4, null, { state: "SYNCED" }, "toString"]) {
      const contents = {
        snapshot,
        pending: [],
        meta: { documentId: DOC, state: rogue, localSeq: 1 },
      } as unknown as JournalContents;
      expect(restoreSyncState(contents)).toBe("LOCAL_DURABLE");
    }
  });

  it("is pure: the journal contents are not modified", () => {
    const contents = recorded("SYNCING", { pending: [row(1, "tx-a")] });
    const before = JSON.stringify(contents);
    restoreSyncState(contents);
    expect(JSON.stringify(contents)).toBe(before);
    expect(contents.meta?.state).toBe("SYNCING");
  });
});

/**
 * #178 attacks 5 and 17, QA of #189: a "saved" label needs the record it
 * speaks of. "Spremljeno na poslužitelju" needs a snapshot and an empty
 * queue; "Spremljeno na uređaju" needs a snapshot. A reload proves neither.
 */
describe("restoreSyncState: no saved claim without its record (#178 attacks 5 and 17)", () => {
  const ROWS = [row(1, "tx-a"), row(2, "tx-b")];
  const stores = [
    { name: "snapshot, empty queue", snapshot, pending: [] },
    { name: "snapshot, rows queued", snapshot, pending: ROWS },
    { name: "no snapshot, empty queue", snapshot: null, pending: [] },
    { name: "no snapshot, rows queued", snapshot: null, pending: ROWS },
  ] as const;
  // Recorded state -> restored state, one column per store above.
  const TABLE: Record<SyncState, readonly SyncState[]> = {
    EDITING: ["EDITING", "EDITING", "EDITING", "EDITING"],
    SAVING_LOCAL: ["LOCAL_DURABLE", "LOCAL_DURABLE", "EDITING", "EDITING"],
    LOCAL_DURABLE: ["LOCAL_DURABLE", "LOCAL_DURABLE", "EDITING", "EDITING"],
    SYNCING: ["LOCAL_DURABLE", "LOCAL_DURABLE", "EDITING", "EDITING"],
    SYNCED: ["SYNCED", "LOCAL_DURABLE", "EDITING", "EDITING"],
    CONFLICT: ["CONFLICT", "CONFLICT", "CONFLICT", "CONFLICT"],
    ERROR: ["ERROR", "ERROR", "ERROR", "ERROR"],
    RECOVERY_REQUIRED: [
      "RECOVERY_REQUIRED", "RECOVERY_REQUIRED", "RECOVERY_REQUIRED", "RECOVERY_REQUIRED",
    ],
  };
  const cases = SYNC_STATES.flatMap((state) =>
    stores.map((store, column) => ({ state, store, expected: TABLE[state][column] })),
  );

  it.each(cases)("recorded $state with $store.name resumes in $expected", ({ state, store, expected }) => {
    const contents = recorded(state, { snapshot: store.snapshot, pending: [...store.pending] });
    expect(restoreSyncState(contents)).toBe(expected);
  });

  it("a recorded SYNCED with a row still owed is not shown as saved on the server", () => {
    for (const pending of [[row(1, "tx-a")], ROWS]) {
      const contents = recorded("SYNCED", { pending });
      const restored = restoreSyncState(contents);
      expect(restored).toBe("LOCAL_DURABLE");
      expect(chipContent(restored).text).not.toBe(SYNC_STATE_LABELS.SYNCED.label);
      // The queue goes on: a send may start, and the plan has a row to send.
      expect(syncReducer(restored, { type: "SYNC_STARTED" })).toBe("SYNCING");
      expect(planDrain(contents.pending, { ...contents.meta!, state: restored }).send).not.toBeNull();
    }
  });

  it("says saved on the server only for a recorded SYNCED with a snapshot and an empty queue", () => {
    for (const { state, store } of cases) {
      const restored = restoreSyncState(
        recorded(state, { snapshot: store.snapshot, pending: [...store.pending] }),
      );
      if (restored === "SYNCED") {
        expect([state, store.name]).toEqual(["SYNCED", "snapshot, empty queue"]);
      }
      if (restored === "LOCAL_DURABLE") {
        expect(store.snapshot).not.toBeNull();
      }
    }
  });

  it("does not take a queue it cannot read for an empty one", () => {
    for (const pending of [null, undefined, "", 0, {}, { length: 0 }]) {
      const contents = { ...recorded("SYNCED"), pending } as unknown as JournalContents;
      expect(restoreSyncState(contents)).toBe("LOCAL_DURABLE");
    }
  });

  it("leaves rows without a snapshot unclaimed and untouched, with or without meta", () => {
    // A partial store: nothing on screen is known to be saved, so no label
    // says so. The rows stay queued; this function never drops anything.
    const contents: JournalContents = { snapshot: null, pending: [...ROWS], meta: null };
    expect(restoreSyncState(contents)).toBe("EDITING");
    expect(contents.pending).toHaveLength(2);
    expect(chipContent("EDITING").text).not.toMatch(/spremljeno/i);
  });
});
