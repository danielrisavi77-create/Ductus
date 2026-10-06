// @vitest-environment node
import { describe, expect, it } from "vitest";

import { emptyDocument, type DocumentTransaction } from "@/domain/document";
import { commitRequestFromTransaction } from "@/domain/serverSync/contract";
import { planDrain, type DrainPlan } from "./drain";
import type { PendingTransaction } from "./journal-types";

function row(localSeq: number): PendingTransaction {
  return {
    documentId: "11111111-1111-4111-8111-111111111111",
    localSeq,
    tx: {
      kind: "REPLACE_DOCUMENT",
      clientTransactionId: `tx-${localSeq}`,
      baseRevision: 0,
      document: emptyDocument(() => "aaaaaaaa-0000-4000-8000-000000000001"),
      createdAt: "2026-10-06T12:00:00.000Z",
    },
    queuedAt: "2026-10-06T12:00:00.000Z",
  };
}

function unsupported(localSeq: number): PendingTransaction {
  const known = row(localSeq);
  return { ...known, tx: { ...known.tx, kind: "FUTURE_KIND" } as unknown as DocumentTransaction };
}

/** Pure caller simulation: remove a prefix only after acknowledgement. No DB IO. */
function acknowledgePrefix(rows: readonly PendingTransaction[], plan: DrainPlan) {
  return plan.send === null
    ? [...rows]
    : rows.filter((entry) => entry.localSeq > plan.send!.localSeq);
}

describe("planDrain — data-preserving queue boundaries", () => {
  // Each literal plan catches crossing an unsupported sequence during send or
  // supersession; skipping unknown rows only while finding a maximum is unsafe.
  it.each([
    { name: "unsupported row before all replacements", rows: [unsupported(1), row(2), row(3)], send: null, superseded: null },
    { name: "unsupported row between replacements", rows: [row(1), unsupported(2), row(3)], send: 1, superseded: null },
    { name: "unsupported row after replacements", rows: [row(1), row(2), unsupported(3)], send: 2, superseded: 1 },
    { name: "unsorted rows with an interior barrier", rows: [row(4), unsupported(3), row(1), row(2)], send: 2, superseded: 1 },
    { name: "earliest of several unsupported rows", rows: [row(5), unsupported(4), row(1), unsupported(2), row(3)], send: 1, superseded: null },
    { name: "unsupported row tied with first replacement", rows: [row(1), unsupported(1), row(2)], send: null, superseded: null },
    { name: "unsupported row tied with later replacement", rows: [row(1), row(2), unsupported(2), row(3)], send: 1, superseded: null },
    { name: "unsupported tie in reversed input order", rows: [unsupported(2), row(3), row(2), row(1)], send: 1, superseded: null },
    { name: "only unsupported rows", rows: [unsupported(3), unsupported(1)], send: null, superseded: null },
    { name: "valid replacement queue", rows: [row(7), row(2), row(5)], send: 7, superseded: 5 },
  ])("$name", ({ rows, send, superseded }) => {
    const before = structuredClone(rows);
    const plan = planDrain(rows, null);
    expect(plan.send?.localSeq ?? null).toBe(send);
    expect(plan.supersededUpTo).toBe(superseded);
    expect(rows).toEqual(before);
  });

  it.each([
    { name: "empty", key: "" },
    { name: "absent", key: undefined },
  ])("does not cross a supported-kind row with $name idempotency key", ({ key }) => {
    const malformed = {
      ...row(2),
      tx: { ...row(2).tx, clientTransactionId: key },
    } as unknown as PendingTransaction;
    const plan = planDrain([row(1), malformed, row(3)], null);
    expect(plan.send?.localSeq).toBe(1);
    expect(plan.supersededUpTo).toBeNull();
  });

  it.each([
    { name: "at the first sequence", rows: [row(1), row(1), row(2)], send: null },
    { name: "after a safe prefix", rows: [row(1), row(2), row(2), row(3)], send: 1 },
    { name: "unsorted", rows: [row(4), row(2), row(1), row(2)], send: 1 },
  ])("does not clear ambiguous replacement rows $name", ({ rows, send }) => {
    const plan = planDrain(rows, null);
    expect(plan.send?.localSeq ?? null).toBe(send);
    expect(plan.supersededUpTo).toBeNull();
  });

  it("preserves unknown rows through both supersession and acknowledged send prefixes", () => {
    const foreign = unsupported(3);
    const later = row(4);
    const rows = [row(1), foreign, later, row(2)];
    const plan = planDrain(rows, null);
    expect(plan.send?.localSeq).toBe(2);
    expect(plan.supersededUpTo).toBe(1);
    const afterSupersession = rows.filter(
      (entry) => plan.supersededUpTo === null || entry.localSeq > plan.supersededUpTo,
    );
    expect(afterSupersession).toContain(foreign);
    const remaining = acknowledgePrefix(afterSupersession, plan);
    expect(remaining).toEqual([foreign, later]);
    expect(planDrain(remaining, null)).toEqual({ send: null, supersededUpTo: null });
  });

  it("leaves every row intact when the first sequence cannot be sent", () => {
    const rows = [unsupported(1), row(2)];
    expect(acknowledgePrefix(rows, planDrain(rows, null))).toEqual(rows);
  });

  it("keeps the original fractional-sequence behavior without claiming its row", () => {
    const fractional = { ...row(2), localSeq: 1.5 };
    expect(planDrain([row(1), fractional], null)).toEqual({ send: row(1), supersededUpTo: null });
  });
  it.each([
    { name: "fractional before every valid row", sequence: 0.5, send: null },
    { name: "fractional between valid rows", sequence: 1.5, send: 1 },
    { name: "zero before every valid row", sequence: 0, send: null },
    { name: "negative before every valid row", sequence: -1, send: null },
    { name: "unsafe finite number after valid rows", sequence: Number.MAX_SAFE_INTEGER + 1, send: 3 },
  ])("respects a finite corrupted sequence: $name", ({ sequence, send }) => {
    const damaged = { ...unsupported(2), localSeq: sequence };
    const rows = [row(3), damaged, row(1)];
    const plan = planDrain(rows, null);
    expect(plan.send?.localSeq ?? null).toBe(send);
    expect(plan.supersededUpTo).toBe(send === 3 ? 1 : null);
    expect(acknowledgePrefix(rows, plan)).toContain(damaged);
  });

  it.each([
    { name: "NaN", sequence: Number.NaN },
    { name: "positive infinity", sequence: Number.POSITIVE_INFINITY },
    { name: "negative infinity", sequence: Number.NEGATIVE_INFINITY },
    { name: "missing", sequence: undefined },
    { name: "numeric string", sequence: "2" },
    { name: "null", sequence: null },
  ])("stops when a row has an unorderable sequence: $name", ({ sequence }) => {
    const damaged = { ...row(2), localSeq: sequence } as unknown as PendingTransaction;
    const rows = [row(1), damaged, row(3)];
    const before = structuredClone(rows);
    const plan = planDrain(rows, null);
    expect(plan).toEqual({ send: null, supersededUpTo: null });
    expect(acknowledgePrefix(rows, plan)).toEqual(rows);
    expect(rows).toEqual(before);
  });

});

/** This exact shape has 144 JSON bytes before its ASCII text payload. */
function documentSized(bytes: number) {
  const document = row(1).tx.document;
  document.nodes[0].children = [{ type: "text", text: "a".repeat(bytes - 144), marks: [] }];
  return document;
}

function damagedRow(change: Record<string, unknown>): PendingTransaction {
  const valid = row(2);
  return { ...valid, tx: { ...valid.tx, ...change } } as unknown as PendingTransaction;
}

describe("planDrain - actual commit wire rejection boundaries", () => {
  // Reusing the real builder proves why these rows cannot be acknowledged;
  // literal prefix outcomes catch the planner discarding them nevertheless.
  const multibyteDocument = row(2).tx.document;
  multibyteDocument.nodes[0].children = [
    { type: "text", text: "\u010d".repeat(524_217), marks: [] },
  ];
  const rejected: { name: string; damaged: PendingTransaction }[] = [
    { name: "idempotency key of length 129", damaged: damagedRow({ clientTransactionId: "x".repeat(129) }) },
    { name: "negative base revision", damaged: damagedRow({ baseRevision: -1 }) },
    { name: "fractional base revision", damaged: damagedRow({ baseRevision: 1.5 }) },
    { name: "NaN base revision", damaged: damagedRow({ baseRevision: Number.NaN }) },
    { name: "infinite base revision", damaged: damagedRow({ baseRevision: Number.POSITIVE_INFINITY }) },
    { name: "negative infinite base revision", damaged: damagedRow({ baseRevision: Number.NEGATIVE_INFINITY }) },
    { name: "unsafe base revision", damaged: damagedRow({ baseRevision: Number.MAX_SAFE_INTEGER + 1 }) },
    { name: "string base revision", damaged: damagedRow({ baseRevision: "0" }) },
    { name: "missing base revision", damaged: damagedRow({ baseRevision: undefined }) },
    { name: "null base revision", damaged: damagedRow({ baseRevision: null }) },
    { name: "non-string idempotency key", damaged: damagedRow({ clientTransactionId: 7 }) },
    { name: "empty idempotency key", damaged: damagedRow({ clientTransactionId: "" }) },
    { name: "missing idempotency key", damaged: damagedRow({ clientTransactionId: undefined }) },
    { name: "empty document id", damaged: { ...row(2), documentId: "" } },
    { name: "missing document id", damaged: { ...row(2), documentId: undefined } as unknown as PendingTransaction },
    { name: "non-string document id", damaged: { ...row(2), documentId: 7 } as unknown as PendingTransaction },
    { name: "unsupported transaction kind", damaged: unsupported(2) },
    { name: "document one byte over 1 MiB", damaged: damagedRow({ document: documentSized(1_048_577) }) },
    { name: "document over 1 MiB in UTF-8 bytes", damaged: damagedRow({ document: multibyteDocument }) },
  ];

  it.each(rejected)("preserves $name through supersession and ACK prefixes", ({ damaged }) => {
    expect(commitRequestFromTransaction(damaged.documentId, damaged.tx)).toBeNull();
    const later = row(3);
    const rows = [row(1), damaged, later];
    const before = structuredClone(rows);
    const plan = planDrain(rows, null);
    expect(plan.send?.localSeq).toBe(1);
    expect(plan.supersededUpTo).toBeNull();
    expect(plan.supersededUpTo !== null && damaged.localSeq <= plan.supersededUpTo).toBe(false);
    expect(plan.send !== null && damaged.localSeq <= plan.send.localSeq).toBe(false);
    const afterSupersession = rows.filter(
      (entry) => plan.supersededUpTo === null || entry.localSeq > plan.supersededUpTo,
    );
    expect(afterSupersession).toContain(damaged);
    expect(acknowledgePrefix(afterSupersession, plan)).toEqual([damaged, later]);
    expect(rows).toEqual(before);
  });

  it.each([
    { name: "overlong key", change: { clientTransactionId: "x".repeat(129) } },
    { name: "negative base", change: { baseRevision: -1 } },
  ])("keeps a nonempty removable prefix before an unsorted $name barrier", ({ change }) => {
    const damaged = { ...damagedRow(change), localSeq: 3 };
    const later = row(4);
    const rows = [later, row(1), damaged, row(2)];
    const plan = planDrain(rows, null);
    expect(plan.send?.localSeq).toBe(2);
    expect(plan.supersededUpTo).toBe(1);
    const afterSupersession = rows.filter(
      (entry) => plan.supersededUpTo === null || entry.localSeq > plan.supersededUpTo,
    );
    expect(afterSupersession).toContain(damaged);
    expect(acknowledgePrefix(afterSupersession, plan)).toEqual([later, damaged]);
  });

  const cyclicDocument: Record<string, unknown> = { ...row(2).tx.document };
  cyclicDocument.self = cyclicDocument;
  it.each([
    { name: "cyclic document", damaged: damagedRow({ document: cyclicDocument }) },
    { name: "BigInt document field", damaged: damagedRow({ document: { ...row(2).tx.document, damaged: 1n } }) },
    { name: "null transaction", damaged: { ...row(2), tx: null } as unknown as PendingTransaction },
    { name: "missing transaction", damaged: { ...row(2), tx: undefined } as unknown as PendingTransaction },
  ])("keeps total planning and both prefixes safe for $name", ({ damaged }) => {
    expect(() => commitRequestFromTransaction(damaged.documentId, damaged.tx)).toThrow(TypeError);
    const later = row(3);
    const rows = [row(1), damaged, later];
    const before = structuredClone(rows);
    const plan = planDrain(rows, null);
    expect(plan.send?.localSeq).toBe(1);
    expect(plan.supersededUpTo).toBeNull();
    expect(acknowledgePrefix(rows, plan)).toEqual([damaged, later]);
    expect(rows).toEqual(before);
  });

  it.each([
    { name: "128-character key and base zero", change: { clientTransactionId: "x".repeat(128), baseRevision: 0 } },
    { name: "maximum safe base revision", change: { baseRevision: Number.MAX_SAFE_INTEGER } },
    { name: "document exactly 1 MiB", change: { document: documentSized(1_048_576) } },
  ])("continues sending a valid wire boundary: $name", ({ change }) => {
    const newest = { ...damagedRow(change), localSeq: 3 };
    expect(commitRequestFromTransaction(newest.documentId, newest.tx)).not.toBeNull();
    if ("document" in change) {
      expect(new TextEncoder().encode(JSON.stringify(newest.tx.document)).length).toBe(1_048_576);
    }
    const plan = planDrain([row(2), newest, row(1)], null);
    expect(plan.send).toBe(newest);
    expect(plan.supersededUpTo).toBe(2);
  });

  it("blocks every send when the earliest row exceeds the wire key limit", () => {
    const damaged = { ...damagedRow({ clientTransactionId: "x".repeat(129) }), localSeq: 1 };
    const rows = [row(3), damaged, row(2)];
    const plan = planDrain(rows, null);
    expect(plan).toEqual({ send: null, supersededUpTo: null });
    expect(acknowledgePrefix(rows, plan)).toEqual(rows);
  });
});
