// @vitest-environment node
/**
 * Exhaustive single-writer model of the drain decisions with lost answers
 * (STATE.md F-3/F-8, follow-up to the PR #97 review).
 *
 * One author, one tab, no other writer: whatever the network does, the server
 * must never answer `stale_base`, because the only commits it holds are the
 * author's own. Every sequence of steps up to MAX_STEPS is walked.
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

const DOC = "11111111-1111-4111-8111-111111111111";
const MAX_STEPS = 7;

/** What the network does to one drain attempt. */
const DELIVERIES = [
  "signed",
  "pending_signature",
  "response_lost",
  "request_lost",
  "garbled",
] as const;
type Delivery = (typeof DELIVERIES)[number];
type Step = "edit" | Delivery;
const STEPS: readonly Step[] = ["edit", ...DELIVERIES];

type World = {
  /** Server: current revision and the revision each idempotency key created. */
  revision: number;
  landed: ReadonlyMap<string, number>;
  /** Client: queue, the base it may build on, and the hold. */
  queue: readonly PendingTransaction[];
  base: number;
  nextSeq: number;
  awaiting: AwaitingReceipt | null;
};

const DOCUMENT = emptyDocument(() => "aaaaaaaa-0000-4000-8000-000000000001");

/**
 * The answer arrives cut short: its last field is lost on the wire. Whatever
 * the server said, the real parser must read that as `invalid`, and the CAS
 * may well have landed behind it.
 */
function garble(outcome: DrainOutcome): DrainOutcome {
  const fields = Object.entries(outcome);
  const parsed = parseCommitOutcome(Object.fromEntries(fields.slice(0, -1)));
  expect(parsed).toEqual({ status: "invalid" });
  return parsed as DrainOutcome;
}

function edit(world: World): World {
  const row: PendingTransaction = {
    documentId: DOC,
    localSeq: world.nextSeq,
    tx: {
      kind: "REPLACE_DOCUMENT",
      clientTransactionId: `tx-${world.nextSeq}`,
      baseRevision: world.base,
      document: DOCUMENT,
      createdAt: "2026-09-19T10:00:00.000Z",
    },
    queuedAt: "2026-09-19T10:00:00.000Z",
  };
  return { ...world, queue: [...world.queue, row], nextSeq: world.nextSeq + 1 };
}

async function drain(world: World, delivery: Delivery): Promise<World | "stale_base"> {
  const plan = planDrain(world.queue, null, world.awaiting);
  const sent = plan.send;
  if (sent === null) {
    return world;
  }
  const tx = fastForwardBase(sent.tx, world.base);

  let { revision, landed } = world;
  let outcome: DrainOutcome;
  if (delivery === "request_lost") {
    outcome = { status: "transport_error" };
  } else {
    const receipt =
      delivery === "signed"
        ? ({ status: "signed", signedReceipt: { testReceipt: true } } as const)
        : ({ status: "pending_signature" } as const);
    const known = landed.get(tx.clientTransactionId);
    if (known !== undefined) {
      outcome = { status: "duplicate", revision: known, receipt };
    } else if (tx.baseRevision === revision) {
      revision += 1;
      landed = new Map(landed).set(tx.clientTransactionId, revision);
      outcome = { status: "committed", revision, receipt };
    } else {
      return "stale_base";
    }
    if (delivery === "response_lost") {
      outcome = { status: "transport_error" };
    } else if (delivery === "garbled") {
      outcome = garble(outcome);
    }
  }

  // A pending signature is never verified; a signed receipt is verified for
  // exactly the row that was sent (PR #97: never for another one).
  const events = await outcomeToEvents(
    outcome,
    {
      expected: {
        documentId: sent.documentId,
        clientTransactionId: tx.clientTransactionId,
        revision: "revision" in outcome ? outcome.revision : 0,
      },
      verify: async () => true,
    },
    { sent, pending: world.queue },
  );
  // SYNCED may only describe the newest row, and only once the server holds it.
  if (events.some((e) => e.type === "SYNC_ACK")) {
    expect(world.queue.at(-1)).toBe(sent);
    expect(landed.get(tx.clientTransactionId)).toBe(ackedRevision(outcome));
  }
  const acked = ackedRevision(outcome);
  return {
    ...world,
    revision,
    landed,
    awaiting: nextAwaitingReceipt(sent, outcome, world.awaiting),
    base: acked ?? world.base,
    queue: acked === null ? world.queue : world.queue.filter((r) => r.localSeq > sent.localSeq),
  };
}

describe("drain model — one author, lost answers", () => {
  it(`never conflicts with the author's own commit (all sequences ≤ ${MAX_STEPS})`, async () => {
    const stale: Step[][] = [];
    let walked = 0;

    async function walk(world: World, path: Step[]): Promise<void> {
      walked += 1;
      if (path.length === MAX_STEPS) {
        // With the network back, the queue drains and the server holds the
        // newest edit.
        let settled: World | "stale_base" = world;
        for (let i = 0; i < 3 && settled !== "stale_base" && settled.queue.length > 0; i += 1) {
          settled = await drain(settled, "signed");
        }
        if (settled === "stale_base") {
          stale.push([...path, "signed"]);
          return;
        }
        expect(settled.queue).toEqual([]);
        // Every key was applied at most once: one revision per landed key.
        expect(settled.landed.size).toBe(settled.revision - 1);
        if (world.nextSeq > 1) {
          expect(settled.landed.has(`tx-${world.nextSeq - 1}`)).toBe(true);
        }
        return;
      }
      for (const step of STEPS) {
        const next = step === "edit" ? edit(world) : await drain(world, step);
        if (next === "stale_base") {
          stale.push([...path, step]);
          continue;
        }
        await walk(next, [...path, step]);
      }
    }

    await walk(
      { revision: 1, landed: new Map(), queue: [], base: 1, nextSeq: 1, awaiting: null },
      [],
    );

    expect(walked).toBeGreaterThan(STEPS.length ** MAX_STEPS);
    expect(stale).toEqual([]);
  }, 60_000);
});
