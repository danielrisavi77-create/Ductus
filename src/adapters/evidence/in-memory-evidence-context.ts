import type {
  EvidenceContextPort,
  EvidenceContextResolution,
  EvidencePackageContext,
} from "@/application/ports/evidence-trust";

export class InMemoryEvidenceContextPort implements EvidenceContextPort {
  private readonly contexts = new Map<string, EvidencePackageContext>();
  unavailableReason: string | null = null;

  constructor(contexts: readonly EvidencePackageContext[] = []) {
    for (const context of contexts) {
      this.contexts.set(context.evidencePackageId, structuredClone(context));
    }
  }

  set(context: EvidencePackageContext): void {
    this.contexts.set(context.evidencePackageId, structuredClone(context));
  }

  async resolve(evidencePackageId: string): Promise<EvidenceContextResolution> {
    if (this.unavailableReason) {
      return { status: "unavailable", reason: this.unavailableReason };
    }
    const context = this.contexts.get(evidencePackageId);
    return context
      ? { status: "found", context: structuredClone(context) }
      : { status: "not_found" };
  }
}
