/**
 * Idempotent review confirmation of an import (DAN-436, contract
 * docs/contracts/import-v1.md §5; attack plan #1911 P1 to P9).
 *
 * A pure decision over the stored pending import and the request. It writes
 * nothing: the M8.2 RPC takes the row lock, calls this and then either
 * appends the one `import` segment event or returns the stored event id.
 * A repeated confirmation of the same manifest never makes a second event.
 */
import { IMPORT_PENDING_LIFETIME_MS } from "./limits";

export type ImportRecordStateV1 = "pending" | "confirmed" | "cancelled";

/** What the server stored when it prepared the import (M8.2 `import_event`). */
export type ImportRecordV1 = Readonly<{
  importId: string;
  ownerId: string;
  documentId: string;
  manifestSha256: string;
  /** Document revision the import was prepared against. */
  baseRevision: number;
  preparedAtMs: number;
  state: ImportRecordStateV1;
  /** Event id of the confirmation, present only in state `confirmed`. */
  confirmedEventId?: string;
}>;

export type ImportConfirmRequestV1 = Readonly<{
  importId: string;
  actorId: string;
  documentId: string;
  /** The manifest hash the student reviewed. */
  manifestSha256: string;
}>;

export type ImportConfirmContextV1 = Readonly<{
  nowMs: number;
  currentRevision: number;
  /** False when the document no longer takes imports (submitted, locked, archived). */
  importAllowed: boolean;
}>;

/** Codes only: a rejection never carries input content (D-198 t. 5). */
export type ImportConfirmRejectCode =
  | "NOT_FOUND"
  | "MANIFEST_MISMATCH"
  | "CANCELLED"
  | "EXPIRED"
  | "IMPORT_NOT_ALLOWED"
  | "REVISION_CHANGED";

export type ImportConfirmDecisionV1 =
  | { kind: "confirm" }
  | { kind: "already-confirmed"; eventId: string }
  | { kind: "reject"; code: ImportConfirmRejectCode };

const reject = (code: ImportConfirmRejectCode): ImportConfirmDecisionV1 => ({ kind: "reject", code });

/** The stored and the reviewed hash: SHA-256 in lowercase hex (§2). */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Decides one confirmation. The order is fixed: a stranger learns nothing
 * beyond `NOT_FOUND` (another owner and another document look like a missing
 * import), and a finished import answers before any time or revision check,
 * so a retry after success is always `already-confirmed`.
 */
export function decideImportConfirmation(
  record: ImportRecordV1 | null,
  request: ImportConfirmRequestV1,
  context: ImportConfirmContextV1,
): ImportConfirmDecisionV1 {
  if (
    record === null ||
    record.importId === "" || record.ownerId === "" || record.documentId === "" ||
    record.importId !== request.importId ||
    record.ownerId !== request.actorId ||
    record.documentId !== request.documentId
  ) return reject("NOT_FOUND");
  // A record without a valid stored hash is inconsistent and is never confirmed.
  if (!SHA256_HEX.test(record.manifestSha256)) return reject("NOT_FOUND");

  // A malformed reviewed hash can never equal the valid stored one.
  const sameManifest = record.manifestSha256 === request.manifestSha256;
  if (record.state === "confirmed") {
    if (!sameManifest) return reject("MANIFEST_MISMATCH");
    if (typeof record.confirmedEventId !== "string" || record.confirmedEventId === "") return reject("NOT_FOUND");
    return { kind: "already-confirmed", eventId: record.confirmedEventId };
  }
  if (record.state === "cancelled") return reject("CANCELLED");
  if (record.state !== "pending") return reject("NOT_FOUND");

  if (!sameManifest) return reject("MANIFEST_MISMATCH");
  if (!Number.isFinite(context.nowMs) || !Number.isFinite(record.preparedAtMs)) return reject("EXPIRED");
  if (context.nowMs >= record.preparedAtMs + IMPORT_PENDING_LIFETIME_MS) return reject("EXPIRED");
  if (!context.importAllowed) return reject("IMPORT_NOT_ALLOWED");
  if (context.currentRevision !== record.baseRevision) return reject("REVISION_CHANGED");
  return { kind: "confirm" };
}
