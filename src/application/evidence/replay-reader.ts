import {
  bindPayloadReader,
  type InstitutionEvidencePayloadReader,
} from "@/application/ports/evidence-reconstruction";
import type { ReplaySource } from "@/application/ports/replay-source";
import { isDocumentId } from "@/domain/collaboration";
import { REVISION_ZERO_JCS, REVISION_ZERO_SHA256 } from "@/domain/document/revision-zero";
import { sha256WebCrypto } from "@/domain/forensics/crypto";
import {
  verifyCanonicalEvidencePayloadV2,
  type EvidenceChainHeadV2,
  type VerifiedEvidencePayloadV2,
} from "@/domain/forensics/evidence-chain-v2";
import { canonicalizeJcs } from "@/domain/forensics/jcs";

/**
 * One page of the replay of a document (DAN-344, contract on #923, route R3).
 *
 * The page holds the exact stored bytes of the segments from index `from` in
 * chain order, each checked here: canonical, under its listed hash, linked to
 * the listed segment before it and of the document asked for. The browser
 * checks them again and replays them by the same step rules; the server
 * computes no document state per change.
 *
 * The only request inputs are the document id and `from`. Who asks reaches
 * this code only through `source`, so the owner and the teacher of the same
 * stored state get the same bytes (PRODUCT §5 rule 5): the RFC 8785 JCS text
 * of the page. Every failure is whole, never a partial page; `reason` is a
 * fixed code for the server log.
 */

export const REPLAY_FORMAT = "ductus-evidence-replay-v1";
/**
 * Bytes per page: the segments, plus MAX_REPLAY_CHECKPOINT_BYTES for every
 * checkpoint text the page asks for (its start and each break's resume), so
 * the texts are counted before they are read. A page always holds at least
 * one segment.
 */
export const MAX_REPLAY_PAGE_BYTES = 8 * 1024 * 1024;
/** The largest checkpoint text (evidence.document_checkpoint); a longer one is no checkpoint. */
export const MAX_REPLAY_CHECKPOINT_BYTES = 2 * 1024 * 1024;
/** Segments per page, which also bounds the checkpoint hashes one page asks for. */
export const MAX_REPLAY_PAGE_SEGMENTS = 256;

export type ReplayReaderDeps = {
  /** Already bound to the requesting actor; decides access and lists the record. */
  source: ReplaySource;
  /** Storage of every institution; bound here to the institution the source names. */
  payloads: InstitutionEvidencePayloadReader;
};

export type ReplayPage = {
  replayFormat: typeof REPLAY_FORMAT;
  segmentCount: number;
  head: EvidenceChainHeadV2 | null;
  from: number;
  next: number | null;
  /** Only on the first page: the document before the first change. */
  startDocument: string | null;
  segments: string[];
  /** Per chain break on this page: the checkpoint the replay resumes from, when one has that hash. */
  resumeDocuments: Record<string, string>;
};

export type ReplayUnavailableReason =
  | "source_unavailable"
  | "payload_missing"
  | "payload_unavailable"
  | "invalid_segment"
  | "segment_mismatch"
  | "checkpoints_unavailable"
  | "start_missing";

export type ReplayReadResult =
  | { status: "ok"; body: string }
  | { status: "not_found" }
  | { status: "unauthenticated" }
  | { status: "unavailable"; reason: ReplayUnavailableReason };

const unavailable = (reason: ReplayUnavailableReason): ReplayReadResult => ({ status: "unavailable", reason });

export async function readReplayPage(
  deps: ReplayReaderDeps,
  documentId: string,
  from: number,
): Promise<ReplayReadResult> {
  // An id or index that cannot exist is answered like a document that does not.
  if (!isDocumentId(documentId) || !Number.isSafeInteger(from) || from < 0) return { status: "not_found" };

  let source;
  try {
    source = await deps.source.readSource(documentId);
  } catch {
    return unavailable("source_unavailable");
  }
  if (source.status === "not_found") return { status: "not_found" };
  if (source.status === "unauthenticated") return { status: "unauthenticated" };
  if (source.status !== "found") return unavailable("source_unavailable");

  const hashes = source.segmentHashes;
  const page: ReplayPage = {
    replayFormat: REPLAY_FORMAT,
    segmentCount: hashes.length,
    head: source.head,
    from,
    next: null,
    startDocument: null,
    segments: [],
    resumeDocuments: {},
  };
  if (hashes.length === 0) {
    return from === 0 ? { status: "ok", body: canonicalizeJcs(page) } : { status: "not_found" };
  }
  if (from >= hashes.length) return { status: "not_found" };

  const storage = bindPayloadReader(deps.payloads, source.institutionId);
  const evidencePackageId = source.evidencePackageId;
  // The segment at `index`, held to the listing: its hash, its predecessor and its document.
  type Read = { verified: VerifiedEvidencePayloadV2; bytes: Uint8Array };
  async function read(index: number): Promise<Read | ReplayUnavailableReason> {
    let stored;
    try {
      stored = await storage.readImmutable({ evidencePackageId, segmentHash: hashes[index] });
    } catch {
      return "payload_unavailable";
    }
    if (stored.status === "not_found") return "payload_missing";
    if (stored.status !== "found") return "payload_unavailable";
    // Own copy: the bytes checked are the bytes sent.
    const bytes = new Uint8Array(stored.bytes);
    const verified = await verifyCanonicalEvidencePayloadV2(bytes);
    if (!verified.ok) return "invalid_segment";
    if (
      verified.sha256 !== hashes[index] ||
      verified.segment.predecessorSegmentHash !== (index === 0 ? null : hashes[index - 1]) ||
      verified.segment.documentId !== documentId
    ) {
      return "segment_mismatch";
    }
    return { verified, bytes };
  }

  let previous: VerifiedEvidencePayloadV2 | null = null;
  if (from > 0) {
    // Only to see whether the page starts at a break; its bytes are not sent.
    const before = await read(from - 1);
    if (typeof before === "string") return unavailable(before);
    previous = before.verified;
  }
  const resumeHashes = new Set<string>();
  let pageBytes = 0;
  let index = from;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const encoder = new TextEncoder();
  // The document the first change applies to, asked for only on the first page.
  let start: string | null = null;
  while (index < hashes.length && page.segments.length < MAX_REPLAY_PAGE_SEGMENTS) {
    const current = await read(index);
    if (typeof current === "string") return unavailable(current);
    const { verified } = current;
    const initial = verified.segment.initialDocumentHash;
    const resumes = previous !== null && initial !== previous.segment.finalDocumentHash;
    // A checkpoint text this segment adds to the page; revision 0 is a fixed short text.
    const asks = initial !== REVISION_ZERO_SHA256 && (index === 0 || (resumes && !resumeHashes.has(initial)));
    const cost = verified.byteLength + (asks ? MAX_REPLAY_CHECKPOINT_BYTES : 0);
    if (page.segments.length > 0 && pageBytes + cost > MAX_REPLAY_PAGE_BYTES) break;
    // Verified canonical, so the bytes are valid UTF-8 and this text encodes back to them.
    page.segments.push(decoder.decode(current.bytes));
    pageBytes += cost;
    if (resumes) resumeHashes.add(initial);
    if (index === 0) start = initial;
    previous = verified;
    index++;
  }
  page.next = index < hashes.length ? index : null;

  // Revision 0 is the same bytes for every work; no checkpoint is read for it.
  if (start === REVISION_ZERO_SHA256) page.startDocument = REVISION_ZERO_JCS;
  if (resumeHashes.delete(REVISION_ZERO_SHA256)) page.resumeDocuments[REVISION_ZERO_SHA256] = REVISION_ZERO_JCS;
  const wanted = new Set(resumeHashes);
  if (start !== null && page.startDocument === null) wanted.add(start);
  if (wanted.size > 0) {
    let checkpoints;
    try {
      checkpoints = await deps.source.readCheckpoints(documentId, [...wanted].sort());
    } catch {
      return unavailable("checkpoints_unavailable");
    }
    if (checkpoints.status === "unauthenticated") return { status: "unauthenticated" };
    if (checkpoints.status !== "found") return unavailable("checkpoints_unavailable");
    for (const hash of wanted) {
      const text = checkpoints.texts.get(hash);
      // Only text within the reserved size that hashes to the hash it was asked for; anything else is no checkpoint.
      if (text === undefined || encoder.encode(text).byteLength > MAX_REPLAY_CHECKPOINT_BYTES) continue;
      if ((await sha256WebCrypto(text)) !== hash) continue;
      if (resumeHashes.has(hash)) page.resumeDocuments[hash] = text;
      if (hash === start && page.startDocument === null) page.startDocument = text;
    }
  }
  // Without the document the first change applies to there is nothing to replay.
  if (start !== null && page.startDocument === null) return unavailable("start_missing");
  return { status: "ok", body: canonicalizeJcs(page) };
}
