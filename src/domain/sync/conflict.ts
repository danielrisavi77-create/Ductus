/**
 * Conflicts and their explicit resolution (F1-5a).
 *
 * Pure domain: no React, no Dexie, no IO, no network. The only concession is
 * an injectable clock (`nowFn`), because a conflict is a *dated* fact — when
 * it was detected and when the author decided are part of the record.
 *
 * What a conflict is, in F1: the server refused a compare-and-set because the
 * base revision the transaction carried is no longer the server's current one
 * (`stale_base`). Someone — another tab, another device, an earlier session
 * whose ACK was lost — moved the document on.
 *
 * Constitution rules this file encodes:
 *   - No silent last-write-wins. Nothing here resolves anything on its own:
 *     `resolveConflict` is a pure function of a decision the author has
 *     already made, and there is no default, no timeout and no "probably
 *     fine" shortcut. Even when the two versions are textually identical the
 *     resolution is still explicit — `conflictSummary` may tell the UI that
 *     there is no real difference, but it never makes the choice.
 *   - The original conflict stays recorded. A `ConflictRecord` carries BOTH
 *     versions and is never mutated in place: resolving one returns a new
 *     record with `resolvedVia`/`resolvedAt` added, so the local document the
 *     author chose to drop is still there afterwards. The journal is what
 *     keeps it (see `recordConflict` / `markConflictResolved`), and nothing in
 *     this subsystem deletes a resolved conflict.
 *   - Local durable state is not canonical server state. No revision is
 *     minted here. `nextBaseRevision` is always the revision the SERVER named,
 *     never a number this module made up.
 *
 * What "rebase" means in F1. Every F1 transaction is `REPLACE_DOCUMENT` and
 * carries the whole document (dossier §5), so there is no three-way merge to
 * perform: rebasing is re-committing MY document against the NEW server
 * revision, after the author has seen both. That is why the rebase output is
 * `journalAction: 'save-local'` — new content goes through the journal before
 * it goes to the server, so a crash mid-rebase cannot lose work the author
 * already watched being resolved.
 */

import { contentEqual, documentsEqual, type CanonicalDocument } from "../document";
import { CONFLICT_RESOLUTIONS, type ConflictResolution } from "./states";

/**
 * One detected conflict, with both versions kept whole.
 *
 * `serverDocument` is nullable on purpose. The conflict is detected by a
 * failed CAS, and fetching the server's version afterwards is a second round
 * trip that can itself fail (offline, session expired). A record whose server
 * side is missing is still a real, recorded conflict — it simply cannot be
 * resolved by discarding yet, because there is nothing to adopt. A later
 * successful fetch fills it in (`refreshConflictServerSide`).
 *
 * `serverRevision` is NOT nullable: the `stale_base` answer always carries the
 * server's current revision, so the number is known even when the bytes are
 * not.
 *
 * Structured-clone friendly (plain data only): the journal stores this row
 * verbatim in IndexedDB.
 */
export type ConflictRecord = {
  documentId: string;
  /** ISO-8601 instant the conflict was detected. Part of the primary key. */
  detectedAt: string;
  /** What this client was trying to commit. Kept even after a discard. */
  localDocument: CanonicalDocument;
  /** The base revision that turned out to be stale. */
  localBaseRevision: number;
  /** The server's version, or `null` when it could not be fetched (yet). */
  serverDocument: CanonicalDocument | null;
  /** The server's current revision, as the refused CAS reported it. */
  serverRevision: number;
  /** Set once, by the author's explicit decision. Never cleared. */
  resolvedVia?: ConflictResolution;
  /** ISO-8601 instant of that decision. */
  resolvedAt?: string;
};

/** Everything `buildConflictRecord` needs. The clock is separate. */
export type ConflictDetection = {
  documentId: string;
  localDocument: CanonicalDocument;
  localBaseRevision: number;
  serverDocument: CanonicalDocument | null;
  serverRevision: number;
};

/**
 * What the caller must do to the journal to carry out the decision.
 *
 * 'save-local'   — journal my document against the server's revision, then
 *                  let the drain send it (rebase).
 * 'clear-pending' — drop everything still queued and adopt the server's
 *                  document as the local one (discard).
 */
export const CONFLICT_JOURNAL_ACTIONS = ["save-local", "clear-pending"] as const;

export type ConflictJournalAction = (typeof CONFLICT_JOURNAL_ACTIONS)[number];

/**
 * Why a resolution was refused.
 *
 * 'server-unknown'     — a discard was asked for but the server's document has
 *                        not been fetched, so there is nothing to adopt.
 * 'already-resolved'   — this record carries a decision already; resolving it
 *                        a second time would rewrite a recorded fact.
 * 'unknown-resolution' — `via` is not one of the two resolutions.
 */
export type ConflictResolutionFailure =
  | "server-unknown"
  | "already-resolved"
  | "unknown-resolution";

export type ConflictResolutionOk = {
  ok: true;
  via: ConflictResolution;
  /** The document that becomes the local truth after the decision. */
  nextDocument: CanonicalDocument;
  /** The base every later commit is written against. Always the server's. */
  nextBaseRevision: number;
  journalAction: ConflictJournalAction;
  /** The record with the decision stamped on it. The original is untouched. */
  record: ConflictRecord;
};

export type ConflictResolutionResult =
  | ConflictResolutionOk
  | { ok: false; reason: ConflictResolutionFailure };

/** Counts for one version, for the panel that asks the author to choose. */
export type ConflictVersionSummary = {
  nodes: number;
  words: number;
};

export type ConflictSummary = {
  local: ConflictVersionSummary;
  /** `null` when the server's document has not been fetched. */
  server: ConflictVersionSummary | null;
  serverAvailable: boolean;
  /**
   * True when the two versions say the same thing, node ids aside. The UI may
   * offer a shortcut ("no real difference"), but the decision stays explicit:
   * this flag never resolves anything by itself.
   */
  contentEqual: boolean;
};

function defaultNow(): string {
  return new Date().toISOString();
}

function isResolution(value: unknown): value is ConflictResolution {
  return (
    typeof value === "string" &&
    (CONFLICT_RESOLUTIONS as readonly string[]).includes(value)
  );
}

/** True when an author's decision is already recorded on this conflict. */
export function isResolvedConflict(record: ConflictRecord): boolean {
  return isResolution(record.resolvedVia);
}

/**
 * Builds the record for a freshly detected conflict.
 *
 * Fields are copied one by one rather than spread: the detection may come
 * from a caller that carries extra keys (a server answer, a stored row), and
 * the record is written to IndexedDB verbatim. A fresh record is always
 * unresolved — there is no way to build one that is born decided.
 */
export function buildConflictRecord(
  detection: ConflictDetection,
  nowFn: () => string = defaultNow,
): ConflictRecord {
  return {
    documentId: detection.documentId,
    detectedAt: nowFn(),
    localDocument: detection.localDocument,
    localBaseRevision: detection.localBaseRevision,
    serverDocument: detection.serverDocument,
    serverRevision: detection.serverRevision,
  };
}

/**
 * The record as the AUTHOR should be asked about it: same conflict, but with
 * "my version" being the newest local text rather than the one the refused
 * commit happened to carry.
 *
 * Why this exists. The conflict is detected when the server refuses a commit,
 * and the document keeps moving for a moment afterwards — the refusal has to
 * travel back, the server's version has to be fetched, and only then does the
 * editor go read-only. Anything the author typed in that window is journalled
 * and is genuinely theirs; rebasing onto the transaction that was refused
 * would throw it away, silently, as part of an action labelled "keep my
 * version". So resolution reads the newest durable document and the panel
 * counts THAT.
 *
 * The stored row is not touched: `record.localDocument` remains the evidence
 * of what was actually refused, and only the copy handed to the panel and to
 * `resolveConflict` carries the newer text. Returns the record unchanged when
 * there is nothing newer, so an unchanged document never looks like a change.
 */
export function withLatestLocalDocument(
  record: ConflictRecord,
  latest: CanonicalDocument | null | undefined,
): ConflictRecord {
  if (!latest || documentsEqual(record.localDocument, latest)) {
    return record;
  }
  return { ...record, localDocument: latest };
}

function stamped(
  record: ConflictRecord,
  via: ConflictResolution,
  nowFn: () => string,
): ConflictRecord {
  return { ...record, resolvedVia: via, resolvedAt: nowFn() };
}

/**
 * Turns the author's decision into the outputs the caller has to apply.
 *
 *   rebase  → keep MY document, but based on the server's revision, and put it
 *             through the journal first ('save-local'). The compare-and-set is
 *             still the backstop: if a third writer commits in between, the
 *             next attempt is another honest conflict, not an overwrite.
 *   discard → adopt the SERVER's document at the server's revision and drop
 *             everything queued ('clear-pending'). Only possible once the
 *             server's document has actually been fetched — "adopt the server
 *             version" cannot mean "adopt a document we do not have".
 *
 * Pure and total: never throws, never mutates `record`, and the returned
 * `record` is a resolved copy the caller can persist next to (not instead of)
 * the original.
 *
 * Note that rebase stays available when the server's document is missing.
 * Keeping my own text destroys nothing — the server's revision log still has
 * its version, and the CAS will refuse the commit if the base moved again —
 * whereas a discard without the server's bytes has no result at all.
 */
export function resolveConflict(
  record: ConflictRecord,
  via: ConflictResolution,
  nowFn: () => string = defaultNow,
): ConflictResolutionResult {
  if (!isResolution(via)) {
    return { ok: false, reason: "unknown-resolution" };
  }
  if (isResolvedConflict(record)) {
    return { ok: false, reason: "already-resolved" };
  }

  if (via === "discard") {
    if (record.serverDocument === null) {
      return { ok: false, reason: "server-unknown" };
    }
    return {
      ok: true,
      via,
      nextDocument: record.serverDocument,
      nextBaseRevision: record.serverRevision,
      journalAction: "clear-pending",
      record: stamped(record, via, nowFn),
    };
  }

  return {
    ok: true,
    via,
    nextDocument: record.localDocument,
    nextBaseRevision: record.serverRevision,
    journalAction: "save-local",
    record: stamped(record, via, nowFn),
  };
}

/**
 * Block count for a canonical document.
 *
 * Deliberately re-implemented here rather than imported from
 * `@/editor/interop`: the domain must not depend on the editor layer, and the
 * canonical model is the only thing either version reads.
 */
function nodeCount(doc: CanonicalDocument): number {
  return doc.nodes.length;
}

/**
 * Word count over the canonical text: whitespace-separated runs, counted per
 * block so a paragraph break never fuses two words.
 *
 * A reading aid for the conflict panel, nothing more. It is never evidence
 * about authorship and never decides anything.
 */
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
 * The numbers the conflict panel shows so the author can tell the two
 * versions apart before choosing.
 *
 * `contentEqual` compares ignoring node ids, which is the honest question for
 * a human ("does it say the same thing?"); it is false whenever the server's
 * version is unknown, because "we did not look" is not "they are the same".
 */
export function conflictSummary(record: ConflictRecord): ConflictSummary {
  const local: ConflictVersionSummary = {
    nodes: nodeCount(record.localDocument),
    words: wordCount(record.localDocument),
  };

  if (record.serverDocument === null) {
    return { local, server: null, serverAvailable: false, contentEqual: false };
  }

  return {
    local,
    server: {
      nodes: nodeCount(record.serverDocument),
      words: wordCount(record.serverDocument),
    },
    serverAvailable: true,
    contentEqual: contentEqual(record.localDocument, record.serverDocument),
  };
}
