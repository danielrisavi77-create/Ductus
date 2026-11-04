import { canonicalizeJcs } from "@/domain/forensics/jcs";

/**
 * The fingerprint of the assignment notice a student acknowledges (DAN-306,
 * M2.13-P02a). The server computes it in institution.notice_fingerprint from
 * the stored assignment version and the notice template version; this is the
 * same function in TypeScript, held to the same golden vector, so that the
 * two never drift and a stored fingerprint can be recomputed outside the
 * database.
 *
 * Bytes: UTF-8("ductus-notice-fingerprint-v1") || 0x0a || JCS(payload), hashed
 * with SHA-256 and written as 64 lowercase hex digits. No Unicode
 * normalisation: NFC and NFD, CRLF and LF give different fingerprints.
 */
export const NOTICE_FINGERPRINT_FORMAT_V1 = "ductus-notice-fingerprint-v1" as const;

/**
 * The version of the static notice text (src/lib/i18n/messages.hr, the parts
 * AssignmentNotice shows). Any change of that text is a new version: the pin
 * in tests/unit/notice-template-pin.test.ts fails until this number and the
 * pinned digest change together.
 */
export const NOTICE_TEMPLATE_VERSION = 1 as const;

/** What the notice shows of an assignment version, and nothing else. */
export type NoticeFingerprintInput = {
  templateVersion: number;
  title: string;
  instructions: string;
  workType: string;
  /** Instants as Date.prototype.toISOString writes them, in UTC. */
  opensAt: string;
  dueAt: string;
  aiPolicy: string;
  aiPurposes: readonly string[];
  evidenceProfile: string;
  wordMin: number | null;
  wordMax: number | null;
};

/** The fields that enter the fingerprint, in one place (A11). */
export const NOTICE_FINGERPRINT_FIELDS = [
  "aiPolicy", "aiPurposes", "dueAt", "evidenceProfile", "instructions", "opensAt",
  "templateVersion", "title", "wordMax", "wordMin", "workType",
] as const;

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function codeUnitOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The canonical payload: purposes without repeats in code-unit order, none when prohibited. */
export function noticeFingerprintPayload(input: NoticeFingerprintInput): Record<string, unknown> {
  if (!Number.isSafeInteger(input.templateVersion) || input.templateVersion < 1) {
    throw new Error("notice fingerprint: invalid template version");
  }
  for (const instant of [input.opensAt, input.dueAt]) {
    if (!ISO_INSTANT.test(instant)) throw new Error("notice fingerprint: instant is not an ISO UTC instant");
  }
  const purposes = input.aiPolicy === "prohibited" ? [] : [...new Set(input.aiPurposes)].sort(codeUnitOrder);
  return {
    aiPolicy: input.aiPolicy,
    aiPurposes: purposes,
    dueAt: input.dueAt,
    evidenceProfile: input.evidenceProfile,
    instructions: input.instructions,
    opensAt: input.opensAt,
    templateVersion: input.templateVersion,
    title: input.title,
    wordMax: input.wordMax,
    wordMin: input.wordMin,
    workType: input.workType,
  };
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 over prefix || 0x0a || canonical text; the prefix is a parameter only for tests (A3). */
export async function prefixedSha256(prefix: string, canonical: string): Promise<string> {
  const head = prefix === "" ? "" : `${prefix}\n`;
  return hex(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(head + canonical)));
}

export async function noticeFingerprint(input: NoticeFingerprintInput): Promise<string> {
  return prefixedSha256(NOTICE_FINGERPRINT_FORMAT_V1, canonicalizeJcs(noticeFingerprintPayload(input)));
}
