import {
  isInstitutionId,
  isStorageDomainLabel,
} from "@/application/ports/evidence-object-key";

import type { S3StorageCapability } from "./s3-evidence-payload-store";
import { S3SecretCredentials } from "./s3-signature";

/**
 * One storage domain: one bucket of one institution in one region (BACKEND
 * 4.1, D-08 still PRIJEDLOG). The label names it in `storageRef` and logs.
 *
 * A later evidence domain identifier (#202) can be added to this entry
 * without touching the object key: the key is built only from the
 * institution, the package and the hash (`evidenceObjectKey`).
 */
export type EvidenceStorageDomain = {
  label: string;
  institutionId: string;
  endpoint: string;
  region: string;
  bucket: string;
  /** Sealed: no enumeration, JSON or inspection of the configuration shows a key. */
  credentials: S3SecretCredentials;
  /**
   * The contract test confirmation for this domain's endpoint (#155). Checked
   * in full by the adapter when the domain's store is built, at startup.
   */
  capability: S3StorageCapability;
};

export type EvidenceStorageConfig = {
  requestTimeoutMs: number;
  domains: readonly EvidenceStorageDomain[];
};

/** Messages name the variable, field or domain label, never a value. */
export class EvidenceStorageConfigError extends Error {
  override name = "EvidenceStorageConfigError";
}

type Env = Readonly<Record<string, string | undefined>>;

export const EVIDENCE_STORAGE_DOMAINS = "EVIDENCE_STORAGE_DOMAINS";
// Credentials come only from variables of this family, so the configuration
// cannot point a domain at another secret of the process.
const CREDENTIAL_VAR = /^EVIDENCE_S3_[A-Z0-9_]{1,64}$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const TOP_FIELDS = new Set(["requestTimeoutMs", "sharedCredentials", "domains"]);
const DOMAIN_FIELDS = new Set([
  "label",
  "institutionId",
  "endpoint",
  "region",
  "bucket",
  "accessKeyIdVar",
  "secretAccessKeyVar",
  "capability",
]);

function fail(message: string): never {
  throw new EvidenceStorageConfigError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  where: string,
) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) fail(`${where}: unknown field`);
  }
}

function text(value: Record<string, unknown>, field: string, where: string) {
  const got = value[field];
  if (typeof got !== "string" || got === "") fail(`${where}: ${field} is missing`);
  return got;
}

function secretFrom(env: Env, name: string, where: string): string {
  if (!CREDENTIAL_VAR.test(name)) {
    fail(`${where}: credential variable must be named EVIDENCE_S3_*`);
  }
  const value = env[name];
  if (value === undefined || value === "") fail(`${name} is not set`);
  return value;
}

function isLoopback(endpoint: string): boolean {
  try {
    return LOOPBACK.has(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}

/** https, or plain http only to loopback (S14); checked before any request. */
function endpointFrom(value: Record<string, unknown>, where: string): string {
  const endpoint = text(value, "endpoint", where);
  let protocol: string;
  try {
    protocol = new URL(endpoint).protocol;
  } catch {
    fail(`${where}: endpoint is not a URL`);
  }
  if (protocol !== "https:" && !(protocol === "http:" && isLoopback(endpoint))) {
    fail(`${where}: endpoint must use https outside loopback`);
  }
  return endpoint;
}

/**
 * Reads the storage domains from operator configuration: the JSON in
 * `EVIDENCE_STORAGE_DOMAINS`, credentials from the `EVIDENCE_S3_*` variables
 * it names. Any fault stops startup. An institution without a domain gets no
 * storage at all (P2); there is no default or shared bucket.
 *
 * Every endpoint is https, or http only to loopback (S14). Two domains never
 * share an institution, a bucket name or an access key (P9).
 * Sharing a key is allowed only with `"sharedCredentials": "loopback-only"`,
 * only when every endpoint is on loopback and never when NODE_ENV is
 * `production`, as for plain http in the adapter: loopback alone may be a
 * local proxy to real storage.
 */
export function loadEvidenceStorageConfig(
  env: Env = process.env,
): EvidenceStorageConfig {
  const raw = env[EVIDENCE_STORAGE_DOMAINS];
  if (raw === undefined || raw.trim() === "") {
    fail(`${EVIDENCE_STORAGE_DOMAINS} is not set`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(`${EVIDENCE_STORAGE_DOMAINS} is not valid JSON`);
  }
  const where = EVIDENCE_STORAGE_DOMAINS;
  if (!isRecord(parsed)) fail(`${where} must be an object`);
  onlyFields(parsed, TOP_FIELDS, where);
  const { requestTimeoutMs, sharedCredentials, domains } = parsed;
  if (typeof requestTimeoutMs !== "number") {
    fail(`${where}: requestTimeoutMs is missing`);
  }
  if (sharedCredentials !== undefined && sharedCredentials !== "loopback-only") {
    fail(`${where}: sharedCredentials may only be "loopback-only"`);
  }
  if (sharedCredentials !== undefined && env.NODE_ENV === "production") {
    fail(`${where}: sharedCredentials is not allowed in production`);
  }
  if (!Array.isArray(domains)) fail(`${where}: domains must be a list`);

  // Plain access key ids live only here, for the uniqueness check, and never
  // leave this function; the configuration holds sealed keys.
  const accessKeyIds = new Map<string, string>();
  const out: EvidenceStorageDomain[] = domains.map((entry: unknown, i) => {
    const at = `${where}: domain ${i}`;
    if (!isRecord(entry)) fail(`${at} must be an object`);
    onlyFields(entry, DOMAIN_FIELDS, at);
    const label = text(entry, "label", at);
    if (!isStorageDomainLabel(label)) fail(`${at}: label is not valid`);
    const named = `${where}: domain ${label}`;
    const institutionId = text(entry, "institutionId", named);
    if (!isInstitutionId(institutionId)) {
      fail(`${named}: institutionId is not a lowercase UUID`);
    }
    const endpoint = endpointFrom(entry, named);
    const region = text(entry, "region", named);
    const bucket = text(entry, "bucket", named);
    const capability = entry.capability;
    if (!isRecord(capability)) fail(`${named}: capability is missing`);
    const accessKeyId = secretFrom(env, text(entry, "accessKeyIdVar", named), named);
    const secretAccessKey = secretFrom(
      env,
      text(entry, "secretAccessKeyVar", named),
      named,
    );
    let credentials: S3SecretCredentials;
    try {
      credentials = new S3SecretCredentials({ accessKeyId, secretAccessKey });
    } catch {
      // The sealing error names no value; this one names only the domain.
      fail(`${named}: credentials are not valid`);
    }
    accessKeyIds.set(label, accessKeyId);
    return {
      label,
      institutionId,
      endpoint,
      region,
      bucket,
      credentials,
      capability: { ...capability } as S3StorageCapability,
    };
  });

  unique(out, (d) => d.label, "label");
  unique(out, (d) => d.institutionId, "institution");
  unique(out, (d) => d.bucket, "bucket");
  if (sharedCredentials === "loopback-only") {
    if (!out.every((d) => isLoopback(d.endpoint))) {
      fail(`${where}: sharedCredentials is allowed only on loopback endpoints`);
    }
  } else {
    unique(out, (d) => accessKeyIds.get(d.label) ?? "", "access key");
  }
  return { requestTimeoutMs, domains: out };
}

function unique(
  domains: readonly EvidenceStorageDomain[],
  keyOf: (domain: EvidenceStorageDomain) => string,
  what: string,
) {
  const seen = new Map<string, string>();
  for (const domain of domains) {
    const other = seen.get(keyOf(domain));
    if (other !== undefined) {
      fail(
        `${EVIDENCE_STORAGE_DOMAINS}: domains ${other} and ${domain.label} share one ${what}`,
      );
    }
    seen.set(keyOf(domain), domain.label);
  }
}
