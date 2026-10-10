// @vitest-environment node
/**
 * Seeded random model of a held `txid_reused` (DAN-135, plan #166 t. 15).
 *
 * Each run mixes edits, lost answers, keys the server already holds with other
 * bytes, late verified duplicates, restarts and the author's decisions, with a
 * clock and the per-document backoff. After every step:
 *   - SYNCED is reached only by the verified receipt of the newest row or by
 *     an explicit, confirmed adoption of the server's version;
 *   - the newest text is queued, on the server under its own key, or was
 *     dropped by that explicit adoption;
 *   - rows that wait while the plan sends nothing are always visible as
 *     RECOVERY_REQUIRED or CONFLICT, never a silent stall.
 * Then the network comes back and the author acts only on what is visible: every
 * run must end in SYNCED within a bounded number of rounds.
 */
import { describe, expect, it } from "vitest";

import { emptyDocument } from "@/domain/document";

import {
  adoptServerEvents,
  ackedRevision,
  fastForwardBase,
  isDiverged,
  mayAttempt,
  newerRowsQueued,
  nextAwaitingReceipt,
  outcomeToEvents,
  planDrain,
  scheduleAfterOutcome,
  type AwaitingReceipt,
  type DrainOutcome,
  type RetrySchedules,
} from "./drain";
import type { PendingTransaction } from "./journal-types";
import { syncReducer, type SyncEvent, type SyncState } from "./states";

const DOC = "11111111-1111-4111-8111-111111111111";
const RUNS = 400;
const STEPS = 30;
const SETTLE_LIMIT = 40;
const DOCUMENT = emptyDocument(() => "aaaaaaaa-0000-4000-8000-000000000001");

/** mulberry32: small, seeded, reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Landed = { revision: number; own: boolean };
type World = {
  revision: number;
  landed: ReadonlyMap<string, Landed>;
  /** Which text each key carries (client side). */
  text: ReadonlyMap<string, number>;
  queue: readonly PendingTransaction[];
  base: number;
  nextSeq: number;
  awaiting: AwaitingReceipt | null;
  state: SyncState;
  schedules: RetrySchedules;
  now: number;
  /** The text the author typed last, and whether they explicitly gave it up. */
  newestText: number;
  adoptedAway: boolean;
};

function reduce(state: SyncState, events: readonly SyncEvent[]): SyncState {
  return events.reduce(syncReducer, state);
}

function journal(world: World, base: number, text: number): World {
  const seq = world.nextSeq;
  const row: PendingTransaction = {
    documentId: DOC,
    localSeq: seq,
    tx: {
      kind: "REPLACE_DOCUMENT",
      clientTransactionId: `T${seq}`,
      baseRevision: base,
      document: DOCUMENT,
      createdAt: "2026-10-10T10:00:00.000Z",
    },
    queuedAt: "2026-10-10T10:00:00.000Z",
  };
  return {
    ...world,
    queue: [...world.queue, row],
    text: new Map(world.text).set(`T${seq}`, text),
    nextSeq: seq + 1,
    newestText: text,
    adoptedAway: false,
  };
}

function edit(world: World): World {
  if (world.state === "CONFLICT" || world.state === "RECOVERY_REQUIRED") {
    return world;
  }
  const typed = journal(world, world.base, world.nextSeq);
  return {
    ...typed,
    state: reduce(world.state, [
      { type: "EDIT" },
      { type: "LOCAL_SAVE_STARTED" },
      { type: "LOCAL_SAVE_OK" },
    ]),
  };
}

/** Salvage: one journal transaction clears the marker and queues the newest text under a NEW key. */
function salvage(world: World): World {
  if (world.state !== "RECOVERY_REQUIRED") {
    return world;
  }
  const cleared = { ...world, awaiting: null, base: world.revision };
  const queued = journal(cleared, world.revision, world.newestText);
  return {
    ...queued,
    state: reduce("RECOVERY_REQUIRED", [
      { type: "RECOVERED", via: "salvage-local" },
      { type: "LOCAL_SAVE_OK" },
    ]),
  };
}

/** Adopt: without confirmation nothing moves; with it, the queue is dropped explicitly. */
function adopt(world: World, confirmed: boolean): World {
  if (world.state !== "RECOVERY_REQUIRED") {
    return world;
  }
  const events = adoptServerEvents(world.queue, DOC, world.awaiting, confirmed);
  if (events.length === 0) {
    expect(reduce(world.state, events)).toBe("RECOVERY_REQUIRED");
    return world;
  }
  return {
    ...world,
    queue: [],
    awaiting: null,
    base: world.revision,
    state: reduce(world.state, events),
    adoptedAway: world.queue.length > 0 || world.adoptedAway,
  };
}

function rebase(world: World): World {
  if (world.state !== "CONFLICT") {
    return world;
  }
  const queued = journal({ ...world, base: world.revision }, world.revision, world.newestText);
  return {
    ...queued,
    state: reduce("CONFLICT", [
      { type: "CONFLICT_RESOLVED", via: "rebase" },
      { type: "LOCAL_SAVE_OK" },
    ]),
  };
}

/** Reload: the marker survives as JSON, backoff (in memory) does not, sticky states do. */
function restart(world: World): World {
  const awaiting = JSON.parse(JSON.stringify(world.awaiting)) as AwaitingReceipt | null;
  let state = world.state;
  if (isDiverged(awaiting) && state !== "RECOVERY_REQUIRED") {
    state = syncReducer(state, { type: "SYNC_KEY_DIVERGED" });
  }
  return { ...world, awaiting, state, schedules: new Map() };
}

/** `lost`: the answer is lost after landing; `dropped`: the request never arrives. */
type Delivery = "signed" | "lost" | "dropped" | "reused";

async function drain(world: World, delivery: Delivery): Promise<World> {
  if (!mayAttempt(world.schedules, DOC, world.now)) {
    return world;
  }
  const sent = planDrain(world.queue, { documentId: DOC, state: world.state, localSeq: 0 }, world.awaiting).send;
  if (sent === null) {
    return world;
  }
  const tx = fastForwardBase(sent.tx, world.base);
  const key = tx.clientTransactionId;
  let { revision, landed } = world;
  const signedReceipt = { status: "signed", signedReceipt: { testReceipt: true } } as const;

  let known = landed.get(key);
  if (known === undefined && delivery === "reused") {
    // Another device used the same key with other bytes and landed first.
    revision += 1;
    known = { revision, own: false };
    landed = new Map(landed).set(key, known);
  }
  let outcome: DrainOutcome;
  if (delivery === "dropped") {
    outcome = { status: "transport_error" };
  } else if (known !== undefined) {
    outcome = known.own
      ? { status: "duplicate", revision: known.revision, receipt: signedReceipt }
      : { status: "txid_reused" };
  } else if (tx.baseRevision === revision) {
    revision += 1;
    landed = new Map(landed).set(key, { revision, own: true });
    outcome = { status: "committed", revision, receipt: signedReceipt };
  } else {
    outcome = { status: "stale_base", currentRevision: revision };
  }
  if (delivery === "lost") {
    outcome = { status: "transport_error" };
  }

  const events = await outcomeToEvents(
    outcome,
    {
      expected: {
        documentId: DOC,
        clientTransactionId: key,
        revision: "revision" in outcome ? outcome.revision : 0,
      },
      verify: async () => true,
    },
    newerRowsQueued(world.queue, sent),
  );
  if (events.some((e) => e.type === "SYNC_ACK")) {
    expect(world.queue.at(-1)).toBe(sent);
    expect(landed.get(key)).toEqual({ revision: ackedRevision(outcome), own: true });
  }
  const acked = ackedRevision(outcome);
  const awaiting = nextAwaitingReceipt(sent, outcome, world.awaiting);
  return {
    ...world,
    revision,
    landed,
    awaiting,
    schedules: scheduleAfterOutcome(world.schedules, DOC, awaiting, world.now, () => 0.5),
    base: acked ?? world.base,
    queue: acked === null ? world.queue : world.queue.filter((r) => r.localSeq > sent.localSeq),
    state: reduce(reduce(world.state, [{ type: "SYNC_STARTED" }]), events),
  };
}

/** A verified duplicate for some queued row arrives late, out of order. */
async function lateDuplicate(world: World, pick: number): Promise<World> {
  const candidates = world.queue.filter((r) => world.landed.get(r.tx.clientTransactionId)?.own);
  if (candidates.length === 0) {
    return world;
  }
  const late = candidates[Math.floor(pick * candidates.length)]!;
  const key = late.tx.clientTransactionId;
  const revision = world.landed.get(key)!.revision;
  const outcome: DrainOutcome = {
    status: "duplicate",
    revision,
    receipt: { status: "signed", signedReceipt: { testReceipt: true } },
  };
  const events = await outcomeToEvents(
    outcome,
    { expected: { documentId: DOC, clientTransactionId: key, revision }, verify: async () => true },
    newerRowsQueued(world.queue, late),
  );
  const awaiting = nextAwaitingReceipt(late, outcome, world.awaiting);
  if (isDiverged(world.awaiting) && world.awaiting!.localSeq !== late.localSeq) {
    expect(awaiting).toBe(world.awaiting);
  }
  // The runner only applies an answer for the row it holds or would send.
  if (awaiting === world.awaiting) {
    return world;
  }
  return {
    ...world,
    awaiting,
    base: revision,
    queue: world.queue.filter((r) => r.localSeq > late.localSeq),
    state: reduce(world.state, events),
  };
}

function expectInvariants(world: World, how: string): void {
  if (world.state === "SYNCED") {
    expect(world.queue, how).toEqual([]);
  }
  if (!world.adoptedAway && world.nextSeq > 1) {
    const kept =
      world.queue.some((r) => world.text.get(r.tx.clientTransactionId) === world.newestText) ||
      [...world.landed].some(([k, l]) => l.own && world.text.get(k) === world.newestText);
    expect(kept, `${how}: newest text lost without a decision`).toBe(true);
  }
  const plan = planDrain(world.queue, { documentId: DOC, state: world.state, localSeq: 0 }, world.awaiting);
  if (world.queue.length > 0 && plan.send === null) {
    expect(["RECOVERY_REQUIRED", "CONFLICT"], `${how}: silent stall`).toContain(world.state);
  }
  if (isDiverged(world.awaiting)) {
    expect(world.schedules.has(DOC), `${how}: hot retry on a diverged hold`).toBe(false);
  }
}

describe("drain model — held txid_reused (DAN-135)", () => {
  it(`${RUNS} seeded runs of ${STEPS} steps end in SYNCED once the author acts on what is visible`, async () => {
    let sawRecovery = 0;
    let sawRefusedAdopt = 0;
    for (let seed = 1; seed <= RUNS; seed += 1) {
      const rand = prng(seed);
      let world: World = {
        revision: 1,
        landed: new Map(),
        text: new Map(),
        queue: [],
        base: 1,
        nextSeq: 1,
        awaiting: null,
        state: "SYNCED",
        schedules: new Map(),
        now: 0,
        newestText: 0,
        adoptedAway: false,
      };
      const path: string[] = [];
      for (let step = 0; step < STEPS; step += 1) {
        const r = rand();
        world = { ...world, now: world.now + Math.floor(rand() * 4_000) };
        let name: string;
        if (r < 0.25) {
          name = "edit";
          world = edit(world);
        } else if (r < 0.4) {
          name = "signed";
          world = await drain(world, "signed");
        } else if (r < 0.48) {
          name = "lost";
          world = await drain(world, "lost");
        } else if (r < 0.55) {
          name = "dropped";
          world = await drain(world, "dropped");
        } else if (r < 0.65) {
          name = "reused";
          world = await drain(world, "reused");
        } else if (r < 0.72) {
          name = "late";
          world = await lateDuplicate(world, rand());
        } else if (r < 0.8) {
          name = "restart";
          world = restart(world);
        } else if (r < 0.88) {
          name = "salvage";
          world = salvage(world);
        } else if (r < 0.94) {
          name = "adopt-unconfirmed";
          const before = world;
          world = adopt(world, false);
          if (before.state === "RECOVERY_REQUIRED" && world === before) {
            sawRefusedAdopt += 1;
          }
        } else {
          name = "adopt-confirmed";
          world = adopt(world, true);
        }
        path.push(name);
        if (world.state === "RECOVERY_REQUIRED") {
          sawRecovery += 1;
        }
        expectInvariants(world, `seed ${seed}: ${path.join(" ")}`);
      }

      // Network back, nobody reuses a key, the author acts on what is visible.
      for (let round = 0; round < SETTLE_LIMIT && !(world.queue.length === 0 && world.state === "SYNCED"); round += 1) {
        const how = `seed ${seed} settle ${round}: ${path.join(" ")}`;
        if (world.state === "RECOVERY_REQUIRED") {
          world = salvage(world);
        } else if (world.state === "CONFLICT") {
          world = rebase(world);
        } else if (world.queue.length === 0) {
          // Nothing owed; the newest text is already on the server.
          break;
        } else {
          const wait = world.schedules.get(DOC)?.notBefore ?? world.now;
          world = await drain({ ...world, now: Math.max(world.now, wait) }, "signed");
        }
        expectInvariants(world, how);
      }
      const how = `seed ${seed}: ${path.join(" ")}`;
      expect(world.queue, how).toEqual([]);
      if (world.nextSeq > 1 && !world.adoptedAway) {
        const top = [...world.landed].filter(([, l]) => l.own).sort((a, b) => b[1].revision - a[1].revision)[0];
        expect(top && world.text.get(top[0]), how).toBe(world.newestText);
      }
    }
    // The runs actually exercised the exit and the refused adoption.
    expect(sawRecovery).toBeGreaterThan(50);
    expect(sawRefusedAdopt).toBeGreaterThan(5);
  }, 60_000);
});
