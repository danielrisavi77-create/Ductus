import type { EvidenceChainHeadV2 } from "@/domain/forensics/evidence-chain-v2";

/**
 * Which stored record the process summary of a document is built from
 * (B-13, PRODUCT §7, rule 5 of §5, D-80 point 6).
 *
 * The adapter is bound to the requesting actor before the reader sees it (in
 * production a read RPC run inside `withActor`, identity and institution from
 * the session, never from a parameter). It is the only place that knows who
 * asks, and it owes three things:
 *
 * - **One record for every viewer.** Every actor who may read the summary of
 *   a document gets the same `found` answer for the same stored state: the
 *   same package, head and segment list. Nothing in it depends on the viewer.
 * - **Refusal looks like absence.** A document the actor may not read, one of
 *   another institution and one that does not exist all give `not_found`, so
 *   the answer cannot be used to probe which ids exist (BACKEND §6 point 7).
 * - **The whole record, no cut.** Owner decision 19. 10. 2026. (#87
 *   6256655038, point 3; BACKEND 4.10 point 7): after D-142 the summary has
 *   no P-03 cut, so the head and segment list are the package's own, every
 *   accepted segment included. A listing that does not end at the stored head
 *   is `unavailable`. D-144 replaced D-37: a short assignment has no answer
 *   of its own.
 */
export type ProcessSummarySourceResult =
  | {
      status: "found";
      evidencePackageId: string;
      /** Head of the record; `null` when empty. */
      head: EvidenceChainHeadV2 | null;
      /** Segment hashes in chain order up to `head`, first accepted first. */
      segmentHashes: string[];
    }
  | { status: "not_found" }
  | { status: "unavailable"; reason: string };

export interface ProcessSummarySource {
  readSource(documentId: string): Promise<ProcessSummarySourceResult>;
}
