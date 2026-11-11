import { isEvidencePackageId, isSha256Hex } from "@/application/ports/evidence-ingest";
import type { EvidenceCheckpointReader, EvidenceCheckpointReadResult } from "@/application/ports/evidence-reconstruction";
import { isEvidenceDomainId } from "@/domain/forensics/evidence-receipt";

/**
 * One statement on the worker's connection (ductus_worker). The adapter needs
 * nothing else: no pool, no session, no principal.
 */
export type WorkerCheckpointQuery = (text: string, values: readonly unknown[]) => Promise<{ rows: readonly unknown[] }>;

/** The most hashes one read may ask for; `app.worker_package_checkpoints` refuses more. */
export const CHECKPOINT_HASHES_MAX = 512;
/** The table's own limit on a checkpoint body, in UTF-8 bytes. */
export const CHECKPOINT_BODY_MAX_BYTES = 2_097_152;

const READ_SQL =
  "SELECT content_hash, body FROM app.worker_package_checkpoints($1::uuid, $2, $3::text[])";

const unavailable = (reason: "invalid_checkpoint_request" | "invalid_checkpoint_row" | "checkpoints_failed") =>
  ({ status: "unavailable", reason }) as const;

/** Sorted, without repeats, lower-case SHA-256 hex, 1 to CHECKPOINT_HASHES_MAX: the port's contract. */
function isHashList(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > CHECKPOINT_HASHES_MAX) return false;
  return value.every((hash, at) => isSha256Hex(hash) && (at === 0 || value[at - 1] < hash));
}

/**
 * The checkpoints of a reconstruction (B-12, D-191 t. 4; DAN-293, M3.3-P03),
 * read for one evidence package of the worker's own evidence domain through
 * `app.worker_package_checkpoints`. The domain is the worker's configuration,
 * never a request field; the database resolves the package's document and
 * institution, so a package of another domain gives no checkpoint at all.
 *
 * Nothing returned is trusted: the reconstruction hashes every body before it
 * uses one. The adapter only refuses an answer it cannot take whole, so a row
 * it was not asked for, a repeated hash or a malformed row makes the whole
 * read unavailable, never a partial map. Every fault has a closed reason and
 * no driver text, which can carry an id or a body.
 */
export function createWorkerCheckpointReader(options: {
  query: WorkerCheckpointQuery;
  evidenceDomainId: string;
}): EvidenceCheckpointReader {
  const { query, evidenceDomainId } = options;
  return {
    async readCheckpoints({ evidencePackageId, documentHashes }): Promise<EvidenceCheckpointReadResult> {
      if (!isEvidenceDomainId(evidenceDomainId) || !isEvidencePackageId(evidencePackageId) || !isHashList(documentHashes)) {
        return unavailable("invalid_checkpoint_request");
      }
      let rows: unknown;
      try {
        rows = (await query(READ_SQL, [evidenceDomainId, evidencePackageId, [...documentHashes]]))?.rows;
      } catch {
        return unavailable("checkpoints_failed");
      }
      if (!Array.isArray(rows)) return unavailable("invalid_checkpoint_row");
      const asked = new Set(documentHashes);
      const encoder = new TextEncoder();
      const checkpoints = new Map<string, Uint8Array>();
      for (const row of rows) {
        if (typeof row !== "object" || row === null || Object.keys(row).length !== 2) {
          return unavailable("invalid_checkpoint_row");
        }
        const { content_hash: hash, body } = row as Record<string, unknown>;
        if (typeof hash !== "string" || !asked.has(hash) || checkpoints.has(hash)) return unavailable("invalid_checkpoint_row");
        if (typeof body !== "string" || body.length === 0 || body.length > CHECKPOINT_BODY_MAX_BYTES) {
          return unavailable("invalid_checkpoint_row");
        }
        const bytes = encoder.encode(body);
        if (bytes.byteLength > CHECKPOINT_BODY_MAX_BYTES) return unavailable("invalid_checkpoint_row");
        checkpoints.set(hash, bytes);
      }
      return { status: "found", checkpoints };
    },
  };
}
