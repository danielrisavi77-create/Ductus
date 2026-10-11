import { isInstitutionId } from "@/application/ports/evidence-object-key";
import type {
  EvidencePayloadPutResult,
  EvidencePayloadStore,
} from "@/application/ports/evidence-trust";

import {
  EvidenceStorageConfigError,
  type EvidenceStorageConfig,
} from "./evidence-storage-config";
import {
  S3EvidencePayloadStore,
  type S3EvidencePayloadStoreConfig,
} from "./s3-evidence-payload-store";

/** What the router needs from one domain's store. */
export type DomainPayloadStore = EvidencePayloadStore & {
  verifyIdentity(expected: {
    institutionId: string;
  }): Promise<
    | { status: "verified" }
    | { status: "mismatch" }
    | { status: "unavailable"; reason: string }
  >;
};

type Domain = {
  label: string;
  institutionId: string;
  store: DomainPayloadStore;
  state: "unverified" | "verified" | "disabled";
  pending: Promise<Unavailable | null> | null;
};

type Unavailable = { status: "unavailable"; reason: string };

const MISMATCH: Unavailable = {
  status: "unavailable",
  reason: "storage_domain_identity_mismatch",
};

type Warn = (message: string, fields: Record<string, string>) => void;

/**
 * Routes each payload to the one storage domain of the institution the
 * server resolved for the package (BACKEND 4.1).
 *
 * - P2: an institution without a domain is `unavailable`; nothing falls back
 *   to a default or shared bucket.
 * - P3: no write reaches a domain before its bucket's identity label was
 *   read and matched. A failed read leaves the domain unverified and is
 *   tried again on the next write; a mismatch disables the domain until the
 *   process restarts.
 */
export class InstitutionRoutedPayloadStore implements EvidencePayloadStore {
  private readonly domains = new Map<string, Domain>();

  constructor(
    domains: readonly {
      label: string;
      institutionId: string;
      store: DomainPayloadStore;
    }[],
    private readonly warn: Warn = (message, fields) =>
      console.warn(message, fields),
  ) {
    for (const { label, institutionId, store } of domains) {
      if (this.domains.has(institutionId)) {
        throw new EvidenceStorageConfigError(
          `storage domain ${label}: institution already has a domain`,
        );
      }
      this.domains.set(institutionId, {
        label,
        institutionId,
        store,
        state: "unverified",
        pending: null,
      });
    }
  }

  /** One S3 store per configured domain; a bad value stops startup. */
  static fromConfig(
    config: EvidenceStorageConfig,
    options: Pick<S3EvidencePayloadStoreConfig, "fetch" | "now" | "warn"> = {},
  ): InstitutionRoutedPayloadStore {
    return new InstitutionRoutedPayloadStore(
      config.domains.map((domain) => {
        try {
          return {
            label: domain.label,
            institutionId: domain.institutionId,
            store: new S3EvidencePayloadStore({
              endpoint: domain.endpoint,
              region: domain.region,
              bucket: domain.bucket,
              storageDomain: domain.label,
              credentials: domain.credentials,
              requestTimeoutMs: config.requestTimeoutMs,
              ...options,
            }),
          };
        } catch (error) {
          // The adapter's messages carry no values (S12).
          throw new EvidenceStorageConfigError(
            `storage domain ${domain.label}: ${(error as Error).message}`,
          );
        }
      }),
      options.warn,
    );
  }

  /** Checks every domain once, e.g. at startup; returns state per label. */
  async verifyAll(): Promise<Record<string, Domain["state"]>> {
    const domains = [...this.domains.values()];
    await Promise.all(domains.map((domain) => this.verify(domain)));
    return Object.fromEntries(domains.map((d) => [d.label, d.state]));
  }

  async putImmutable(input: {
    institutionId: string;
    evidencePackageId: string;
    segmentHash: string;
    canonicalPayload: string;
  }): Promise<EvidencePayloadPutResult> {
    if (!isInstitutionId(input.institutionId)) return { status: "invalid" };
    const domain = this.domains.get(input.institutionId);
    if (domain === undefined) {
      return { status: "unavailable", reason: "storage_domain_not_configured" };
    }
    if (domain.state === "unverified") {
      const failed = await this.verify(domain);
      if (failed !== null) return failed;
    }
    if (domain.state === "disabled") return MISMATCH;
    return domain.store.putImmutable(input);
  }

  /** One identity read at a time per domain; null once it is verified. */
  private verify(domain: Domain): Promise<Unavailable | null> {
    if (domain.state !== "unverified") return Promise.resolve(null);
    domain.pending ??= this.readIdentity(domain).finally(() => {
      domain.pending = null;
    });
    return domain.pending;
  }

  private async readIdentity(domain: Domain): Promise<Unavailable | null> {
    let result: Awaited<ReturnType<DomainPayloadStore["verifyIdentity"]>>;
    try {
      result = await domain.store.verifyIdentity({
        institutionId: domain.institutionId,
      });
    } catch {
      return { status: "unavailable", reason: "storage_request_failed" };
    }
    if (result.status === "verified") {
      domain.state = "verified";
      return null;
    }
    if (result.status === "mismatch") {
      domain.state = "disabled";
      this.warn("evidence storage identity label does not match", {
        storageDomain: domain.label,
        institutionId: domain.institutionId,
      });
      return MISMATCH;
    }
    return result;
  }
}
