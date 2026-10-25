import { describe, expect, it } from "vitest";

import { emptyDocument } from "../document";
import { MAX_EVIDENCE_SEGMENT_BYTES } from "../forensics/evidence-chain-v2";
import { awaitingReceiptFor, fastForwardBase, planDrain, type QueuedRow } from "./drain";
import type { EvidenceSegmentTransaction, PendingTransaction } from "./journal-types";

/**
 * F-8 3d-2a (DAN-285): the plan for a queue of evidence segments. Rows are a
 * chain, so the oldest owed one goes, nothing is superseded, and a queue of
 * both kinds sends nothing. The bytes are placeholders: the plan checks only
 * their shape, the journal verified them when it queued the row.
 */

const DOC = "dokument-izmisljeni";
const UTC = "2026-10-24T12:00:00.000Z";

function segment(localSeq: number, over: Partial<EvidenceSegmentTransaction> = {}): PendingTransaction<EvidenceSegmentTransaction> {
  return {
    documentId: DOC,
    localSeq,
    queuedAt: UTC,
    tx: {
      kind: "EVIDENCE_SEGMENT",
      clientTransactionId: `seg-${localSeq.toString(16).padStart(64, "0")}`,
      baseRevision: 4,
      segment: new Uint8Array([123, 125]),
      segmentHash: localSeq.toString(16).padStart(64, "0"),
      document: new Uint8Array([123, 125]),
      sequenceFrom: localSeq,
      sequenceTo: localSeq,
      createdAt: UTC,
      ...over,
    },
  };
}

function replacement(localSeq: number): PendingTransaction {
  return {
    documentId: DOC,
    localSeq,
    queuedAt: UTC,
    tx: {
      kind: "REPLACE_DOCUMENT", clientTransactionId: `tx-${localSeq}`, baseRevision: 4,
      document: emptyDocument(() => "aaaaaaaa-0000-4000-8000-000000000001"), createdAt: UTC,
    },
  };
}

const LOCAL = { documentId: DOC, localSeq: 3, state: "LOCAL_DURABLE" } as const;

describe("F-8 3d-2a: planDrain over evidence segments", () => {
  it("sends the oldest row and supersedes nothing, whatever the order of the input", () => {
    const rows = [segment(3), segment(1), segment(2)];
    expect(planDrain(rows, LOCAL)).toEqual({ send: rows[1], supersededUpTo: null });
  });

  it("replays the held row, never the next one", () => {
    const rows = [segment(1), segment(2), segment(3)];
    expect(planDrain(rows, LOCAL, awaitingReceiptFor(rows[0]!))).toEqual({ send: rows[0], supersededUpTo: null });
    expect(planDrain(rows.slice(1), LOCAL, awaitingReceiptFor(rows[0]!))).toEqual({ send: null, supersededUpTo: null });
  });

  it("a hold on a row that is not the oldest owed one sends nothing, so no row overtakes an older one", () => {
    const rows = [segment(1), segment(2), segment(3)];
    for (const held of [rows[1]!, rows[2]!]) {
      expect(planDrain(rows, LOCAL, awaitingReceiptFor(held))).toEqual({ send: null, supersededUpTo: null });
    }
    // A damaged oldest row is still the oldest owed one: a hold behind it sends nothing either.
    const damaged = [segment(1, { clientTransactionId: "" }), segment(2)];
    expect(planDrain(damaged, LOCAL, awaitingReceiptFor(damaged[1]!))).toEqual({ send: null, supersededUpTo: null });
  });

  it.each([
    ["an unsendable key", { clientTransactionId: "" }],
    ["a segment over the limit", { segment: new Uint8Array(MAX_EVIDENCE_SEGMENT_BYTES + 1) }],
    ["no document bytes", { document: new Uint8Array() }],
    ["a malformed hash", { segmentHash: "Z".repeat(64) }],
    ["a falling sequence", { sequenceFrom: 2, sequenceTo: 1 }],
  ])("a damaged oldest row (%s) sends nothing; a damaged later row lets only the rows before it go", (_name, damage) => {
    expect(planDrain([segment(1, damage), segment(2)], LOCAL)).toEqual({ send: null, supersededUpTo: null });
    const rows = [segment(1), segment(2, damage), segment(3)];
    expect(planDrain(rows, LOCAL)).toEqual({ send: rows[0], supersededUpTo: null });
    expect(planDrain(rows.slice(1), LOCAL)).toEqual({ send: null, supersededUpTo: null });
  });

  it("a queue of both kinds sends nothing, in either order", () => {
    const rows: QueuedRow[] = [replacement(1), segment(2)];
    expect(planDrain(rows, LOCAL)).toEqual({ send: null, supersededUpTo: null });
    expect(planDrain([segment(1), replacement(2)], LOCAL)).toEqual({ send: null, supersededUpTo: null });
  });

  it.each(["CONFLICT", "RECOVERY_REQUIRED"] as const)("%s sends nothing", (state) => {
    expect(planDrain([segment(1)], { ...LOCAL, state })).toEqual({ send: null, supersededUpTo: null });
  });

  it("a queue of replacements still sends its newest row", () => {
    const rows = [replacement(1), replacement(2)];
    expect(planDrain(rows, LOCAL)).toEqual({ send: rows[1], supersededUpTo: 1 });
  });

  it("fastForwardBase moves only the base of a segment, never its bytes or key", () => {
    const row = segment(1);
    const sent = fastForwardBase(row.tx, 6);
    expect(sent).toEqual({ ...row.tx, baseRevision: 6 });
    expect(sent.segment).toBe(row.tx.segment);
    expect(fastForwardBase(row.tx, 3)).toBe(row.tx);
  });
});
