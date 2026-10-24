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
import type { AwaitingReceipt } from "./drain";
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
export type PendingTransaction<T extends QueuedTransaction = DocumentTransaction> = {
  documentId: string;
  /** Monotonic, per document, starting at 1. Never reused, never decreases. */
  localSeq: number;
  tx: T;
  /** ISO-8601 instant the entry was queued. */
  queuedAt: string;
};

/**
 * F-8 3d-2a (DAN-285): one evidence segment v2 and the document after its
 * last event, as the exact JCS bytes that were hashed and that go on the wire
 * (BACKEND 4.13 t. 2). A document's queue holds one kind of row only; these
 * rows are sent oldest first and never superseded (`planDrain`). The time of
 * each step is not here: it stays in the browser (`EvidenceTiming`).
 */
export type EvidenceSegmentTransaction = {
  kind: "EVIDENCE_SEGMENT";
  clientTransactionId: string;
  baseRevision: number;
  segment: Uint8Array;
  /** SHA-256 of `segment`; the receipt of this row must name it. */
  segmentHash: string;
  document: Uint8Array;
  sequenceFrom: number;
  sequenceTo: number;
  /** ISO-8601 instant the row was queued. */
  createdAt: string;
};

export type QueuedTransaction = DocumentTransaction | EvidenceSegmentTransaction;

/**
 * What the journal takes from the recorder (`BuiltSegment` of
 * `src/editor/capture.ts` is assignable to it; the domain does not import the
 * editor). Only the bytes are trusted, and only after they are verified.
 */
export type EvidenceSegmentInput = {
  bytes: Uint8Array;
  sha256: string;
  document: Uint8Array;
  timing: {
    segmentHash: string;
    sequenceFrom: number;
    events: readonly { sequence: number; stepOffsetsMs: readonly number[] }[];
  };
};

/** The time of every step of one segment: local only, kept until logout. */
export type EvidenceTiming = {
  segmentHash: string;
  documentId: string;
  sequenceFrom: number;
  events: { sequence: number; stepOffsetsMs: number[] }[];
};

/** The server's head of the chain: the last segment it acknowledged. */
export type EvidenceHead = { segmentHash: string | null; lastSequenceTo: number };

/** Why the recorder stopped; the text after it is not covered by evidence. */
export type EvidenceStop = "gap" | "unsupported_step" | "block_identity" | "too_large";

/**
 * F-8 3d-2b: the local text a document with evidence held when the author
 * took the server's version (`adoptServerEvidence`). Kept on the device
 * until the author lets it go; it blocks logout until then (owner decision
 * #476 c.6385940910).
 */
export type SalvageCopy = {
  id: number;
  documentId: string;
  document: CanonicalDocument;
  /** The state the author left, or the stop of the recorder once nothing was owed. */
  cause: "CONFLICT" | "RECOVERY_REQUIRED" | "EVIDENCE_STOPPED";
  /** Set when the text was saved after the recorder had stopped. */
  evidenceStopped?: EvidenceStop;
  localSeq: number;
  decidedAt: string;
};

/** The work as the open route reported it (`OpenedWork` of 3c is assignable). */
export type EvidenceOpening = {
  documentId: string;
  currentRevision: number;
  documentHash: string;
  headSegmentHash: string | null;
  lastSequenceTo: number;
  document: Uint8Array;
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
  /**
   * The row whose answer the queue is waiting on (`nextAwaitingReceipt`).
   * Written before the request leaves and kept by every local save, so a
   * reload replays exactly that row instead of a newer one on an old base.
   */
  awaitingReceipt?: AwaitingReceipt;
  /** Set on a document with evidence; moves only on a verified receipt. */
  evidenceHead?: EvidenceHead;
  /** Set once the recorder stopped; never cleared before logout. */
  evidenceStopped?: EvidenceStop;
};

/**
 * Everything the journal holds about one document, read back together. `T`
 * is the kind of row the reader's documents hold: the journal keeps one kind
 * per document, and a document with evidence (`evidenceHead`) only segments.
 */
export type JournalContents<T extends QueuedTransaction = DocumentTransaction> = {
  snapshot: JournalSnapshot | null;
  /** Ascending by `localSeq`. */
  pending: PendingTransaction<T>[];
  meta: SyncMeta | null;
};
