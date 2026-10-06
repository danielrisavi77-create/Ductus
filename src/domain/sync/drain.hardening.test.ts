// @vitest-environment node
import { describe, expect, it } from "vitest";

import { emptyDocument, type DocumentTransaction } from "@/domain/document";
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
