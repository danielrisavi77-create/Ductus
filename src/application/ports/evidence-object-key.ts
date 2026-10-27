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
 * What an evidence object holds: a segment, or the timing of a segment
 * (`ductus-evidence-timing-v1`, DAN-344 P1). Both are content-addressed: the
 * hash in the key is the SHA-256 of the object's own bytes.
 */
export type EvidenceObjectKind = "segment" | "timing-v1";

const OBJECT_SUFFIX: Readonly<Record<EvidenceObjectKind, string>> = {
  segment: ".json",
  "timing-v1": ".timing-v1.json",
};

/**
 * The one object key of an evidence payload, as path segments:
 * `v2/<institution>/<package>/<hash>.json` (BACKEND 4.1), or
 * `<hash>.timing-v1.json` for a timing (addendum c.6435323774 on #923). The
 * institution is the one the server resolved for the package, never a value
 * from the request. The prefix keeps two institutions apart even if both were
 * mapped to one bucket by mistake, so the same hash never reads as `existing`
 * across them. `segmentHash` is the hash of the object's bytes, whatever its
 * kind; no kind is a segment. Returns `null` for any input outside the
 * allowed forms.
 */
export function evidenceObjectKey(input: {
  institutionId: unknown;
  evidencePackageId: unknown;
  segmentHash: unknown;
  kind?: unknown;
}): readonly string[] | null {
  const kind = input.kind === undefined ? "segment" : input.kind;
  if (
    !isInstitutionId(input.institutionId) ||
    !isEvidencePackageId(input.evidencePackageId) ||
    !isSha256Hex(input.segmentHash) ||
    (kind !== "segment" && kind !== "timing-v1")
  ) {
    return null;
  }
  return [
    "v2",
    input.institutionId,
    input.evidencePackageId,
    `${input.segmentHash}${OBJECT_SUFFIX[kind]}`,
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
