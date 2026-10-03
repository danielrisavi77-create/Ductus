/**
 * F1 mutation model. The dossier (§5) freezes F1 at a single transaction kind:
 * `REPLACE_DOCUMENT`. Finer-grained operations (INSERT_TEXT, SET_MARK, ...)
 * are a later step and must not be smuggled in here.
 *
 * Applying a transaction is a pure compare-and-set: no IO, no clock, no
 * randomness. Persistence and the sync state machine live outside the domain.
 */

import {
  DOCUMENT_SCHEMA_VERSION,
  newNodeId,
  paragraphNode,
  type CanonicalDocument,
} from "./schema";
import { validateDocument } from "./validate";

export type DocumentTransaction = {
  kind: "REPLACE_DOCUMENT";
  /** Client-minted idempotency key: (document, actor, clientTransactionId). */
  clientTransactionId: string;
  /** Revision the client had when it produced `document`. */
  baseRevision: number;
  document: CanonicalDocument;
  /** ISO-8601 instant, supplied by the caller — the domain has no clock. */
  createdAt: string;
};

/** A document at a known canonical revision. Revisions start at 0. */
export type DocumentState = {
  revision: number;
  document: CanonicalDocument;
};

export type ApplyFailureCode = "STALE_BASE" | "INVALID_DOCUMENT";

export type ApplyResult =
  | { ok: true; next: DocumentState }
  | { ok: false; code: ApplyFailureCode };

/**
 * Compare-and-set. `tx.baseRevision` must equal `current.revision`, otherwise
 * the write is rejected as stale — there is no last-write-wins path, by
 * constitution. The base check runs first: a stale client's payload is not
 * this revision's business even if it happens to be malformed too.
 *
 * On success the revision advances by exactly one and the stored document is
 * the validated copy, not the caller's object. Neither `current` nor `tx` is
 * mutated.
 */
export function applyTransaction(
  current: DocumentState,
  tx: DocumentTransaction,
): ApplyResult {
  if (tx.kind !== "REPLACE_DOCUMENT") {
    return { ok: false, code: "INVALID_DOCUMENT" };
  }

  if (tx.baseRevision !== current.revision) {
    return { ok: false, code: "STALE_BASE" };
  }

  const validated = validateDocument(tx.document);
  if (!validated.ok) {
    return { ok: false, code: "INVALID_DOCUMENT" };
  }

  return {
    ok: true,
    next: { revision: current.revision + 1, document: validated.doc },
  };
}

/**
 * The canonical empty document: exactly one empty paragraph. An empty `nodes`
 * array is never a valid document.
 *
 * `uuidFn` is injectable so tests and fixtures stay deterministic.
 */
export function emptyDocument(uuidFn?: () => string): CanonicalDocument {
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    nodes: [paragraphNode(newNodeId(uuidFn))],
  };
}

/** Initial state of a freshly created document: revision 0, one paragraph. */
export function initialDocumentState(uuidFn?: () => string): DocumentState {
  return { revision: 0, document: emptyDocument(uuidFn) };
}
