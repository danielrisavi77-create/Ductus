/**
 * Row shapes for the local durable journal (F1-3a).
 *
 * Pure types: no Dexie import, no IO. The storage engine is an implementation
 * detail of `src/lib/journal/`, and the domain must stay readable (and
 * testable) without it.
 *
 * INVARIANT (dossier §7) — the atomic local transaction must save *together*:
 *   1. the snapshot (the canonical candidate),
 *   2. the pending transaction (what still owes the server),
 *   3. the local sequence,
 *   4. the sync state.
 * All four are written inside ONE IndexedDB transaction. A partial write is
 * the failure mode this invariant exists to forbid: a snapshot without its
 * pending row would silently drop an author's change from the sync queue
 * while the UI kept claiming the text was safe.
 *
 * INVARIANT (constitution) — local durable state is not canonical server
 * state. `JournalSnapshot.revision` is the *base* revision the candidate was
 * derived from, never a revision the server has assigned to this content; the
 * server mints revisions on ACK (F1-4a) and nothing here may pretend otherwise.
 */

import type { CanonicalDocument, DocumentTransaction } from "../document";
import type { LocalSaveFailureReason, SyncState } from "./states";

/**
 * The newest canonical candidate for a document, as last written locally.
 * One row per document: the journal keeps the latest snapshot, while the
 * `pending` rows carry the history that still owes the server.
 */
export type JournalSnapshot = {
  documentId: string;
  /**
   * The canonical server revision this candidate was based on — NOT a
   * revision of `document` itself. Advances only when the server ACKs.
   */
  revision: number;
  document: CanonicalDocument;
  /** ISO-8601 instant of the local write. */
  savedAt: string;
};

/**
 * One queued transaction awaiting server CAS. Keyed by
 * `[documentId+localSeq]`, so the queue is ordered per document and an ACK
 * can clear a prefix of it (`clearPending`).
 *
 * These are debounced canonical candidates, never keystrokes: the constitution
 * forbids per-keystroke logging, and the editor only projects after the author
 * stops typing.
 */
export type PendingTransaction = {
  documentId: string;
  /** Monotonic, per document, starting at 1. Never reused, never decreases. */
  localSeq: number;
  tx: DocumentTransaction;
  /** ISO-8601 instant the entry was queued. */
  queuedAt: string;
};

/**
 * Per-document journal bookkeeping: the sync state as last known locally, the
 * high-water mark of the local sequence, and the last local failure reason.
 *
 * `state` is what the journal recorded; it is not a claim about the server.
 */
export type SyncMeta = {
  documentId: string;
  state: SyncState;
  /** Highest `localSeq` ever assigned for this document. */
  localSeq: number;
  /** Set when the last local write failed; cleared on the next success. */
  lastError?: LocalSaveFailureReason;
};

/** Everything the journal holds about one document, read back together. */
export type JournalContents = {
  snapshot: JournalSnapshot | null;
  /** Ascending by `localSeq`. */
  pending: PendingTransaction[];
  meta: SyncMeta | null;
};
