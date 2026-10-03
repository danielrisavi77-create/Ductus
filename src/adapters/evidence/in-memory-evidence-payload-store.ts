import { canonicalizeJcs } from "@/domain/forensics/jcs";
import type {
  EvidencePayloadPutResult,
  EvidencePayloadStore,
} from "@/application/ports/evidence-trust";

type StoredPayload = {
  storageRef: string;
  canonicalPayload: string;
};

export class InMemoryEvidencePayloadStore implements EvidencePayloadStore {
  private readonly payloads = new Map<string, StoredPayload>();
  unavailableReason: string | null = null;

  async putImmutable(input: {
    evidencePackageId: string;
    segmentHash: string;
    canonicalPayload: string;
  }): Promise<EvidencePayloadPutResult> {
    if (this.unavailableReason) {
      return { status: "unavailable", reason: this.unavailableReason };
    }

    const key = canonicalizeJcs([
      input.evidencePackageId,
      input.segmentHash,
    ]);
    const existing = this.payloads.get(key);
    if (existing) {
      return existing.canonicalPayload === input.canonicalPayload
        ? { status: "existing", storageRef: existing.storageRef }
        : { status: "conflict" };
    }

    const storageRef =
      `memory://evidence/${encodeURIComponent(input.evidencePackageId)}/${input.segmentHash}`;
    this.payloads.set(key, {
      storageRef,
      canonicalPayload: input.canonicalPayload,
    });
    return { status: "stored", storageRef };
  }

  get(
    evidencePackageId: string,
    segmentHash: string,
  ): StoredPayload | null {
    const value = this.payloads.get(
      canonicalizeJcs([evidencePackageId, segmentHash]),
    );
    return value ? structuredClone(value) : null;
  }

  get size(): number {
    return this.payloads.size;
  }
}
