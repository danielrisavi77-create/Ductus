import type { ProcessSummarySourceResult } from "@/application/ports/process-summary-source";

/**
 * Where the replay of a document is read from (DAN-344, contract on #923).
 *
 * Bound to the requesting actor before the reader sees it (in production two
 * read RPCs run inside `withActor`). The replay is built from the same record
 * as the process summary, so `readSource` owes what `ProcessSummarySource`
 * owes: one record for every viewer, refusal that looks like absence, and the
 * submission cut. `readCheckpoints` returns the exact text of the revisions
 * whose content hashes are asked for, in the caller's institution and only
 * when the caller may read the document; a hash with no such text is absent
 * from the map, never an error.
 *
 * A found record also names, per listed segment and in the same order, the
 * SHA-256 of its stored timing, or null where it has none (DAN-344 P1-b): the
 * same for every viewer, as the listing is.
 */
export type ReplaySourceResult =
  | (Extract<ProcessSummarySourceResult, { status: "found" }> & { timingHashes: (string | null)[] })
  | Exclude<ProcessSummarySourceResult, { status: "found" }>;

export type ReplayCheckpointsResult =
  | { status: "found"; texts: ReadonlyMap<string, string> }
  | { status: "unauthenticated" }
  | { status: "unavailable"; reason: string };

export interface ReplaySource {
  readSource(documentId: string): Promise<ReplaySourceResult>;
  /** `contentHashes` are 1 to 512 distinct lowercase SHA-256 hex strings. */
  readCheckpoints(documentId: string, contentHashes: readonly string[]): Promise<ReplayCheckpointsResult>;
}
