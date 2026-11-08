/**
 * The segment object a pending receipt names, as `app.worker_receipt_object`
 * returns it (DAN-301, plan #1690). Only what a HEAD to the payload store
 * needs: the object key, the byte count and the stored reference.
 */
export type PendingReceiptObject = {
  institutionId: string;
  evidencePackageId: string;
  segmentHash: string;
  payloadBytes: number;
  storageRef: string;
};

/**
 * `not_found` is every case the database answers with no row: a signed
 * receipt, a receipt of another domain or schema, or an unknown id.
 */
export type PendingReceiptObjectRead =
  | { status: "ok"; object: PendingReceiptObject }
  | { status: "not_found" }
  | { status: "unavailable"; reason: string };

/** The worker's read of the locator (D-71, D-102); the web process has none. */
export interface PendingReceiptObjectSource {
  receiptObject(
    evidenceDomainId: string,
    receiptId: string,
  ): Promise<PendingReceiptObjectRead>;
}

/**
 * What one HEAD proves. `present` only when the store answers for exactly
 * this key with exactly `payloadBytes` bytes and the SHA-256 checksum of
 * `segmentHash`; `absent` only when it says the object is not there;
 * `mismatch` when it holds another length or checksum under the key. Every
 * other answer, a store that gives no checksum included, is `unavailable`.
 */
export type EvidencePayloadPresenceResult =
  | { status: "present" }
  | { status: "absent" }
  | { status: "mismatch" }
  | { status: "unavailable"; reason: string };

export interface EvidencePayloadPresence {
  headImmutable(input: {
    institutionId: string;
    evidencePackageId: string;
    segmentHash: string;
    payloadBytes: number;
  }): Promise<EvidencePayloadPresenceResult>;
}
