import {
  evidenceObjectKey,
  evidenceStorageRef,
  isInstitutionId,
} from "@/application/ports/evidence-object-key";
import type {
  EvidencePayloadReadResult,
  InstitutionEvidencePayloadReader,
} from "@/application/ports/evidence-reconstruction";
import type {
  EvidencePayloadLocator,
  EvidencePayloadPutResult,
  EvidencePayloadStore,
  EvidenceStorageRefResult,
} from "@/application/ports/evidence-trust";

import {
  EvidenceStorageConfigError,
  type EvidenceStorageConfig,
} from "./evidence-storage-config";
import {
  S3EvidencePayloadStore,
  type S3EvidencePayloadStoreConfig,
  type StorageIdentityResult,
} from "./s3-evidence-payload-store";
import { sha256Hex } from "./s3-signature";

/** What the router needs from one domain's store. */
export type DomainPayloadStore = EvidencePayloadStore &
  InstitutionEvidencePayloadReader & {
    verifyIdentity(expected: { institutionId: string }): Promise<StorageIdentityResult>;
  };

type Domain = {
  label: string;
  institutionId: string;
  store: DomainPayloadStore;
  state: "unverified" | "verified" | "disabled";
  pending: Promise<Unavailable | null> | null;
};

type Unavailable = { status: "unavailable"; reason: string };

/**
 * The one reason that leaves the router. Which domain is missing, refused
 * its label or failed, and how, is for the operator log only: the caller's
 * answer may reach the client.
 */
export const STORAGE_UNAVAILABLE = "storage_unavailable";
const UNAVAILABLE: Unavailable = Object.freeze({
  status: "unavailable",
  reason: STORAGE_UNAVAILABLE,
});

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
 * Reads (`readImmutable`) pass the same two gates.
 */
export class InstitutionRoutedPayloadStore
  implements EvidencePayloadStore, EvidencePayloadLocator, InstitutionEvidencePayloadReader
{
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
    options: Pick<
      S3EvidencePayloadStoreConfig,
      "fetch" | "now" | "warn" | "allowPlainHttpOnLoopback"
    > = {},
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
              capability: domain.capability,
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

  async putImmutable(given: {
    institutionId: string;
    evidencePackageId: string;
    segmentHash: string;
    canonicalPayload: string;
  }): Promise<EvidencePayloadPutResult> {
    // Each field is read exactly once, here, like the adapter reads its
    // input: the check, the choice of domain and the write all use these
    // values, so a getter or a caller that changes its object during the
    // call cannot send one institution's key to another's bucket.
    let input: {
      institutionId: string;
      evidencePackageId: string;
      segmentHash: string;
      canonicalPayload: string;
    };
    try {
      input = {
        institutionId: given.institutionId,
        evidencePackageId: given.evidencePackageId,
        segmentHash: given.segmentHash,
        canonicalPayload: given.canonicalPayload,
      };
    } catch {
      this.log("evidence storage request could not be read", {
        reason: "storage_request_failed",
      });
      return UNAVAILABLE;
    }
    if (!isInstitutionId(input.institutionId)) return { status: "invalid" };
    const domain = await this.ready(input.institutionId);
    if (domain === null) return UNAVAILABLE;
    let stored: unknown;
    try {
      stored = await domain.store.putImmutable(input);
    } catch {
      stored = { status: "unavailable", reason: "storage_request_failed" };
    }
    // Snapshot and validate once. A domain can return an object with getters,
    // so property access must remain inside the normalization boundary.
    const result: EvidencePayloadPutResult = normalizePutResult(stored) ?? {
      status: "unavailable",
      reason: "storage_request_failed",
    };
    if (result.status !== "unavailable") return result;
    this.log("evidence storage domain is unavailable", {
      storageDomain: domain.label,
      reason: result.reason,
    });
    return UNAVAILABLE;
  }

  /**
   * Reads from the one domain of the institution, under the same P2 and P3
   * gates as a write: no domain, an unverified label or a disabled domain is
   * `unavailable`, and no other domain is ever asked. The bytes are checked
   * against the hash again here, so no domain store can pass on other bytes.
   */
  async readImmutable(given: {
    institutionId: string;
    evidencePackageId: string;
    segmentHash: string;
  }): Promise<EvidencePayloadReadResult> {
    let input: { institutionId: string; evidencePackageId: string; segmentHash: string };
    try {
      input = {
        institutionId: given.institutionId,
        evidencePackageId: given.evidencePackageId,
        segmentHash: given.segmentHash,
      };
    } catch {
      this.log("evidence storage request could not be read", {
        reason: "storage_request_failed",
      });
      return UNAVAILABLE;
    }
    if (!isInstitutionId(input.institutionId)) {
      this.log("evidence storage request is not valid", {
        reason: "storage_request_invalid",
      });
      return UNAVAILABLE;
    }
    const domain = await this.ready(input.institutionId);
    if (domain === null) return UNAVAILABLE;
    let read: unknown;
    try {
      read = await domain.store.readImmutable(input);
    } catch {
      read = null;
    }
    const result = normalizeReadResult(read, input.segmentHash) ?? {
      status: "unavailable",
      reason: "storage_request_failed",
    };
    if (result.status !== "unavailable") return result;
    this.log("evidence storage domain is unavailable", {
      storageDomain: domain.label,
      reason: result.reason,
    });
    return UNAVAILABLE;
  }

  /**
   * The reference of an object already stored under this key, with no request
   * to any store. Only the institution's own domain names it; no domain, or
   * one disabled by a mismatched identity label, is `unavailable` (P2, P3).
   * A domain whose label is not verified yet (just after a restart) names it
   * from the configured label: nothing is read or written here, and a label
   * that differs from the one stored with the receipt ends the retry in the
   * closed `txid_reused`, never in a write to another store.
   */
  async storageRefFor(given: {
    institutionId: string;
    evidencePackageId: string;
    segmentHash: string;
  }): Promise<EvidenceStorageRefResult> {
    // Read once, as in putImmutable: the key and the domain use the same values.
    const { institutionId, evidencePackageId, segmentHash } = given;
    const key = evidenceObjectKey({ institutionId, evidencePackageId, segmentHash });
    const domain = key === null ? undefined : this.domains.get(institutionId);
    if (key === null || domain === undefined || domain.state === "disabled") {
      this.log("evidence storage reference is unavailable", { reason: "storage_ref_unavailable" });
      return UNAVAILABLE;
    }
    return { status: "ok", storageRef: evidenceStorageRef(domain.label, key) };
  }

  /**
   * The domain of the institution once its label is verified, or null: none
   * configured (P2, logged), the label not read yet or not matching (P3).
   */
  private async ready(institutionId: string): Promise<Domain | null> {
    const domain = this.domains.get(institutionId);
    if (domain === undefined) {
      this.log("evidence storage domain is not configured", {
        institutionId,
        reason: "storage_domain_not_configured",
      });
      return null;
    }
    if (domain.state === "unverified") {
      const failed = await this.verify(domain);
      if (failed !== null) return null;
    }
    return domain.state === "disabled" ? null : domain;
  }

  /**
   * Written in a later macrotask, like the adapter's log: a logger that
   * throws, blocks or rejects can neither delay nor change the outcome.
   */
  private log(message: string, fields: Record<string, string>): void {
    setImmediate(() => {
      try {
        const result: unknown = this.warn(message, fields);
        void Promise.resolve(result).catch(() => undefined);
      } catch {
        // Dropped on purpose.
      }
    });
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
    let raw: unknown;
    try {
      raw = await domain.store.verifyIdentity({
        institutionId: domain.institutionId,
      });
    } catch {
      raw = null;
    }
    const result = normalizeIdentityResult(raw) ?? {
      status: "unavailable" as const,
      reason: "storage_request_failed",
    };
    if (result.status === "verified") {
      domain.state = "verified";
      return null;
    }
    if (result.status === "mismatch") {
      domain.state = "disabled";
      this.log("evidence storage identity label does not match", {
        storageDomain: domain.label,
        institutionId: domain.institutionId,
        reason: "storage_domain_identity_mismatch",
      });
      return UNAVAILABLE;
    }
    this.log("evidence storage identity label could not be read", {
      storageDomain: domain.label,
      reason: result.reason,
    });
    return UNAVAILABLE;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePutResult(value: unknown): EvidencePayloadPutResult | null {
  try {
    if (!isObject(value)) return null;
    const status = value.status;
    switch (status) {
      case "stored":
      case "existing": {
        const storageRef = value.storageRef;
        return typeof storageRef === "string" && storageRef !== ""
          ? { status, storageRef }
          : null;
      }
      case "conflict":
      case "invalid":
        return { status };
      case "unavailable": {
        const reason = value.reason;
        return typeof reason === "string" ? { status, reason } : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * A copy of the domain's answer, read once. `found` holds only bytes of the
 * requested hash; other bytes are a corrupt object, never `found`.
 */
function normalizeReadResult(
  value: unknown,
  segmentHash: string,
): EvidencePayloadReadResult | null {
  try {
    if (!isObject(value)) return null;
    const status = value.status;
    switch (status) {
      case "found": {
        const bytes = value.bytes;
        if (!(bytes instanceof Uint8Array)) return null;
        const copy = new Uint8Array(bytes);
        return sha256Hex(copy) === segmentHash
          ? { status, bytes: copy }
          : { status: "unavailable", reason: "storage_object_corrupt" };
      }
      case "not_found":
        return { status };
      case "unavailable": {
        const reason = value.reason;
        return typeof reason === "string" ? { status, reason } : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function normalizeIdentityResult(value: unknown): StorageIdentityResult | null {
  try {
    if (!isObject(value)) return null;
    const status = value.status;
    switch (status) {
      case "verified":
      case "mismatch":
        return { status };
      case "unavailable": {
        const reason = value.reason;
        return typeof reason === "string" ? { status, reason } : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
