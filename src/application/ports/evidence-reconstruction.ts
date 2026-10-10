import type { EvidenceChainHeadV2 } from "@/domain/forensics/evidence-chain-v2";
import type { SignedEvidenceReceipt } from "@/domain/forensics/evidence-receipt";

/**
 * Read side of the evidence store, used to reconstruct a document from what
 * was accepted. It is a server-side capability (the worker in production):
 * neither port takes a principal, and neither may be exposed to a client.
 */

export type AcceptedEvidenceSegment = {
  /** Hash the segment was accepted under; the address of its stored bytes. */
  segmentHash: string;
  /** `null` while the acceptance is still `pending_signature`. */
  receipt: SignedEvidenceReceipt | null;
};

export type EvidenceChainReadResult =
  | {
      status: "found";
      /**
       * Head recorded by `reserve`; `null` when nothing was accepted. A
       * package the store has never seen reads the same as an empty one:
       * `null` head and no segments. Reconstruction reports both as
       * `no_evidence`, never as a match.
       *
       * The head and the listing must come from one snapshot, the head from
       * where `reserve` wrote it. Reconstruction checks the listing against
       * this head and nothing else: a listing cut short together with a head
       * moved back to its new last segment reads as a whole, shorter record.
       */
      head: EvidenceChainHeadV2 | null;
      /** Accepted segments in chain order, first accepted first. */
      segments: AcceptedEvidenceSegment[];
    }
  | { status: "unavailable"; reason: string };

export interface EvidenceChainReader {
  readChain(evidencePackageId: string): Promise<EvidenceChainReadResult>;
}

export type EvidencePayloadReadResult =
  | { status: "found"; bytes: Uint8Array }
  | { status: "not_found" }
  | { status: "unavailable"; reason: string };

export interface EvidencePayloadReader {
  /**
   * Returns the stored bytes exactly as they are, undecoded: the caller
   * verifies them, so an adapter must not parse, repair or re-serialize.
   */
  readImmutable(input: {
    evidencePackageId: string;
    segmentHash: string;
  }): Promise<EvidencePayloadReadResult>;
}
