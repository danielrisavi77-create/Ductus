/**
 * Limits of an import (DAN-436, contract docs/contracts/import-v1.md §4,
 * attack plan #1911 L1 to L4). Every number here is a PRIJEDLOG until the
 * review of the contract records it (D-291); none is a new limit of its own.
 */
import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";

import { DEFAULT_DOCX_LIMITS, type DocxLimits, resolveDocxLimits } from "../docx/limits";

/**
 * Bytes of the imported file. D-291: no new limit, the payload limit of B-8
 * holds, so the file the server receives to recompute `rawSha256` is held to
 * the same bound as a segment.
 */
export const MAX_IMPORT_RAW_BYTES: number = MAX_EVIDENCE_SEGMENT_BYTES;

/**
 * Read limits for a DOCX import: the configured, unmeasured defaults of the
 * spike M8.1-P03, with the file size held to {@link MAX_IMPORT_RAW_BYTES}.
 * A caller may only tighten them ({@link resolveImportDocxLimits}).
 */
export const IMPORT_DOCX_READ_LIMITS: Readonly<DocxLimits> = Object.freeze({
  ...DEFAULT_DOCX_LIMITS,
  maxInputBytes: MAX_IMPORT_RAW_BYTES,
});

/**
 * `resolveDocxLimits` caps a caller at the generic defaults (64 MiB input);
 * an import is capped at {@link IMPORT_DOCX_READ_LIMITS}. Malformed input is
 * refused the same way (`DocxRejected("LIMITS_INVALID")`).
 */
export function resolveImportDocxLimits(limits?: Partial<DocxLimits>): DocxLimits {
  const resolved = resolveDocxLimits(limits);
  for (const key of Object.keys(resolved) as (keyof DocxLimits)[]) {
    resolved[key] = Math.min(resolved[key], IMPORT_DOCX_READ_LIMITS[key]);
  }
  return resolved;
}

/** How long a prepared import waits for the student's confirmation. */
export const IMPORT_PENDING_LIFETIME_MS = 60 * 60 * 1000;

export function isImportRawByteLength(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= MAX_IMPORT_RAW_BYTES;
}
