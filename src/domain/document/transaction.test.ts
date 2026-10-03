import { describe, expect, it } from "vitest";

import {
  applyTransaction,
  emptyDocument,
  initialDocumentState,
  type DocumentState,
  type DocumentTransaction,
} from "./transaction";
import { documentsEqual } from "./equality";
import {
  isNodeId,
  newNodeId,
  paragraphNode,
  textNode,
  type CanonicalDocument,
} from "./schema";

const ID_A = newNodeId(() => "11111111-1111-4111-8111-111111111111");
const ID_B = newNodeId(() => "22222222-2222-4222-8222-222222222222");

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

function tx(
  overrides: Partial<DocumentTransaction> = {},
): DocumentTransaction {
  return freezeDeep({
    kind: "REPLACE_DOCUMENT",
    clientTransactionId: "ctx-1",
    baseRevision: 0,
    document: {
      schemaVersion: 1,
      nodes: [paragraphNode(ID_B, [textNode("Novi tekst")])],
    } as CanonicalDocument,
    createdAt: "2026-09-19T10:00:00.000Z",
    ...overrides,
  });
}

function state(revision = 0): DocumentState {
  return freezeDeep({
    revision,
    document: {
      schemaVersion: 1,
      nodes: [paragraphNode(ID_A, [textNode("Staro")])],
    } as CanonicalDocument,
  });
}

describe("emptyDocument", () => {
  it("is exactly one empty paragraph with a real id", () => {
    const document = emptyDocument(() => "33333333-3333-4333-8333-333333333333");
    expect(document.schemaVersion).toBe(1);
    expect(document.nodes).toHaveLength(1);
    expect(document.nodes[0].type).toBe("paragraph");
    expect(document.nodes[0].children).toEqual([]);
    expect(isNodeId(document.nodes[0].id)).toBe(true);
  });

  it("mints a fresh id per call with the default generator", () => {
    expect(emptyDocument().nodes[0].id).not.toBe(emptyDocument().nodes[0].id);
  });

  it("starts a document state at revision 0", () => {
    const initial = initialDocumentState(
      () => "33333333-3333-4333-8333-333333333333",
    );
    expect(initial.revision).toBe(0);
    expect(initial.document.nodes).toHaveLength(1);
  });
});

describe("applyTransaction", () => {
  it("applies a REPLACE_DOCUMENT on a matching base revision", () => {
    const result = applyTransaction(state(0), tx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.document.nodes[0].id).toBe(ID_B);
  });

  it("increments the revision by exactly one", () => {
    const result = applyTransaction(state(7), tx({ baseRevision: 7 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.revision).toBe(8);
  });

  it("chains: each applied transaction advances one revision", () => {
    let current: DocumentState = state(0);
    for (let i = 0; i < 3; i += 1) {
      const result = applyTransaction(current, tx({ baseRevision: i }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      current = result.next;
    }
    expect(current.revision).toBe(3);
  });

  it("rejects a stale base revision with STALE_BASE", () => {
    const behind = applyTransaction(state(3), tx({ baseRevision: 2 }));
    expect(behind).toEqual({ ok: false, code: "STALE_BASE" });
    const ahead = applyTransaction(state(3), tx({ baseRevision: 4 }));
    expect(ahead).toEqual({ ok: false, code: "STALE_BASE" });
  });

  it("checks the base revision before the document payload", () => {
    const result = applyTransaction(
      state(1),
      tx({
        baseRevision: 0,
        document: { schemaVersion: 1, nodes: [] } as CanonicalDocument,
      }),
    );
    expect(result).toEqual({ ok: false, code: "STALE_BASE" });
  });

  it("rejects an empty nodes array with INVALID_DOCUMENT", () => {
    const result = applyTransaction(
      state(0),
      tx({ document: { schemaVersion: 1, nodes: [] } as CanonicalDocument }),
    );
    expect(result).toEqual({ ok: false, code: "INVALID_DOCUMENT" });
  });

  it("rejects a structurally broken document with INVALID_DOCUMENT", () => {
    const result = applyTransaction(
      state(0),
      tx({
        document: {
          schemaVersion: 1,
          nodes: [{ type: "paragraph", id: "p1", children: [] }],
        } as unknown as CanonicalDocument,
      }),
    );
    expect(result).toEqual({ ok: false, code: "INVALID_DOCUMENT" });
  });

  it("rejects an unknown transaction kind with INVALID_DOCUMENT", () => {
    const result = applyTransaction(
      state(0),
      tx({ kind: "INSERT_TEXT" as DocumentTransaction["kind"] }),
    );
    expect(result).toEqual({ ok: false, code: "INVALID_DOCUMENT" });
  });

  it("is pure: frozen inputs are neither mutated nor rejected", () => {
    const current = state(0);
    const transaction = tx();
    const before = structuredClone(current);

    const result = applyTransaction(current, transaction);

    expect(result.ok).toBe(true);
    expect(current.revision).toBe(before.revision);
    expect(documentsEqual(current.document, before.document)).toBe(true);
    expect(transaction.baseRevision).toBe(0);
  });

  it("stores a copy of the payload, not the transaction's own object", () => {
    const transaction = tx();
    const result = applyTransaction(state(0), transaction);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.document).not.toBe(transaction.document);
    expect(documentsEqual(result.next.document, transaction.document)).toBe(
      true,
    );
  });

  it("carries the idempotency key untouched on the transaction", () => {
    const transaction = tx({ clientTransactionId: "ctx-42" });
    expect(transaction.clientTransactionId).toBe("ctx-42");
    expect(applyTransaction(state(0), transaction).ok).toBe(true);
  });
});
