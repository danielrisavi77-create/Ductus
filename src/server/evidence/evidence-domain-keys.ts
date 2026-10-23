import { isEvidenceDomainId } from "@/domain/forensics/evidence-receipt";
import type { EvidenceDomainKey } from "@/domain/forensics/evidence-receipt-verifier";
import type { ActorTransaction } from "@/server/db/with-actor";

export type EvidenceDomainKeysResult =
  | { status: "ok"; keys: EvidenceDomainKey[] }
  | { status: "unavailable"; reason: "domain_keys_malformed" };

type KeyRow = {
  key_id: unknown;
  key_version: unknown;
  evidence_domain_id: unknown;
  purpose: unknown;
  algorithm: unknown;
  key_base64url: unknown;
  valid_from: unknown;
  valid_to: unknown;
  revoked_at: unknown;
};

// The text form of `acceptedAt` and of the verifier's key entries: ISO 8601 in
// UTC with milliseconds, formatted by the database, never by a client clock
// or a driver's time zone.
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const iso = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', ${ISO})`;
const KEYS_SQL = `
SELECT key_id, key_version, evidence_domain_id::text, purpose, algorithm, key_base64url,
       ${iso("valid_from")} AS valid_from, ${iso("valid_to")} AS valid_to, ${iso("revoked_at")} AS revoked_at
  FROM evidence.signing_key
 WHERE evidence_domain_id = $1::uuid
 ORDER BY valid_from, key_id`;

const text = (value: unknown): value is string => typeof value === "string" && value !== "";

/**
 * The public keys of one evidence domain from the registry (BACKEND 4.13
 * t. 7), as the receipt v2 verifier takes them. Read under the caller's
 * withActor transaction, so RLS shows only the session's institution: a
 * domain of another institution, or no session, gives an empty list and the
 * verifier then answers `key_unknown`. Every key is returned, retired and
 * revoked ones too, because the verifier decides by them. A row of an
 * unexpected form makes the whole list unavailable; nothing is skipped.
 */
export async function readEvidenceDomainKeys(
  tx: ActorTransaction,
  evidenceDomainId: string,
): Promise<EvidenceDomainKeysResult> {
  // The id comes from the server's own package row; another form is a fault.
  if (!isEvidenceDomainId(evidenceDomainId)) {
    return { status: "unavailable", reason: "domain_keys_malformed" };
  }
  const { rows } = await tx.query<KeyRow>(KEYS_SQL, [evidenceDomainId]);
  const keys: EvidenceDomainKey[] = [];
  for (const row of rows) {
    if (
      !text(row.key_id) ||
      !text(row.key_version) ||
      row.evidence_domain_id !== evidenceDomainId ||
      (row.purpose !== "receipt" && row.purpose !== "checkpoint") ||
      row.algorithm !== "Ed25519" ||
      !text(row.key_base64url) ||
      !text(row.valid_from) ||
      (row.valid_to !== null && !text(row.valid_to)) ||
      (row.revoked_at !== null && !text(row.revoked_at))
    ) {
      return { status: "unavailable", reason: "domain_keys_malformed" };
    }
    keys.push({
      algorithm: "Ed25519",
      keyId: row.key_id,
      keyVersion: row.key_version,
      encoding: "spki-der",
      keyBase64Url: row.key_base64url,
      evidenceDomainId: row.evidence_domain_id,
      purpose: row.purpose,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      revokedAt: row.revoked_at,
    });
  }
  return { status: "ok", keys };
}
