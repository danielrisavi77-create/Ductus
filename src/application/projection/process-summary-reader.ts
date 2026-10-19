import {
  bindPayloadReader,
  type InstitutionEvidencePayloadReader,
} from "@/application/ports/evidence-reconstruction";
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
  /** Already bound to the requesting actor; decides access and lists the record. */
  source: ProcessSummarySource;
  /**
   * Storage of every institution; bound here to the institution the source
   * row names (B-13 step 4), so no request field can choose the domain.
   */
  payloads: InstitutionEvidencePayloadReader;
  /** Faculty configuration (P-01, P-02), never a request field. */
  thresholds: ProcessSummaryThresholds;
};

export type ProcessSummaryUnavailableReason =
  | "source_unavailable"
  | "payload_missing"
  | "payload_unavailable"
  | "projection_failed"
  | EvidenceChainFailureV2;

export type ProcessSummaryReadResult =
  | { status: "ok"; body: string }
  | { status: "not_found" }
  | { status: "unavailable"; reason: ProcessSummaryUnavailableReason };

const unavailable = (reason: ProcessSummaryUnavailableReason): ProcessSummaryReadResult => ({
  status: "unavailable",
  reason,
});

export async function readProcessSummary(
  deps: ProcessSummaryReaderDeps,
  documentId: string,
): Promise<ProcessSummaryReadResult> {
  // An id that cannot exist is answered like one that does not.
  if (!isDocumentId(documentId)) return { status: "not_found" };

  // An adapter that throws instead of answering is unavailable too: its
  // message never leaves here (QA #450, MANJE 1).
  let source;
  try {
    source = await deps.source.readSource(documentId);
  } catch {
    return unavailable("source_unavailable");
  }
  if (source.status === "not_found") return { status: "not_found" };
  if (source.status !== "found") return unavailable("source_unavailable");

  const storage = bindPayloadReader(deps.payloads, source.institutionId);
  const payloads: Uint8Array[] = [];
  for (const segmentHash of source.segmentHashes) {
    let read;
    try {
      read = await storage.readImmutable({
        evidencePackageId: source.evidencePackageId,
        segmentHash,
      });
    } catch {
      return unavailable("payload_unavailable");
    }
    if (read.status === "not_found") return unavailable("payload_missing");
    if (read.status !== "found") return unavailable("payload_unavailable");
    // Own copy: the bytes checked for the document are the bytes projected.
    payloads.push(new Uint8Array(read.bytes));
  }

  // The chain is checked against the head inside the projection, so bytes a
  // store returned for the wrong hash cannot pass as the record. Thresholds
  // the projection refuses are a configuration fault, answered as a closed
  // outcome rather than thrown (QA #450, MANJE 2).
  try {
    const result = await projectProcessSummary({
      payloads,
      head: source.head,
      thresholds: deps.thresholds,
    });
    if (!result.ok) return unavailable(result.reason);
    // The verified segments must be of the document asked for: a source
    // that bound another document's package cannot pass (review #450, MANJE 1).
    const decoder = new TextDecoder();
    for (const payload of payloads) {
      if ((JSON.parse(decoder.decode(payload)) as { documentId?: unknown }).documentId !== documentId) {
        return unavailable("document_mismatch");
      }
    }
    return { status: "ok", body: canonicalizeJcs(result.summary) };
  } catch {
    return unavailable("projection_failed");
  }
}
