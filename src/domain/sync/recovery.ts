/**
 * Recovery planning (F1-5b): what a document can still be rescued from when
 * the local store is corrupt or cannot be read.
 *
 * Pure domain: no React, no Dexie, no IO, no clock. Everything this module
 * needs — whatever the journal managed to hand back, and whatever the server
 * answered — is passed in, and what comes out is a *plan*: the options, which
 * of them are genuinely available, and which one this module would suggest.
 * Performing any of it belongs to `src/lib/journal/recovery.ts`.
 *
 * Constitution rules this file encodes:
 *   - No silent last-write-wins, and no silent last-read-wins either. A plan
 *     is never a decision: `recommended` is a suggestion the UI may highlight,
 *     and nothing here picks for the author. Both options destroy one of two
 *     versions of their work, so both are explicit.
 *   - Local durable state is not canonical server state. `adopt` carries the
 *     revision the SERVER named; `salvage` carries the base revision the local
 *     candidate was written against. No number is invented here.
 *   - Evidence is not judgment. The counts below exist so the author can tell
 *     the two versions apart before choosing; they never decide anything.
 *
 * The one rule that makes "salvage" safe: every candidate is put through
 * `validateDocument` before it is offered. A corrupt store can hand back bytes
 * that are not a canonical document at all, and offering to restore them would
 * turn a recoverable session into an unrecoverable one.
 */

import { validateDocument, type CanonicalDocument } from "../document";
// `RecoveryChoice` itself lives in `states.ts`, next to the transition it
// selects; re-exporting it here would give the barrel two paths to one name.
import type { RecoveryChoice } from "./states";

/** Where a salvageable local document came from. */
export type RecoverySource = "pending" | "snapshot";

/**
 * Why an option cannot be offered.
 *
 * 'journal-unreadable' — nothing at all could be read from the local store.
 * 'nothing-local'      — the store was readable and simply holds no document.
 * 'local-unreadable'   — there are rows, but none of them is a document the
 *                        canonical model can still express.
 * 'server-unavailable' — the server's document could not be read, or what came
 *                        back is not a document either.
 */
export type RecoveryUnavailableReason =
  | "journal-unreadable"
  | "nothing-local"
  | "local-unreadable"
  | "server-unavailable";

/** One version the author could keep, with the numbers that describe it. */
export type RecoveryCandidate = {
  document: CanonicalDocument;
  /**
   * For a salvage: the base revision the local candidate was written against.
   * For an adoption: the revision the server named. Never minted here.
   */
  revision: number;
  nodes: number;
  words: number;
  /** Which journal row this came from. `null` for the server's document. */
  source: RecoverySource | null;
};

export type RecoveryOption = {
  choice: RecoveryChoice;
  available: boolean;
  /** `null` exactly when `available` is true. */
  blockedBy: RecoveryUnavailableReason | null;
  /** The version this option would keep. `null` when it is unavailable. */
  candidate: RecoveryCandidate | null;
};

/**
 * One local row as the caller managed to read it. The document stays
 * `unknown`: a store that is being recovered is precisely a store whose bytes
 * have stopped being trustworthy.
 */
export type LocalCandidateInput = {
  document: unknown;
  /** The base revision the row carries. An unusable one disqualifies the row. */
  revision: unknown;
  /** ISO-8601 instant the row was written, when it could be read. */
  at?: string | null;
} | null;

export type PlanRecoveryInput = {
  /**
   * False when nothing could be read from the local store at all. It is kept
   * separate from "the store is empty" on purpose: a store we could not read
   * must never be reported as a store that holds nothing.
   */
  journalReadable: boolean;
  snapshot: LocalCandidateInput;
  /** The newest queued transaction, or `null`. */
  pendingNewest: LocalCandidateInput;
  /** The server's document, untrusted. `null` when it could not be read. */
  serverDocument: unknown;
  /** The revision the server named, or `null`. */
  serverRevision: unknown;
};

export type RecoveryPlan = {
  canSalvageLocal: boolean;
  canAdoptServer: boolean;
  /**
   * What the panel should offer first. `null` when neither option is
   * available — which is a real situation (an unreadable store and an
   * unreachable server), and one the UI has to state rather than paper over.
   */
  recommended: RecoveryChoice | null;
  /** Both options, recommended first. Always exactly two entries. */
  options: readonly RecoveryOption[];
  /** Shorthand for `options`, for callers that only need the documents. */
  salvage: RecoveryCandidate | null;
  adopt: RecoveryCandidate | null;
};

/**
 * Block count for a canonical document.
 *
 * Re-implemented here rather than imported from `@/editor/interop`, exactly as
 * `conflict.ts` does: the domain must not depend on the editor layer.
 */
function nodeCount(doc: CanonicalDocument): number {
  return doc.nodes.length;
}

/** Whitespace-separated runs, counted per block. A reading aid, never evidence. */
function wordCount(doc: CanonicalDocument): number {
  let total = 0;
  for (const node of doc.nodes) {
    const text = node.children.map((child) => child.text).join("");
    for (const word of text.split(/\s+/u)) {
      if (word.length > 0) {
        total += 1;
      }
    }
  }
  return total;
}

/**
 * A revision that a later compare-and-set can actually be built on. Same rule
 * as the wire contract: fractional, negative, non-finite or unsafe numbers are
 * refused rather than rounded.
 */
function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function candidateFrom(
  input: LocalCandidateInput,
  source: RecoverySource,
): (RecoveryCandidate & { at: string | null }) | null {
  if (input === null || input === undefined) {
    return null;
  }
  if (!isRevision(input.revision)) {
    return null;
  }
  const validated = validateDocument(input.document);
  if (!validated.ok) {
    return null;
  }
  return {
    document: validated.doc,
    revision: input.revision,
    nodes: nodeCount(validated.doc),
    words: wordCount(validated.doc),
    source,
    at: typeof input.at === "string" ? input.at : null,
  };
}

/**
 * The newer of two readable candidates.
 *
 * Compared by the instant each row was written. A row with no readable
 * timestamp loses to one that has it, and a tie goes to the pending row: a
 * local save writes the snapshot and its pending entry in the same
 * transaction with the same instant, and the pending entry is the one that
 * still owes the server, so it is never the older of the two.
 */
function newerOf<T extends { at: string | null }>(pending: T | null, snapshot: T | null): T | null {
  if (pending === null) {
    return snapshot;
  }
  if (snapshot === null) {
    return pending;
  }
  if (snapshot.at !== null && (pending.at === null || snapshot.at > pending.at)) {
    return snapshot;
  }
  return pending;
}

function salvageOption(input: PlanRecoveryInput): RecoveryOption {
  const pending = candidateFrom(input.pendingNewest, "pending");
  const snapshot = candidateFrom(input.snapshot, "snapshot");
  const best = newerOf(pending, snapshot);

  if (best !== null) {
    // `at` is a tie-breaker, not part of the offer: the panel asks about a
    // document, not about when a damaged store happened to stamp a row.
    const candidate: RecoveryCandidate = {
      document: best.document,
      revision: best.revision,
      nodes: best.nodes,
      words: best.words,
      source: best.source,
    };
    return { choice: "salvage-local", available: true, blockedBy: null, candidate };
  }

  const blockedBy: RecoveryUnavailableReason = !input.journalReadable
    ? "journal-unreadable"
    : input.pendingNewest === null && input.snapshot === null
      ? "nothing-local"
      : "local-unreadable";

  return { choice: "salvage-local", available: false, blockedBy, candidate: null };
}

function adoptOption(input: PlanRecoveryInput): RecoveryOption {
  if (isRevision(input.serverRevision)) {
    const validated = validateDocument(input.serverDocument);
    if (validated.ok) {
      return {
        choice: "adopt-server",
        available: true,
        blockedBy: null,
        candidate: {
          document: validated.doc,
          revision: input.serverRevision,
          nodes: nodeCount(validated.doc),
          words: wordCount(validated.doc),
          source: null,
        },
      };
    }
  }

  return {
    choice: "adopt-server",
    available: false,
    blockedBy: "server-unavailable",
    candidate: null,
  };
}

/**
 * Plans the way out of RECOVERY_REQUIRED.
 *
 * Why 'salvage-local' is recommended whenever it is available: it is the only
 * one of the two that destroys nothing. The salvaged text is re-queued against
 * the server's revision and still has to pass the compare-and-set, so a server
 * that has moved on raises an honest conflict instead of an overwrite —
 * whereas adopting the server's document drops local work that, by definition,
 * the server has never seen. When the local store has nothing left to offer,
 * the server's document is the only thing there is, and it is recommended
 * instead.
 *
 * Pure and total: never throws, never mutates its input, and returns both
 * options every time — an unavailable option is still shown, with its reason,
 * because a button that silently disappears tells the author nothing.
 */
export function planRecovery(input: PlanRecoveryInput): RecoveryPlan {
  const salvage = salvageOption(input);
  const adopt = adoptOption(input);

  const recommended: RecoveryChoice | null = salvage.available
    ? "salvage-local"
    : adopt.available
      ? "adopt-server"
      : null;

  const options = recommended === "adopt-server" ? [adopt, salvage] : [salvage, adopt];

  return {
    canSalvageLocal: salvage.available,
    canAdoptServer: adopt.available,
    recommended,
    options,
    salvage: salvage.candidate,
    adopt: adopt.candidate,
  };
}
