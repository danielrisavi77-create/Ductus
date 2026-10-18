import type { EvidencePayloadReader } from "@/application/ports/evidence-reconstruction";
import type { ProcessSummarySource } from "@/application/ports/process-summary-source";
import { isDocumentId } from "@/domain/collaboration";
import type { EvidenceChainFailureV2 } from "@/domain/forensics/evidence-chain-v2";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import {
  projectProcessSummary,
  type ProcessSummaryThresholds,
} from "@/domain/projection/process-summary";

/**
 * Reads the process summary of one document for whoever asks (B-13 step 2).
 *
 * The only request input is the document id. The viewer reaches this code
 * only through `source`, which the caller binds to the session; thresholds
 * come from server configuration. So the owner and the teacher of the same
 * stored state get the same bytes: the RFC 8785 JCS text of the summary,
 * which a route returns unchanged (D-80 point 6).
 *
 * Every failure is whole: a missing or unreadable segment, or a chain that
 * does not verify against the head, gives `unavailable` and never a partial
 * summary. `reason` is a fixed code for the server log, with no content and
 * nothing from an adapter; it is not part of what a viewer is shown.
 */

export type ProcessSummaryReaderDeps = {
  /** Already bound to the requesting actor; decides access and the cut. */
  source: ProcessSummarySource;
  payloads: EvidencePayloadReader;
  /** Faculty configuration (P-01, P-02), never a request field. */
  thresholds: ProcessSummaryThresholds;
};

export type ProcessSummaryUnavailableReason =
  | "source_unavailable"
  | "payload_missing"
  | "payload_unavailable"
  | EvidenceChainFailureV2;

export type ProcessSummaryReadResult =
  | { status: "ok"; body: string }
  | { status: "not_found" }
  | { status: "unavailable"; reason: ProcessSummaryUnavailableReason };

export async function readProcessSummary(
  deps: ProcessSummaryReaderDeps,
  documentId: string,
): Promise<ProcessSummaryReadResult> {
  // An id that cannot exist is answered like one that does not.
  if (!isDocumentId(documentId)) return { status: "not_found" };

  const source = await deps.source.readSource(documentId);
  if (source.status === "not_found") return { status: "not_found" };
  if (source.status !== "found") return { status: "unavailable", reason: "source_unavailable" };

  const payloads: Uint8Array[] = [];
  for (const segmentHash of source.segmentHashes) {
    const read = await deps.payloads.readImmutable({
      evidencePackageId: source.evidencePackageId,
      segmentHash,
    });
    if (read.status === "not_found") return { status: "unavailable", reason: "payload_missing" };
    if (read.status !== "found") return { status: "unavailable", reason: "payload_unavailable" };
    payloads.push(read.bytes);
  }

  // The chain is checked against the head inside the projection, so bytes a
  // store returned for the wrong hash cannot pass as the record.
  const result = await projectProcessSummary({
    payloads,
    head: source.head,
    thresholds: deps.thresholds,
  });
  if (!result.ok) return { status: "unavailable", reason: result.reason };
  return { status: "ok", body: canonicalizeJcs(result.summary) };
}
