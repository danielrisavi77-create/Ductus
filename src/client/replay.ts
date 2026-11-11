/**
 * The browser side of the replay (DAN-537, rb 261, contract on #1836; route
 * POST /api/evidence/replay, #1895). The body names the document, the page
 * start and, after the first page, the head the first page reported; who asks
 * comes only from the session cookie, so the student and the teacher send the
 * same requests, get the same bytes and see the same player (PRODUCT §5 rule 5).
 *
 * A page is taken only when it is exactly a replay page that continues the
 * pages before it: the same head, the next index, no field it does not know.
 * Anything else is `unavailable`, never part of a record. When the record no
 * longer holds the pinned head (409, a submission cut it) everything read so
 * far is dropped and the reading starts again from the first page, at most
 * twice; pages of two records are never joined.
 */

import { createBrowserReplayStepsV1 } from "@/adapters/evidence/edit-steps-v1-replay-steps";
import type { EvidenceChainHeadV2 } from "@/domain/forensics/evidence-chain-v2";
import { buildReplayPlayer, type ReplayPlayer, type ReplayRecord } from "@/domain/projection/replay-player";

export const REPLAY_PAGE_FORMAT = "ductus-evidence-replay-v1";
/** The route's MAX_REPLAY_PAGE_SEGMENTS: a page with more is no page of it. */
export const REPLAY_PAGE_MAX_SEGMENTS = 256;
/** Fresh readings after a 409 before the record counts as unavailable. */
export const REPLAY_RESTARTS = 2;

export type ReplayPage = {
  segmentCount: number;
  head: EvidenceChainHeadV2 | null;
  from: number;
  next: number | null;
  startDocument: string | null;
  segments: string[];
  resumeDocuments: Record<string, string>;
};

const HASH = /^[0-9a-f]{64}$/;
const KEYS = ["replayFormat", "segmentCount", "head", "from", "next", "startDocument", "segments", "resumeDocuments"];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function exactly(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

const whole = (value: unknown, min: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min;

function head(value: unknown): EvidenceChainHeadV2 | null {
  if (!exactly(value, ["segmentHash", "segmentCount"])) return null;
  const { segmentHash, segmentCount } = value;
  if (typeof segmentHash !== "string" || !HASH.test(segmentHash) || !whole(segmentCount, 1)) return null;
  return { segmentHash, segmentCount };
}

function texts(value: unknown): Record<string, string> | null {
  if (!isObject(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(value)) {
    if (!HASH.test(key) || typeof text !== "string") return null;
    out[key] = text;
  }
  return out;
}

/**
 * The page when `value` is exactly the replay page that starts at `from` and,
 * for every page after the first, ends at the `pin` the first one reported;
 * otherwise null.
 */
export function parseReplayPage(value: unknown, from: number, pin: EvidenceChainHeadV2 | null): ReplayPage | null {
  if (!exactly(value, KEYS) || value.replayFormat !== REPLAY_PAGE_FORMAT) return null;
  const { segmentCount: count, next, startDocument, segments } = value;
  if (!whole(count, 0) || value.from !== from) return null;

  const pageHead = value.head === null ? null : head(value.head);
  if (value.head !== null && pageHead === null) return null;
  // No head exactly when the record is empty, and the head's count is the page's.
  if ((pageHead === null) !== (count === 0) || (pageHead !== null && pageHead.segmentCount !== count)) return null;
  if (pin !== null && (pageHead === null || pageHead.segmentHash !== pin.segmentHash || pageHead.segmentCount !== pin.segmentCount)) {
    return null;
  }

  if (!Array.isArray(segments) || !segments.every((segment) => typeof segment === "string")) return null;
  if (segments.length > REPLAY_PAGE_MAX_SEGMENTS) return null;
  const resumeDocuments = texts(value.resumeDocuments);
  if (resumeDocuments === null) return null;

  if (count === 0) {
    // The empty record is one first page with nothing on it.
    if (from !== 0 || segments.length !== 0 || next !== null || startDocument !== null || Object.keys(resumeDocuments).length !== 0) {
      return null;
    }
  } else {
    const end = from + segments.length;
    if (segments.length === 0 || end > count || next !== (end < count ? end : null)) return null;
    // The document before the first change comes on the first page and only there.
    if (from === 0 ? typeof startDocument !== "string" : startDocument !== null) return null;
  }
  return {
    segmentCount: count,
    head: pageHead,
    from,
    next: next as number | null,
    startDocument: startDocument as string | null,
    segments: segments as string[],
    resumeDocuments,
  };
}

export type ReplayRecordOutcome =
  | { kind: "ok"; record: ReplayRecord }
  | { kind: "signedOut" | "notFound" | "unavailable" };

type PageRead = { kind: "page"; page: ReplayPage } | { kind: "changed" } | { kind: "signedOut" | "notFound" | "unavailable" };

async function readPage(
  documentId: string,
  from: number,
  pin: EvidenceChainHeadV2 | null,
  fetcher: typeof fetch,
): Promise<PageRead> {
  let response: Response;
  try {
    response = await fetcher("/api/evidence/replay", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pin === null ? { documentId, from: 0 } : { documentId, from, head: pin }),
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (response.status === 401) return { kind: "signedOut" };
  if (response.status === 404) return { kind: "notFound" };
  if (response.status === 409) return { kind: "changed" };
  if (response.status !== 200) return { kind: "unavailable" };
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer()));
  } catch {
    return { kind: "unavailable" };
  }
  const page = parseReplayPage(value, from, pin);
  return page === null ? { kind: "unavailable" } : { kind: "page", page };
}

/**
 * Reads every page of the record of `documentId`, pinned to the head of the
 * first. `current()` is asked before every request: once the session has
 * ended in this browser nothing more is sent (F-093).
 */
export async function fetchReplayRecord(
  documentId: string,
  current: () => boolean = () => true,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<ReplayRecordOutcome> {
  for (let reading = 0; reading <= REPLAY_RESTARTS; reading++) {
    // A fresh reading keeps nothing of the one before it.
    let pin: EvidenceChainHeadV2 | null = null;
    let startDocument: string | null = null;
    const segments: string[] = [];
    const resumeDocuments: Record<string, string> = {};
    let from: number | null = 0;
    let changed = false;
    while (from !== null) {
      if (!current()) return { kind: "signedOut" };
      const read = await readPage(documentId, from, pin, fetcher);
      if (read.kind === "changed") {
        changed = true;
        break;
      }
      if (read.kind !== "page") return { kind: read.kind };
      const { page } = read;
      if (pin === null) {
        pin = page.head;
        startDocument = page.startDocument;
      }
      for (const [hash, text] of Object.entries(page.resumeDocuments)) {
        // The same hash names one text; two texts for it are no record.
        if (Object.hasOwn(resumeDocuments, hash) && resumeDocuments[hash] !== text) return { kind: "unavailable" };
        resumeDocuments[hash] = text;
      }
      segments.push(...page.segments);
      from = page.next;
    }
    if (!changed) return { kind: "ok", record: { startDocument, segments, head: pin, resumeDocuments } };
  }
  return { kind: "unavailable" };
}

export type ReplayOutcome =
  | { kind: "ok"; player: Extract<ReplayPlayer, { ok: true }> }
  | { kind: "signedOut" | "notFound" | "unavailable" };

/**
 * The one entry both views call: the record read and verified, then replayed.
 * There is no input about who looks; a record that fails any check is
 * `unavailable`, never shown in part.
 */
export async function loadReplay(
  documentId: string,
  current: () => boolean = () => true,
  fetcher?: typeof fetch,
): Promise<ReplayOutcome> {
  const read = await fetchReplayRecord(documentId, current, fetcher);
  if (read.kind !== "ok") return read;
  const player = await buildReplayPlayer(read.record, createBrowserReplayStepsV1());
  return player.ok ? { kind: "ok", player } : { kind: "unavailable" };
}
