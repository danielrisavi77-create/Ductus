import { isEvidencePackageId, isSha256Hex } from "./evidence-ingest";

// The institution id as the database keeps it: a UUID in lowercase only, so
// one institution never has two spellings in an object key. Another form is
// refused, not normalized.
const INSTITUTION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// An operator label for one storage domain (one bucket of one institution in
// one region). It names the domain in `storageRef`; it is never an endpoint.
const STORAGE_DOMAIN_LABEL = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isInstitutionId(value: unknown): value is string {
  return typeof value === "string" && INSTITUTION_ID.test(value);
}

export function isStorageDomainLabel(value: unknown): value is string {
  return typeof value === "string" && STORAGE_DOMAIN_LABEL.test(value);
}

/**
 * The one object key of an evidence payload, as path segments:
 * `v2/<institution>/<package>/<hash>.json` (BACKEND 4.1). The institution is
 * the one the server resolved for the package, never a value from the
 * request. The prefix keeps two institutions apart even if both were mapped
 * to one bucket by mistake, so the same hash never reads as `existing` across
 * them. Returns `null` for any input outside the allowed forms.
 */
export function evidenceObjectKey(input: {
  institutionId: unknown;
  evidencePackageId: unknown;
  segmentHash: unknown;
}): readonly string[] | null {
  if (
    !isInstitutionId(input.institutionId) ||
    !isEvidencePackageId(input.evidencePackageId) ||
    !isSha256Hex(input.segmentHash)
  ) {
    return null;
  }
  return [
    "v2",
    input.institutionId,
    input.evidencePackageId,
    `${input.segmentHash}.json`,
  ];
}

/**
 * What the database keeps for a stored payload: the storage domain label and
 * the object key, never a URL, endpoint or bucket name.
 */
export function evidenceStorageRef(
  storageDomain: string,
  key: readonly string[],
): string {
  if (!isStorageDomainLabel(storageDomain)) {
    throw new TypeError("storage domain label is not valid");
  }
  return `${storageDomain}:${key.join("/")}`;
}
