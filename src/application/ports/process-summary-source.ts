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
 * - **The cut is the adapter's.** Which part of the record a viewer may see
 *   while the work is still being written (P-03, BACKEND 4.10 point 7) and
 *   whether a short assignment shows nothing before submission (D-37) are
 *   decided here, with the head and segment list cut to that state. The cut
 *   is the same for the owner and the teacher.
 */
export type ProcessSummarySourceResult =
  | {
      status: "found";
      evidencePackageId: string;
      /** Head of the record as cut for the summary; `null` when empty. */
      head: EvidenceChainHeadV2 | null;
      /** Segment hashes in chain order up to `head`, first accepted first. */
      segmentHashes: string[];
    }
  | { status: "not_found" }
  | { status: "unavailable"; reason: string };

export interface ProcessSummarySource {
  readSource(documentId: string): Promise<ProcessSummarySourceResult>;
}
