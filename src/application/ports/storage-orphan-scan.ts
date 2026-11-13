// Ports of the storage orphan count (DAN-610, M3.6-P03). In the pilot orphans
// are only counted and audited, never deleted or moved (ARCHITECTURE §5,
// `docs/backend/evidencija.md`), so no port here has a write to the store.

export type StoredObjectEntry = {
  /** Object key inside the bucket of one storage domain, as the store lists it. */
  key: string;
  /** When the store last wrote the object (ISO 8601 with a zone). */
  lastModified: string;
};

export type StorageReferenceEntry = {
  /** `evidence.acceptances.storage_ref`: `<storage domain>:<object key>`. */
  storageRef: string;
  /** The earliest `accepted_at` of the rows that name this reference (ISO 8601 with a zone). */
  acceptedAt: string;
};

export type ScanPage<T> =
  | { status: "ok"; entries: readonly T[]; next: string | null }
  | { status: "unavailable"; reason: string };

export type ScanPageRequest = {
  storageDomain: string;
  /** `null` for the first page, then the `next` of the page before. */
  cursor: string | null;
  pageSize: number;
};

export interface StorageKeyLister {
  /**
   * One page of the object keys of one storage domain, in ascending order of
   * their UTF-8 bytes, each key once (the order of S3 ListObjectsV2). Read
   * only: listing never writes, deletes or moves an object.
   */
  listKeys(input: ScanPageRequest): Promise<ScanPage<StoredObjectEntry>>;
}

export interface StorageReferenceReader {
  /**
   * One page of the distinct storage references that start with
   * `<storageDomain>:`, in ascending order of their UTF-8 bytes (`COLLATE "C"`).
   */
  listReferences(input: ScanPageRequest): Promise<ScanPage<StorageReferenceEntry>>;
}

/**
 * Counts only. No object key, reference, hash, package, institution or file
 * name and no content, so the record may go to the audit trail and logs.
 * The counts are `null` unless the whole pass completed.
 */
export type StorageOrphanScanSummary = {
  storageDomain: string;
  status: "completed" | "unavailable" | "malformed" | "page_limit";
  stoppedAt: "storage" | "references" | null;
  startedAt: string;
  finishedAt: string;
  thresholdMs: number;
  pages: { storage: number; references: number };
  counts: {
    paired: number;
    objectsWithoutReference: number;
    referencesWithoutObject: number;
    /** Unpaired, but younger than the threshold: never counted as orphans. */
    youngObjectsWithoutReference: number;
    youngReferencesWithoutObject: number;
    /** Not in the form `v2/<institution>/<package>/<hash>.json`: never orphans. */
    objectsOutsidePrefix: number;
    referencesOutsidePrefix: number;
  } | null;
};

export interface StorageOrphanAudit {
  /** One record per pass, whatever its status. */
  record(summary: StorageOrphanScanSummary): Promise<{ status: "recorded" } | { status: "unavailable" }>;
}
