import { describe, expect, it } from "vitest";

import type { JournalContents } from "./journal-types";
import { restoreSyncState } from "./restore";
import {
  CONFLICT_RESOLUTIONS,
  INITIAL_SYNC_STATE,
  LOCAL_SAVE_FAILURE_REASONS,
  RECOVERY_CHOICES,
  SYNC_EVENT_TYPES,
  SYNC_STATES,
  SYNC_TRANSITIONS,
  isLegalTransition,
  syncReducer,
  transitionVariant,
  type SyncEvent,
  type SyncState,
} from "./states";

/** Every event the machine accepts, with every payload variant spelled out. */
const EVENTS: readonly SyncEvent[] = [
  { type: "EDIT" },
  { type: "LOCAL_SAVE_STARTED" },
  { type: "LOCAL_SAVE_OK" },
  ...LOCAL_SAVE_FAILURE_REASONS.map(
    (reason): SyncEvent => ({ type: "LOCAL_SAVE_FAILED", reason }),
  ),
  { type: "SYNC_STARTED" },
  { type: "SYNC_ACK" },
  { type: "SYNC_STALE_BASE" },
  { type: "SYNC_FAILED", retryable: true },
  { type: "SYNC_FAILED", retryable: false },
  ...CONFLICT_RESOLUTIONS.map((via): SyncEvent => ({ type: "CONFLICT_RESOLVED", via })),
  ...RECOVERY_CHOICES.map((via): SyncEvent => ({ type: "RECOVERED", via })),
];

function label(event: SyncEvent): string {
  const variant = transitionVariant(event);
  return variant === null ? event.type : `${event.type}(${variant})`;
}

/**
 * Resolves the expected target straight from the table, independently of the
 * reducer's own branching — so these tests check that the reducer implements
 * the table rather than restating the reducer.
 */
function expectedFromTable(state: SyncState, event: SyncEvent): SyncState {
  const transition = SYNC_TRANSITIONS[state][event.type];
  if (!transition) {
    return state;
  }
  if ("to" in transition) {
    return transition.to;
  }
  const variant = transitionVariant(event);
  return (variant !== null && transition.cases[variant]) || state;
}

describe("sync state machine vocabulary", () => {
  it("has exactly the eight user-visible states", () => {
    expect([...SYNC_STATES]).toEqual([
      "EDITING",
      "SAVING_LOCAL",
      "LOCAL_DURABLE",
      "SYNCING",
      "SYNCED",
      "CONFLICT",
      "ERROR",
      "RECOVERY_REQUIRED",
    ]);
  });

  it("has no catch-all 'saved' state — LOCAL_DURABLE and SYNCED are distinct", () => {
    const saved = SYNC_STATES.filter((state) => /^SAVED$/i.test(state));
    expect(saved).toEqual([]);
    expect(SYNC_STATES).toContain("LOCAL_DURABLE");
    expect(SYNC_STATES).toContain("SYNCED");
  });

  it("starts a session in EDITING, claiming nothing", () => {
    expect(INITIAL_SYNC_STATE).toBe("EDITING");
  });

  it("declares a transition row for every state", () => {
    expect(Object.keys(SYNC_TRANSITIONS).sort()).toEqual([...SYNC_STATES].sort());
  });

  it("only ever targets declared states, on declared events", () => {
    for (const state of SYNC_STATES) {
      for (const [eventType, transition] of Object.entries(SYNC_TRANSITIONS[state])) {
        expect(SYNC_EVENT_TYPES).toContain(eventType);
        const targets =
          "to" in transition ? [transition.to] : Object.values(transition.cases);
        for (const target of targets) {
          expect(SYNC_STATES).toContain(target);
        }
      }
    }
  });
});

describe.each(SYNC_STATES)("syncReducer from %s", (state) => {
  it.each(EVENTS.map((event) => [label(event), event] as const))(
    "handles %s exactly as the transition table says",
    (_name, event) => {
      expect(syncReducer(state, event)).toBe(expectedFromTable(state, event));
    },
  );

  it("returns a declared state for every event (total function)", () => {
    for (const event of EVENTS) {
      expect(SYNC_STATES).toContain(syncReducer(state, event));
    }
  });

  it("leaves the state untouched for every illegal transition", () => {
    for (const event of EVENTS) {
      if (!isLegalTransition(state, event)) {
        expect(syncReducer(state, event)).toBe(state);
      }
    }
  });
});

describe("local save failure reasons", () => {
  it.each([
    ["quota", "ERROR"],
    ["unknown", "ERROR"],
    ["unavailable", "ERROR"],
    ["corrupt", "RECOVERY_REQUIRED"],
  ] as const)("maps %s to %s", (reason, expected) => {
    expect(syncReducer("SAVING_LOCAL", { type: "LOCAL_SAVE_FAILED", reason })).toBe(
      expected,
    );
  });

  it("reserves RECOVERY_REQUIRED for a corrupt store", () => {
    // A browser that refuses IndexedDB is not damaged, and RECOVERY_REQUIRED
    // would be a trap: the recovery flow needs a working store to leave it.
    const recovery = LOCAL_SAVE_FAILURE_REASONS.filter(
      (reason) =>
        syncReducer("SAVING_LOCAL", { type: "LOCAL_SAVE_FAILED", reason }) ===
        "RECOVERY_REQUIRED",
    );
    expect(recovery).toEqual(["corrupt"]);
  });

  it("covers every declared reason", () => {
    const transition = SYNC_TRANSITIONS.SAVING_LOCAL.LOCAL_SAVE_FAILED;
    expect(transition && "cases" in transition).toBe(true);
    if (transition && "cases" in transition) {
      expect(Object.keys(transition.cases).sort()).toEqual(
        [...LOCAL_SAVE_FAILURE_REASONS].sort(),
      );
    }
  });

  it("ignores a local failure that no save preceded", () => {
    expect(syncReducer("SYNCED", { type: "LOCAL_SAVE_FAILED", reason: "corrupt" })).toBe(
      "SYNCED",
    );
  });
});

describe("conflict handling", () => {
  it("enters CONFLICT on a stale base rather than overwriting", () => {
    expect(syncReducer("SYNCING", { type: "SYNC_STALE_BASE" })).toBe("CONFLICT");
  });

  it.each(EVENTS.filter((event) => event.type !== "CONFLICT_RESOLVED").map((event) => [
    label(event),
    event,
  ] as const))("stays in CONFLICT on %s", (_name, event) => {
    expect(syncReducer("CONFLICT", event)).toBe("CONFLICT");
  });

  it("journals the rebased content before resubmitting it", () => {
    // Rebasing produces new content, and new content is made durable before
    // it is sent — a crash mid-rebase must not lose work already resolved.
    expect(syncReducer("CONFLICT", { type: "CONFLICT_RESOLVED", via: "rebase" })).toBe(
      "SAVING_LOCAL",
    );
  });

  it("returns to the server's revision on an explicit discard", () => {
    expect(syncReducer("CONFLICT", { type: "CONFLICT_RESOLVED", via: "discard" })).toBe(
      "SYNCED",
    );
  });

  it("never resubmits rebased content straight to the server", () => {
    expect(
      syncReducer("CONFLICT", { type: "CONFLICT_RESOLVED", via: "rebase" }),
    ).not.toBe("SYNCING");
  });

  it("does not let typing paper over a conflict", () => {
    expect(syncReducer("CONFLICT", { type: "EDIT" })).toBe("CONFLICT");
  });

  it("ignores a resolution when there is no conflict", () => {
    expect(syncReducer("EDITING", { type: "CONFLICT_RESOLVED", via: "rebase" })).toBe(
      "EDITING",
    );
  });
});

describe("recovery handling", () => {
  it.each(EVENTS.filter((event) => event.type !== "RECOVERED").map((event) => [
    label(event),
    event,
  ] as const))("stays in RECOVERY_REQUIRED on %s", (_name, event) => {
    expect(syncReducer("RECOVERY_REQUIRED", event)).toBe("RECOVERY_REQUIRED");
  });

  it("leaves RECOVERY_REQUIRED only through RECOVERED", () => {
    expect(syncReducer("RECOVERY_REQUIRED", { type: "RECOVERED", via: "salvage-local" })).toBe(
      "SAVING_LOCAL",
    );
    expect(syncReducer("RECOVERY_REQUIRED", { type: "RECOVERED", via: "adopt-server" })).toBe(
      "SYNCED",
    );
  });

  it("covers every declared recovery choice, and nothing else", () => {
    const transition = SYNC_TRANSITIONS.RECOVERY_REQUIRED.RECOVERED;
    expect(transition && "cases" in transition).toBe(true);
    if (transition && "cases" in transition) {
      expect(Object.keys(transition.cases).sort()).toEqual([...RECOVERY_CHOICES].sort());
    }
  });

  it("ignores a recovery choice it does not know", () => {
    const rogue = { type: "RECOVERED", via: "constructor" } as unknown as SyncEvent;
    expect(syncReducer("RECOVERY_REQUIRED", rogue)).toBe("RECOVERY_REQUIRED");
  });

  it("ignores RECOVERED when nothing needed recovering", () => {
    for (const via of RECOVERY_CHOICES) {
      expect(syncReducer("SYNCED", { type: "RECOVERED", via })).toBe("SYNCED");
      expect(syncReducer("CONFLICT", { type: "RECOVERED", via })).toBe("CONFLICT");
    }
  });
});

describe("sync failures", () => {
  it.each([true, false])("lands in ERROR when retryable is %s", (retryable) => {
    expect(syncReducer("SYNCING", { type: "SYNC_FAILED", retryable })).toBe("ERROR");
  });

  it("never escalates an unreachable server to RECOVERY_REQUIRED", () => {
    for (const retryable of [true, false]) {
      expect(syncReducer("SYNCING", { type: "SYNC_FAILED", retryable })).not.toBe(
        "RECOVERY_REQUIRED",
      );
    }
  });

  it("allows a retry out of ERROR in both directions", () => {
    expect(syncReducer("ERROR", { type: "LOCAL_SAVE_STARTED" })).toBe("SAVING_LOCAL");
    expect(syncReducer("ERROR", { type: "SYNC_STARTED" })).toBe("SYNCING");
  });
});

describe("editing re-entry", () => {
  it.each(["SYNCED", "LOCAL_DURABLE"] as const)(
    "returns to EDITING from %s on a new candidate",
    (state) => {
      expect(syncReducer(state, { type: "EDIT" })).toBe("EDITING");
    },
  );

  it("does not claim durability for text typed after a local save", () => {
    expect(syncReducer("SAVING_LOCAL", { type: "EDIT" })).toBe("EDITING");
  });

  it("keeps EDITING idempotent for repeated candidates", () => {
    expect(syncReducer("EDITING", { type: "EDIT" })).toBe("EDITING");
  });
});

describe("whole pipeline", () => {
  it("walks the dossier §7 happy path", () => {
    const events: SyncEvent[] = [
      { type: "EDIT" },
      { type: "LOCAL_SAVE_STARTED" },
      { type: "LOCAL_SAVE_OK" },
      { type: "SYNC_STARTED" },
      { type: "SYNC_ACK" },
    ];
    const seen = events.reduce<SyncState[]>(
      (acc, event) => [...acc, syncReducer(acc[acc.length - 1], event)],
      [INITIAL_SYNC_STATE],
    );

    expect(seen).toEqual([
      "EDITING",
      "EDITING",
      "SAVING_LOCAL",
      "LOCAL_DURABLE",
      "SYNCING",
      "SYNCED",
    ]);
  });

  it("walks the corrupt-store path into recovery and back", () => {
    let state: SyncState = "EDITING";
    state = syncReducer(state, { type: "LOCAL_SAVE_STARTED" });
    state = syncReducer(state, { type: "LOCAL_SAVE_FAILED", reason: "corrupt" });
    expect(state).toBe("RECOVERY_REQUIRED");
    // The salvaged text was journalled before this is dispatched, so the
    // machine resumes exactly where an ordinary local write would.
    state = syncReducer(state, { type: "RECOVERED", via: "salvage-local" });
    expect(state).toBe("SAVING_LOCAL");
    state = syncReducer(state, { type: "LOCAL_SAVE_OK" });
    expect(state).toBe("LOCAL_DURABLE");
  });

  it("walks the corrupt-store path into adopting the server's document", () => {
    let state: SyncState = "EDITING";
    state = syncReducer(state, { type: "LOCAL_SAVE_STARTED" });
    state = syncReducer(state, { type: "LOCAL_SAVE_FAILED", reason: "corrupt" });
    expect(state).toBe("RECOVERY_REQUIRED");
    state = syncReducer(state, { type: "RECOVERED", via: "adopt-server" });
    expect(state).toBe("SYNCED");
  });

  it("walks the stale-base path into an explicit discard", () => {
    let state: SyncState = "LOCAL_DURABLE";
    state = syncReducer(state, { type: "SYNC_STARTED" });
    state = syncReducer(state, { type: "SYNC_STALE_BASE" });
    expect(state).toBe("CONFLICT");
    state = syncReducer(state, { type: "CONFLICT_RESOLVED", via: "discard" });
    expect(state).toBe("SYNCED");
  });

  it("walks a rebase back through the journal before the server", () => {
    let state: SyncState = "CONFLICT";
    state = syncReducer(state, { type: "CONFLICT_RESOLVED", via: "rebase" });
    expect(state).toBe("SAVING_LOCAL");
    state = syncReducer(state, { type: "LOCAL_SAVE_OK" });
    expect(state).toBe("LOCAL_DURABLE");
    state = syncReducer(state, { type: "SYNC_STARTED" });
    expect(state).toBe("SYNCING");
  });

  it("keeps an unavailable store out of the recovery trap", () => {
    let state: SyncState = "EDITING";
    state = syncReducer(state, { type: "LOCAL_SAVE_STARTED" });
    state = syncReducer(state, { type: "LOCAL_SAVE_FAILED", reason: "unavailable" });
    expect(state).toBe("ERROR");
    // ERROR can be retried; RECOVERY_REQUIRED could not be, without a store.
    expect(syncReducer(state, { type: "LOCAL_SAVE_STARTED" })).toBe("SAVING_LOCAL");
  });
});

describe("restoreSyncState", () => {
  const snapshot = {
    documentId: "doc",
    revision: 0,
    document: { schemaVersion: 1, nodes: [] },
    savedAt: "2026-09-19T10:00:00.000Z",
  } as unknown as JournalContents["snapshot"];

  it("starts in EDITING when the journal is empty", () => {
    expect(restoreSyncState({ snapshot: null, pending: [], meta: null })).toBe("EDITING");
  });

  it.each(SYNC_STATES)("restores the recorded state %s across a reload", (state) => {
    expect(
      restoreSyncState({
        snapshot,
        pending: [],
        meta: { documentId: "doc", state, localSeq: 3 },
      }),
    ).toBe(state);
  });

  it("does not let a reload clear a conflict", () => {
    const restored = restoreSyncState({
      snapshot,
      pending: [],
      meta: { documentId: "doc", state: "CONFLICT", localSeq: 1 },
    });
    expect(restored).toBe("CONFLICT");
    expect(restored).not.toBe("LOCAL_DURABLE");
  });

  it("does not let a reload clear a required recovery", () => {
    expect(
      restoreSyncState({
        snapshot,
        pending: [],
        meta: { documentId: "doc", state: "RECOVERY_REQUIRED", localSeq: 1 },
      }),
    ).toBe("RECOVERY_REQUIRED");
  });

  it("treats a snapshot without meta as locally durable", () => {
    expect(restoreSyncState({ snapshot, pending: [], meta: null })).toBe("LOCAL_DURABLE");
  });

  it("ignores a stored state the machine does not know", () => {
    const meta = {
      documentId: "doc",
      state: "SAVED",
      localSeq: 1,
    } as unknown as NonNullable<JournalContents["meta"]>;
    expect(restoreSyncState({ snapshot, pending: [], meta })).toBe("LOCAL_DURABLE");
  });
});

describe("robustness", () => {
  it("survives an event type the machine does not know", () => {
    const rogue = { type: "SOMETHING_ELSE" } as unknown as SyncEvent;
    for (const state of SYNC_STATES) {
      expect(syncReducer(state, rogue)).toBe(state);
    }
  });

  it("survives a payload variant the table does not declare", () => {
    const rogue = {
      type: "LOCAL_SAVE_FAILED",
      reason: "meteor",
    } as unknown as SyncEvent;
    expect(syncReducer("SAVING_LOCAL", rogue)).toBe("SAVING_LOCAL");
  });

  it.each(["toString", "constructor", "hasOwnProperty", "__proto__"])(
    "does not read %s off the table's prototype as an event",
    (type) => {
      const rogue = { type } as unknown as SyncEvent;
      for (const state of SYNC_STATES) {
        expect(syncReducer(state, rogue)).toBe(state);
        expect(isLegalTransition(state, rogue)).toBe(false);
      }
    },
  );

  it.each(["toString", "constructor", "valueOf"])(
    "does not read %s off a case table's prototype as a variant",
    (reason) => {
      const rogue = { type: "LOCAL_SAVE_FAILED", reason } as unknown as SyncEvent;
      expect(syncReducer("SAVING_LOCAL", rogue)).toBe("SAVING_LOCAL");
      expect(isLegalTransition("SAVING_LOCAL", rogue)).toBe(false);
    },
  );

  it("survives a state the machine does not know", () => {
    const rogue = "toString" as unknown as SyncState;
    expect(syncReducer(rogue, { type: "EDIT" })).toBe(rogue);
  });

  it("agrees with isLegalTransition on every pair", () => {
    for (const state of SYNC_STATES) {
      for (const event of EVENTS) {
        const legal = isLegalTransition(state, event);
        const next = syncReducer(state, event);
        // Only a legal transition may change the state; a legal one may still
        // be a self-transition (EDIT from EDITING).
        expect(legal || next === state).toBe(true);
      }
    }
  });

  it("reports the payload variant for exactly the three payload events", () => {
    expect(transitionVariant({ type: "LOCAL_SAVE_FAILED", reason: "quota" })).toBe("quota");
    expect(transitionVariant({ type: "SYNC_FAILED", retryable: false })).toBe("false");
    expect(transitionVariant({ type: "CONFLICT_RESOLVED", via: "rebase" })).toBe("rebase");
    expect(transitionVariant({ type: "EDIT" })).toBeNull();
  });
});
