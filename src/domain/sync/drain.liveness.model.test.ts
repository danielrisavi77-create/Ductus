// @vitest-environment node
/**
 * Liveness model of the receipt hold (DAN-110, review of PR #159).
 *
 * The single-writer model (`drain.lost-response.model.test.ts`) proves the
 * author never conflicts with their own commit. This one adds what that model
 * cannot reach: another writer, refusals of the replayed key (`stale_base`,
 * a fatal `invalid_document`), answers that say nothing about landing
 * (`unauthenticated`, a payload cut short and read by the real parser as
 * `invalid`), `txid_reused` for a key the server already holds, and the
 * author resolving a
 * CONFLICT by rebasing. Every state reachable in MAX_STEPS steps is visited.
 *
 * From each one the network comes back, nobody else writes, and the author
 * acts only on what the chip shows (rebase a CONFLICT, salvage the local text
 * out of RECOVERY_REQUIRED after `txid_reused` (DAN-135), type a new version
 * after a fatal refusal). The queue must then empty, with the newest version
 * on the server and SYNCED earned by its own signed receipt, without the same
 * key being refused twice (a loop) and without a plan that sends nothing
 * while rows wait outside CONFLICT (a stall). A marker must never name a row
 * the queue no longer holds.
 *
 * Server contract assumed from `@/domain/serverSync/contract`: a landed key
 * replayed with the same bytes is answered `duplicate`, never refused.
 *
 * `late_answer` (#181, plan #183): the answer of the last attempt (the real
 * one when the response was lost) arrives again, late, judged against the
 * queue it finds then. SYNCED then still needs an empty queue and a receipt
 * for the newest row, an owed refusal is never dropped, and the base never
 * goes back.
 */
import { describe, expect, it } from "vitest";

import { emptyDocument } from "@/domain/document";
import { parseCommitOutcome } from "@/domain/serverSync/contract";

import {
  ackedRevision,
  fastForwardBase,
  nextAwaitingReceipt,
  outcomeToEvents,
  planDrain,
  type AwaitingReceipt,
  type DrainOutcome,
} from "./drain";
import type { PendingTransaction } from "./journal-types";
import { syncReducer, type SyncEvent, type SyncState } from "./states";

const DOC = "11111111-1111-4111-8111-111111111111";
const MAX_STEPS = 10;
const SETTLE_LIMIT = 12;

/** What happens to one drain attempt. */
const DELIVERIES = [
  "signed",
  "pending_signature",
  "response_lost",
  "request_lost",
  "unauthenticated",
  "garbled",
  "reused",
  "fatal",
] as const;
type Delivery = (typeof DELIVERIES)[number];
type Step = "edit" | "other_writer" | "rebase" | "late_answer" | Delivery;
const STEPS: readonly Step[] = ["edit", "other_writer", "rebase", "late_answer", ...DELIVERIES];

type World = {
  /** Server: current revision, the revision each key created, keys it refuses for good. */
  revision: number;
  landed: ReadonlyMap<string, number>;
  poisoned: ReadonlySet<string>;
  foreign: number;
  /** Client. */
  queue: readonly PendingTransaction[];
  base: number;
  nextSeq: number;
  awaiting: AwaitingReceipt | null;
  state: SyncState;
  /** The last attempt's answer as the server gave it, which may still arrive late. */
  stray: { sent: PendingTransaction; outcome: DrainOutcome } | null;
};

const DOCUMENT = emptyDocument(() => "aaaaaaaa-0000-4000-8000-000000000001");

/** The answer loses its last field on the wire; the real parser must say `invalid`. */
function garble(outcome: DrainOutcome): DrainOutcome {
  const fields = Object.entries(outcome);
  const parsed = parseCommitOutcome(Object.fromEntries(fields.slice(0, -1)));
  expect(parsed).toEqual({ status: "invalid" });
  return parsed as DrainOutcome;
}

function reduce(state: SyncState, events: readonly SyncEvent[]): SyncState {
  return events.reduce(syncReducer, state);
}

function edit(world: World, base = world.base): World {
  if (world.state === "CONFLICT" || world.state === "RECOVERY_REQUIRED") {
    return world;
  }
  const row: PendingTransaction = {
    documentId: DOC,
    localSeq: world.nextSeq,
    tx: {
      kind: "REPLACE_DOCUMENT",
      clientTransactionId: `tx-${world.nextSeq}`,
      baseRevision: base,
      document: DOCUMENT,
      createdAt: "2026-10-10T10:00:00.000Z",
    },
    queuedAt: "2026-10-10T10:00:00.000Z",
  };
  return {
    ...world,
    queue: [...world.queue, row],
    nextSeq: world.nextSeq + 1,
    state: reduce(world.state, [
      { type: "EDIT" },
      { type: "LOCAL_SAVE_STARTED" },
      { type: "LOCAL_SAVE_OK" },
    ]),
  };
}

function otherWriter(world: World): World {
  const revision = world.revision + 1;
  return {
    ...world,
    revision,
    foreign: world.foreign + 1,
    landed: new Map(world.landed).set(`foreign-${world.foreign}`, revision),
  };
}

/** The author rebases a CONFLICT: a new row on the server's revision, journalled first. */
function rebase(world: World): World {
  if (world.state !== "CONFLICT") {
    return world;
  }
  const resolved = {
    ...world,
    base: world.revision,
    state: syncReducer("CONFLICT", { type: "CONFLICT_RESOLVED", via: "rebase" }),
  };
  return edit(resolved, world.revision);
}

/**
 * The author salvages local text out of RECOVERY_REQUIRED (DAN-135): one
 * journal transaction clears the diverged marker and queues the newest text
 * as a NEW row with a NEW key on the server's revision. The held row and the
 * rows after it stay queued below it, superseded, until its receipt.
 */
function salvage(world: World): World {
  if (world.state !== "RECOVERY_REQUIRED") {
    return world;
  }
  const resolved = {
    ...world,
    awaiting: null,
    base: world.revision,
    state: syncReducer("RECOVERY_REQUIRED", { type: "RECOVERED", via: "salvage-local" }),
  };
  return edit(resolved, world.revision);
}

type Drained = { world: World; refused: string | null; fatal: boolean };

async function drain(world: World, delivery: Delivery): Promise<Drained> {
  const meta = { documentId: DOC, state: world.state, localSeq: 0 };
  const plan = planDrain(world.queue, meta, world.awaiting);
  const sent = plan.send;
  if (sent === null) {
    return { world, refused: null, fatal: false };
  }
  const tx = fastForwardBase(sent.tx, world.base);
  const key = tx.clientTransactionId;
  let { revision, landed, poisoned } = world;

  let outcome: DrainOutcome;
  let stray: World["stray"] = null;
  if (delivery === "request_lost") {
    outcome = { status: "transport_error" };
  } else if (delivery === "unauthenticated") {
    outcome = { status: "unauthenticated" };
  } else {
    const receipt =
      delivery === "pending_signature"
        ? ({ status: "pending_signature" } as const)
        : ({ status: "signed", signedReceipt: { testReceipt: true } } as const);
    const known = landed.get(key);
    if (known !== undefined && delivery === "reused") {
      // The key is on the server, but the replay's bytes differ from it.
      outcome = { status: "txid_reused" };
    } else if (known !== undefined) {
      outcome = { status: "duplicate", revision: known, receipt };
    } else if (delivery === "fatal" || poisoned.has(key)) {
      poisoned = new Set(poisoned).add(key);
      outcome = { status: "invalid_document" };
    } else if (tx.baseRevision === revision) {
      revision += 1;
      landed = new Map(landed).set(key, revision);
      outcome = { status: "committed", revision, receipt };
    } else {
      outcome = { status: "stale_base", currentRevision: revision };
    }
    stray = { sent, outcome };
    if (delivery === "response_lost") {
      outcome = { status: "transport_error" };
    } else if (delivery === "garbled") {
      outcome = garble(outcome);
    }
  }

  const { events, acked } = await answer(world, sent, outcome, landed);
  return {
    world: {
      ...world,
      revision,
      landed,
      poisoned,
      awaiting: nextAwaitingReceipt(sent, outcome, world.awaiting),
      base: acked ?? world.base,
      queue: acked === null ? world.queue : world.queue.filter((r) => r.localSeq > sent.localSeq),
      state: reduce(reduce(world.state, [{ type: "SYNC_STARTED" }]), events),
      stray: stray ?? { sent, outcome },
    },
    refused: outcome.status === "stale_base" || outcome.status === "invalid_document" ? key : null,
    fatal: outcome.status === "invalid_document",
  };
}

/** The runner hands an answer the queue it finds; the invariants of #183 hold for each. */
async function answer(
  world: World,
  sent: PendingTransaction,
  outcome: DrainOutcome,
  landed: World["landed"],
): Promise<{ events: SyncEvent[]; acked: number | null }> {
  const key = sent.tx.clientTransactionId;
  const events = await outcomeToEvents(
    outcome,
    {
      expected: {
        documentId: sent.documentId,
        clientTransactionId: key,
        revision: "revision" in outcome ? outcome.revision : 0,
      },
      verify: async () => true,
    },
    { sent, pending: world.queue },
  );
  // SYNCED may only describe the newest row, and only once the server holds it.
  if (events.some((e) => e.type === "SYNC_ACK")) {
    expect(world.queue.at(-1)).toBe(sent);
    expect(landed.get(key)).toBe(ackedRevision(outcome));
  }
  // A refusal of a row that is still owed always reaches the state.
  const owed = world.queue.includes(sent);
  if (owed && (outcome.status === "stale_base" || outcome.status === "txid_reused")) {
    expect(events).not.toEqual([]);
  }
  const acked = ackedRevision(outcome);
  // The base never goes back.
  if (acked !== null) {
    expect(acked).toBeGreaterThanOrEqual(world.base);
  }
  return { events, acked };
}

/** The last attempt's answer arrives (again), late, while the runner is in a flight. */
async function lateAnswer(world: World): Promise<World> {
  if (world.stray === null) {
    return world;
  }
  const { sent, outcome } = world.stray;
  const { events, acked } = await answer(world, sent, outcome, world.landed);
  if (events.length === 0 && acked === null && nextAwaitingReceipt(sent, outcome, world.awaiting) === world.awaiting) {
    return { ...world, stray: null };
  }
  return {
    ...world,
    awaiting: nextAwaitingReceipt(sent, outcome, world.awaiting),
    base: acked ?? world.base,
    queue: acked === null ? world.queue : world.queue.filter((r) => r.localSeq > sent.localSeq),
    state: reduce(reduce(world.state, [{ type: "SYNC_STARTED" }]), events),
    stray: null,
  };
}

/** SYNCED never stands next to an owed row. */
function expectSyncedHonest(world: World): void {
  if (world.state === "SYNCED") {
    expect(world.queue).toEqual([]);
  }
}

/** A marker that names no queued row can never be released by an answer. */
function expectNoOrphanMarker(world: World): void {
  if (world.awaiting === null) {
    return;
  }
  const held = world.awaiting;
  expect(
    world.queue.some(
      (r) => r.localSeq === held.localSeq && r.tx.clientTransactionId === held.clientTransactionId,
    ),
  ).toBe(true);
}

function fingerprint(world: World): string {
  return JSON.stringify([
    world.revision,
    [...world.landed].sort(),
    [...world.poisoned].sort(),
    world.foreign,
    world.queue.map((r) => [r.localSeq, r.tx.baseRevision]),
    world.base,
    world.nextSeq,
    world.awaiting,
    world.state,
    world.stray && [world.stray.sent.localSeq, world.stray.outcome],
  ]);
}

type Failure = { path: Step[]; reason: string };

/** Network back, no other writer, the author acts only on what is visible. */
async function settle(start: World): Promise<string | null> {
  let world = start;
  const refusedOnce = new Set<string>();
  for (let round = 0; round < SETTLE_LIMIT; round += 1) {
    if (world.queue.length === 0) {
      if (start.nextSeq > 1 && world.state !== "SYNCED") {
        return `queue empty but state is ${world.state}`;
      }
      if (start.nextSeq > 1 && !world.landed.has(`tx-${world.nextSeq - 1}`)) {
        return "the newest version never reached the server";
      }
      return null;
    }
    if (world.state === "CONFLICT") {
      world = rebase(world);
      continue;
    }
    if (world.state === "RECOVERY_REQUIRED") {
      world = salvage(world);
      continue;
    }
    const drained = await drain(world, "signed");
    if (drained.world === world) {
      return "stall: rows wait outside CONFLICT and the plan sends nothing";
    }
    if (drained.refused !== null) {
      if (refusedOnce.has(drained.refused)) {
        return `loop: ${drained.refused} refused twice`;
      }
      refusedOnce.add(drained.refused);
    }
    world = drained.world;
    expectNoOrphanMarker(world);
    if (drained.fatal) {
      // ERROR is on screen and that version cannot go; the author types on.
      world = edit(world);
    }
  }
  return `no progress after ${SETTLE_LIMIT} rounds`;
}

describe("drain model — liveness of the receipt hold", () => {
  it(`every reachable state (≤ ${MAX_STEPS} steps) drains or ends in a visible CONFLICT the author resolves`, async () => {
    const failures: Failure[] = [];
    const seen = new Set<string>();
    let frontier: Array<{ world: World; path: Step[] }> = [
      {
        world: {
          revision: 1,
          landed: new Map(),
          poisoned: new Set(),
          foreign: 0,
          queue: [],
          base: 1,
          nextSeq: 1,
          awaiting: null,
          state: "SYNCED",
          stray: null,
        },
        path: [],
      },
    ];
    const reasons = new Set<string>();

    for (let depth = 0; depth <= MAX_STEPS && frontier.length > 0; depth += 1) {
      const next: typeof frontier = [];
      for (const { world, path } of frontier) {
        const id = fingerprint(world);
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        expectNoOrphanMarker(world);
        expectSyncedHonest(world);
        const reason = await settle(world);
        if (reason !== null && failures.length < 5) {
          failures.push({ path, reason });
        }
        if (reason !== null) {
          reasons.add(reason.split(":")[0]!);
        }
        if (depth === MAX_STEPS) {
          continue;
        }
        for (const step of STEPS) {
          let after: World;
          if (step === "edit") {
            after = edit(world);
          } else if (step === "other_writer") {
            after = otherWriter(world);
          } else if (step === "rebase") {
            after = rebase(world);
          } else if (step === "late_answer") {
            after = await lateAnswer(world);
          } else {
            after = (await drain(world, step)).world;
          }
          next.push({ world: after, path: [...path, step] });
        }
      }
      frontier = next;
    }

    expect(seen.size).toBeGreaterThan(10_000);
    expect(failures).toEqual([]);
    expect([...reasons]).toEqual([]);
  }, 120_000);
});
