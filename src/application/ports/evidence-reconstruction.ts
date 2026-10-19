import type { EvidenceChainHeadV2 } from "@/domain/forensics/evidence-chain-v2";
import type { SignedEvidenceReceipt } from "@/domain/forensics/evidence-receipt";

/**
 * Read side of the evidence store, used to reconstruct a document from what
 * was accepted. It is a server-side capability (the worker in production):
 * neither port takes a principal, and neither may be exposed to a client.
 */

export type AcceptedEvidenceSegment<TReceipt = SignedEvidenceReceipt> = {
  /** Hash the segment was accepted under; the address of its stored bytes. */
  segmentHash: string;
  /**
   * The stored receipt, in the form the reconstruction's receipt check takes
   * (v1 by default); nothing in it is trusted before that check. `null` while
   * the acceptance is still `pending_signature`.
   */
  receipt: TReceipt | null;
};

export type EvidenceChainReadResult<TReceipt = SignedEvidenceReceipt> =
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
      segments: AcceptedEvidenceSegment<TReceipt>[];
    }
  | { status: "unavailable"; reason: string };

export interface EvidenceChainReader<TReceipt = SignedEvidenceReceipt> {
  readChain(evidencePackageId: string): Promise<EvidenceChainReadResult<TReceipt>>;
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

/**
 * The storage side of the read (BACKEND 4.1, B2): an object lives in the
 * storage domain of one institution under `v2/<institution>/<package>/<hash>.json`,
 * so the reader needs the institution to find the bucket and the key.
 *
 * - `found` only for bytes whose SHA-256 is `segmentHash`: the object is
 *   content-addressed, so other bytes under the key are not the segment.
 * - `not_found` only when the institution's own storage says there is no
 *   object under that key. A package of another institution is never there:
 *   its objects sit in another domain under another prefix.
 * - Everything else is `unavailable` and a retry may succeed: no domain or an
 *   unverified one, a timeout, a refused or failed request, an id that cannot
 *   form a key, and an object whose bytes do not hash to the key (logged as an
 *   incident with ids only). None of these says anything about the record.
 * - One request per call, no retry inside; the caller retries.
 */
export interface InstitutionEvidencePayloadReader {
  readImmutable(input: {
    institutionId: string;
    evidencePackageId: string;
    segmentHash: string;
  }): Promise<EvidencePayloadReadResult>;
}

/**
 * Binds the institution the server resolved for the record (a row read under
 * `withActor`, never a request field) to a storage reader, giving the reader
 * that reconstruction and the process summary take.
 */
export function bindPayloadReader(
  reader: InstitutionEvidencePayloadReader,
  institutionId: string,
): EvidencePayloadReader {
  return {
    readImmutable: ({ evidencePackageId, segmentHash }) =>
      reader.readImmutable({ institutionId, evidencePackageId, segmentHash }),
  };
}
