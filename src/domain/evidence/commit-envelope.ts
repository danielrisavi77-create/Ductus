import { MAX_DOCUMENT_SNAPSHOT_BYTES } from "../document/snapshot";
import { MAX_EVIDENCE_SEGMENT_BYTES } from "../forensics/evidence-chain-v2";

/**
 * The envelope of `POST /api/evidence/commit` (docs/BACKEND.md 4.13 t. 1 and
 * 2), shared by the client and the route so neither keeps its own number.
 */

/** The value of the `Ductus-Protocol` header; any other value is 426. */
export const DUCTUS_PROTOCOL_VERSION = "1";

/** Room for the keys, the document id, the idempotency key and the revision. */
export const COMMIT_ENVELOPE_OVERHEAD_BYTES = 4 * 1024;

/** Length of standard base64 with padding for `bytes` bytes. */
export function base64Length(bytes: number): number {
  return 4 * Math.ceil(bytes / 3);
}

/** One segment at D-96 and one snapshot at its limit, both in base64, plus the envelope. */
export const MAX_COMMIT_REQUEST_BYTES =
  base64Length(MAX_EVIDENCE_SEGMENT_BYTES) +
  base64Length(MAX_DOCUMENT_SNAPSHOT_BYTES) +
  COMMIT_ENVELOPE_OVERHEAD_BYTES;
