// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import { emptyDocument, type DocumentTransaction } from "../../domain/document";
import type { DrainOutcome } from "../../domain/sync/drain";
import type { AtomicDexieJournal } from "../journal/atomic-dexie-journal";
import { createDrainRunner, type CommitTransport } from "./drain-runner";
import { journalKit } from "./evidence-test-kit";

/**
 * M0.1 (DAN-376, #1071): drain cases of the core port that had no Ductus
 * runner test (map: docs/engineering/prijenos-jezgre-M0.1-jednakovrijednost.md).
 * Real journal, fake transport, fake receipt verifier. Synthetic data only.
 */

const ID = "33333333-3333-4333-8333-333333333333";
const UTC = "2026-10-11T09:00:00.000Z";
const kit = journalKit("1");
afterEach(kit.cleanup);
const trusted = async () => true;
/** Jitter 0.5 is the exact delay: 1s, 2s, 4s... */
const exact = () => 0.5;

function tx(key: string): DocumentTransaction {
  return {
    kind: "REPLACE_DOCUMENT", clientTransactionId: key, baseRevision: 0,
    document: emptyDocument(() => "dddddddd-0000-4000-8000-000000000001"), createdAt: UTC,
  };
}
async function queue(journal: AtomicDexieJournal, key: string) {
  const seq = (await journal.read(ID)).meta?.localSeq ?? 0;
  await journal.saveLocal(ID, tx(key), UTC, seq);
}
function signed(revision: number): DrainOutcome {
  return { status: "committed", revision, receipt: { status: "signed", signedReceipt: { testReceipt: revision } } };
}
function scripted(...answers: (DrainOutcome | Error | (() => Promise<DrainOutcome>))[]) {
  const sent: string[] = [];
  const transport: CommitTransport = async (_documentId, transaction) => {
    sent.push(transaction.clientTransactionId);
    const next = answers.shift();
    if (next === undefined) throw new Error("unexpected send");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  };
  return { sent, transport };
}

describe("M0.1 drain runner: backoff and fatal answers", () => {
  it("11: a success resets the backoff, so the next failure waits 1s again", async () => {
    const journal = kit.open();
    let clock = 0;
    const { sent, transport } = scripted(new Error("izvan mreže"), new Error("izvan mreže"), signed(1), new Error("izvan mreže"), signed(2));
    const runner = createDrainRunner({ journal, transport, verify: trusted, now: () => clock, jitter: exact });

    await queue(journal, "tx-1");
    expect(await runner.step(ID)).toMatchObject({ kind: "sent", state: "ERROR" });
    expect(await runner.step(ID)).toEqual({ kind: "waiting", notBefore: 1_000 });
    clock = 1_000;
    expect(await runner.step(ID)).toMatchObject({ kind: "sent", state: "ERROR" });
    // Consecutive failures grow the wait.
    expect(await runner.step(ID)).toEqual({ kind: "waiting", notBefore: 3_000 });
    clock = 3_000;
    expect(await runner.step(ID)).toEqual({ kind: "sent", state: "SYNCED", ackedRevision: 1 });

    clock = 50_000;
    await queue(journal, "tx-2");
    expect(await runner.step(ID)).toMatchObject({ kind: "sent", state: "ERROR" });
    expect(await runner.step(ID)).toEqual({ kind: "waiting", notBefore: 51_000 });
    clock = 51_000;
    expect(await runner.step(ID)).toEqual({ kind: "sent", state: "SYNCED", ackedRevision: 2 });
    expect(sent).toEqual(["tx-1", "tx-1", "tx-1", "tx-2", "tx-2"]);
  });

  it("16: after a fatal answer, a new save goes out by itself without a manual retry", async () => {
    const journal = kit.open();
    const { sent, transport } = scripted({ status: "too_large" }, signed(1));
    const runner = createDrainRunner({ journal, transport, verify: trusted, jitter: exact });

    await queue(journal, "tx-1");
    expect(await runner.step(ID)).toMatchObject({ kind: "sent", state: "ERROR", ackedRevision: null });
    expect(await runner.step(ID)).toEqual({ kind: "needs_retry", state: "ERROR" });
    expect(sent).toEqual(["tx-1"]);

    await queue(journal, "tx-2");
    expect(await runner.step(ID)).toEqual({ kind: "sent", state: "SYNCED", ackedRevision: 1 });
    expect(sent).toEqual(["tx-1", "tx-2"]);
    expect((await journal.read(ID)).pending).toEqual([]);
    expect(await runner.step(ID)).toEqual({ kind: "idle" });
  });

  it("17: content saved while a fatal attempt was in flight still drains", async () => {
    const journal = kit.open();
    const { sent, transport } = scripted(async () => {
      await queue(journal, "tx-2");
      return { status: "too_large" };
    }, signed(1));
    const runner = createDrainRunner({ journal, transport, verify: trusted, jitter: exact });

    await queue(journal, "tx-1");
    expect(await runner.step(ID)).toMatchObject({ kind: "sent", state: "ERROR", ackedRevision: null });
    expect((await journal.read(ID)).pending.map((row) => row.tx.clientTransactionId)).toContain("tx-2");

    expect(await runner.step(ID)).toEqual({ kind: "sent", state: "SYNCED", ackedRevision: 1 });
    expect(sent).toEqual(["tx-1", "tx-2"]);
    const stored = await journal.read(ID);
    expect(stored.pending).toEqual([]);
    expect(stored.snapshot?.revision).toBe(1);
  });
});
