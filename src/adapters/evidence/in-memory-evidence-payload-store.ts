import { createHash } from "node:crypto";

import { canonicalizeJcs } from "@/domain/forensics/jcs";
import {
  evidenceObjectKey,
  evidenceStorageRef,
} from "@/application/ports/evidence-object-key";
import type {
  EvidencePayloadReadResult,
  EvidencePayloadReader,
  InstitutionEvidencePayloadReader,
} from "@/application/ports/evidence-reconstruction";
import type {
  EvidencePayloadLocator,
  EvidencePayloadPutResult,
  EvidencePayloadStore,
  EvidenceStorageRefResult,
} from "@/application/ports/evidence-trust";
import type {
  EvidencePayloadPresence,
  EvidencePayloadPresenceResult,
} from "@/application/ports/pending-receipt-object";

type StoredPayload = {
  storageRef: string;
  canonicalPayload: string;
};

export class InMemoryEvidencePayloadStore
  implements
    EvidencePayloadStore,
    EvidencePayloadLocator,
    EvidencePayloadPresence,
    EvidencePayloadReader,
    InstitutionEvidencePayloadReader
{
  private readonly payloads = new Map<string, StoredPayload>();
  // A package row belongs to one institution, as the composite key in the
  // database enforces; the reader finds the institution through it.
  private readonly packageInstitutions = new Map<string, string>();
  unavailableReason: string | null = null;

  async putImmutable(input: {
    institutionId: string;
    evidencePackageId: string;
    segmentHash: string;
    canonicalPayload: string;
  }): Promise<EvidencePayloadPutResult> {
    if (this.unavailableReason) {
      return { status: "unavailable", reason: this.unavailableReason };
    }

    const path = evidenceObjectKey(input);
    const owner = this.packageInstitutions.get(input.evidencePackageId);
    if (!path || (owner !== undefined && owner !== input.institutionId)) {
      return { status: "invalid" };
    }
    const key = canonicalizeJcs([...path]);
    const existing = this.payloads.get(key);
    if (existing) {
      return existing.canonicalPayload === input.canonicalPayload
        ? { status: "existing", storageRef: existing.storageRef }
        : { status: "conflict" };
    }

    const storageRef = evidenceStorageRef("memory", path);
    this.packageInstitutions.set(input.evidencePackageId, input.institutionId);
    this.payloads.set(key, {
      storageRef,
      canonicalPayload: input.canonicalPayload,
    });
    return { status: "stored", storageRef };
  }

  /** The reference putImmutable gives for this key, without storing anything. */
  async storageRefFor(input: {
    institutionId: string;
    evidencePackageId: string;
    segmentHash: string;
  }): Promise<EvidenceStorageRefResult> {
    if (this.unavailableReason) {
      return { status: "unavailable", reason: this.unavailableReason };
    }
    const path = evidenceObjectKey(input);
    return path
      ? { status: "ok", storageRef: evidenceStorageRef("memory", path) }
      : { status: "unavailable", reason: "storage_ref_invalid" };
  }

  /**
   * With `institutionId` (the storage reader of B2), a package of another
   * institution is `not_found`, as its object is under another prefix.
   */
  async readImmutable(input: {
    institutionId?: string;
    evidencePackageId: string;
    segmentHash: string;
  }): Promise<EvidencePayloadReadResult> {
    if (this.unavailableReason) {
      return { status: "unavailable", reason: this.unavailableReason };
    }
    if (
      input.institutionId !== undefined &&
      this.packageInstitutions.get(input.evidencePackageId) !== input.institutionId
    ) {
      return { status: "not_found" };
    }
    const stored = this.find(input.evidencePackageId, input.segmentHash);
    return stored
      ? {
          status: "found",
          bytes: new TextEncoder().encode(stored.canonicalPayload),
        }
      : { status: "not_found" };
  }

  /**
   * The HEAD of the S3 store: `present` only for this exact key with the
   * byte count and the SHA-256 of the hash; an invalid key is `unavailable`.
   */
  async headImmutable(input: {
    institutionId: string;
    evidencePackageId: string;
    segmentHash: string;
    payloadBytes: number;
  }): Promise<EvidencePayloadPresenceResult> {
    if (this.unavailableReason) {
      return { status: "unavailable", reason: this.unavailableReason };
    }
    const path = evidenceObjectKey(input);
    if (!path) return { status: "unavailable", reason: "storage_request_invalid" };
    const stored = this.payloads.get(canonicalizeJcs([...path]));
    if (!stored) return { status: "absent" };
    const bytes = new TextEncoder().encode(stored.canonicalPayload);
    return bytes.byteLength === input.payloadBytes &&
      createHash("sha256").update(bytes).digest("hex") === input.segmentHash
      ? { status: "present" }
      : { status: "mismatch" };
  }

  get(
    evidencePackageId: string,
    segmentHash: string,
  ): StoredPayload | null {
    const value = this.find(evidencePackageId, segmentHash);
    return value ? structuredClone(value) : null;
  }

  private find(
    evidencePackageId: string,
    segmentHash: string,
  ): StoredPayload | undefined {
    const path = evidenceObjectKey({
      institutionId: this.packageInstitutions.get(evidencePackageId),
      evidencePackageId,
      segmentHash,
    });
    return path ? this.payloads.get(canonicalizeJcs([...path])) : undefined;
  }

  get size(): number {
    return this.payloads.size;
  }
}
