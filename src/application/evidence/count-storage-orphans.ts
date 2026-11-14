// Counts orphans of one storage domain (DAN-610, M3.6-P03): objects in the
// store that no acceptance names, and acceptances whose object is not in the
// store. In the pilot orphans are counted and audited only, never deleted or
// moved (ARCHITECTURE §5, `docs/backend/evidencija.md`). Not wired to the
// worker yet: the store listing, the database reader and the audit table come
// with the adapters.

import { evidenceObjectKey, isStorageDomainLabel } from "@/application/ports/evidence-object-key";
import type {
  ScanPage,
  ScanPageRequest,
  StorageKeyLister,
  StorageOrphanAudit,
  StorageOrphanScanSummary,
  StorageReferenceReader,
} from "@/application/ports/storage-orphan-scan";
import { isPlainObject } from "@/domain/json";

import { parseInstant } from "./reconcile-pending-receipts";

const HOUR_MS = 3_600_000;
export const MIN_ORPHAN_THRESHOLD_MS = HOUR_MS;
export const MAX_ORPHAN_THRESHOLD_MS = 30 * 24 * HOUR_MS;
export const MAX_SCAN_PAGE_SIZE = 1000;
// S3 keys are at most 1024 bytes (never fewer UTF-16 units); `storage_ref` is
// at most 2048 characters, counted as the database counts them.
const MAX_KEY_LENGTH = 1024;
const MAX_REF_LENGTH = 2048;
const MAX_CURSOR_LENGTH = 4096;

export type CountStorageOrphansInput = {
  storageDomain: string;
  store: StorageKeyLister;
  references: StorageReferenceReader;
  audit: StorageOrphanAudit;
  now: () => number;
  /** An unpaired entry younger than this is never an orphan (1 h to 30 days). */
  thresholdMs: number;
  pageSize: number;
  maxPages: number;
};

export type CountStorageOrphansResult = {
  summary: StorageOrphanScanSummary;
  audit: "recorded" | "unavailable";
};

type Side = "storage" | "references";
type Counts = NonNullable<StorageOrphanScanSummary["counts"]>;
type Entry = { key: string | null; at: unknown };

class Halt {
  constructor(
    readonly status: "unavailable" | "malformed" | "page_limit",
    readonly side: Side,
  ) {}
}

/** Order of UTF-8 bytes, which is the order of code points (not of UTF-16 units). */
function byteOrder(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0)!);
  const y = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    if (x[i] !== y[i]) return x[i]! - y[i]!;
  }
  return x.length - y.length;
}

/** The key if `evidenceObjectKey` builds exactly this key, else `null`. */
export function evidenceKeyInPrefix(key: string): string | null {
  const parts = key.split("/");
  if (parts.length !== 4 || !parts[3]!.endsWith(".json")) return null;
  const built = evidenceObjectKey({
    institutionId: parts[1],
    evidencePackageId: parts[2],
    segmentHash: parts[3]!.slice(0, -".json".length),
  });
  return built !== null && built.join("/") === key ? key : null;
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

/** At most `max` code points, as PostgreSQL `length()` counts them. */
function isBoundedText(value: unknown, max: number): value is string {
  return isBoundedString(value, 2 * max) && Array.from(value).length <= max;
}

type Parsed = { raw: string; key: string | null; at: unknown };

/** One page, checked whole before any entry is counted; throws `Halt` (side set by the caller). */
function checkPage(
  page: unknown,
  parse: (entry: unknown) => Parsed | null,
  pageSize: number,
  after: string | null,
): { entries: Entry[]; next: string | null; last: string | null } {
  if (isPlainObject(page) && page.status === "unavailable") throw new Halt("unavailable", "storage");
  if (
    !isPlainObject(page) ||
    page.status !== "ok" ||
    !Array.isArray(page.entries) ||
    page.entries.length > pageSize ||
    !(page.next === null || isBoundedString(page.next, MAX_CURSOR_LENGTH))
  ) {
    throw new Halt("malformed", "storage");
  }
  const entries: Entry[] = [];
  let last = after;
  for (const raw of page.entries as readonly unknown[]) {
    const entry = parse(raw);
    // Strictly ascending across pages: a repeat or a step back is malformed.
    if (entry === null || (last !== null && byteOrder(last, entry.raw) >= 0)) {
      throw new Halt("malformed", "storage");
    }
    last = entry.raw;
    entries.push({ key: entry.key, at: entry.at });
  }
  return { entries, next: page.next, last };
}

/**
 * Reads one side page by page and yields its entries, checked: a page of at
 * most `pageSize` entries, each well formed and strictly after the one before
 * on any page, and at most `maxPages` pages.
 */
async function* scan(
  side: Side,
  read: (request: ScanPageRequest) => Promise<ScanPage<unknown>>,
  parse: (entry: unknown) => Parsed | null,
  input: CountStorageOrphansInput,
  pages: Record<Side, number>,
): AsyncGenerator<Entry> {
  let cursor: string | null = null;
  let last: string | null = null;
  for (;;) {
    let page: unknown;
    try {
      page = await read({ storageDomain: input.storageDomain, cursor, pageSize: input.pageSize });
    } catch {
      throw new Halt("unavailable", side);
    }
    pages[side] += 1;
    let checked: ReturnType<typeof checkPage>;
    try {
      checked = checkPage(page, parse, input.pageSize, last);
    } catch (error) {
      throw error instanceof Halt ? new Halt(error.status, side) : new Halt("malformed", side);
    }
    last = checked.last;
    const next = checked.next;
    yield* checked.entries;
    if (next === null) return;
    if (pages[side] >= input.maxPages) throw new Halt("page_limit", side);
    cursor = next;
  }
}

function parseObject(entry: unknown) {
  if (!isPlainObject(entry) || !isBoundedString(entry.key, MAX_KEY_LENGTH)) return null;
  // A time that is missing or cannot be read makes the entry young, never malformed.
  return { raw: entry.key, key: evidenceKeyInPrefix(entry.key), at: entry.lastModified };
}

function parseReference(domain: string) {
  const prefix = `${domain}:`;
  return (entry: unknown) => {
    if (!isPlainObject(entry) || !isBoundedText(entry.storageRef, MAX_REF_LENGTH)) return null;
    const ref = entry.storageRef;
    const key = ref.startsWith(prefix) ? evidenceKeyInPrefix(ref.slice(prefix.length)) : null;
    return { raw: ref, key, at: entry.acceptedAt };
  };
}

/** A time a `Date` can print (ECMAScript keeps 8.64e15 ms either side of the epoch). */
function isClockTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 8.64e15;
}

/** A nonzero fraction digit after the milliseconds; the instant is already strict ISO. */
const SUB_MILLISECOND_REMAINDER = /\.\d{3}\d*[1-9]/;

function checkInput(input: CountStorageOrphansInput): number {
  const inRange = (v: unknown, min: number, max: number) =>
    Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
  if (
    !isStorageDomainLabel(input.storageDomain) ||
    !inRange(input.thresholdMs, MIN_ORPHAN_THRESHOLD_MS, MAX_ORPHAN_THRESHOLD_MS) ||
    !inRange(input.pageSize, 1, MAX_SCAN_PAGE_SIZE) ||
    !inRange(input.maxPages, 1, Number.MAX_SAFE_INTEGER) ||
    typeof input.now !== "function"
  ) {
    throw new TypeError("storage orphan scan configuration is not valid");
  }
  const startedAt = input.now();
  if (!isClockTime(startedAt)) throw new TypeError("storage orphan scan clock is not valid");
  return startedAt;
}

/**
 * One pass over one storage domain: a merge of the store listing and the
 * references, both in ascending order. Reads only; writes nothing to the
 * store. An unpaired entry stamped after `startedAt - thresholdMs`, or whose
 * time cannot be read, is young and never an orphan: a payload stored or
 * reserved while the pass runs is always young (B-8 commit+reserve).
 */
export async function countStorageOrphans(input: CountStorageOrphansInput): Promise<CountStorageOrphansResult> {
  const startedAt = checkInput(input);
  const cutoff = startedAt - input.thresholdMs;
  const isYoung = (at: unknown) => {
    const t = parseInstant(at);
    if (Number.isNaN(t)) return true;
    if (t !== cutoff) return t > cutoff;
    // parseInstant keeps whole milliseconds; a stamp past the cutoff by less
    // than one (a nonzero digit after the third fraction digit) is still young.
    return SUB_MILLISECOND_REMAINDER.test(at as string);
  };
  const pages: Record<Side, number> = { storage: 0, references: 0 };
  const counts: Counts = {
    paired: 0,
    objectsWithoutReference: 0,
    referencesWithoutObject: 0,
    youngObjectsWithoutReference: 0,
    youngReferencesWithoutObject: 0,
    objectsOutsidePrefix: 0,
    referencesOutsidePrefix: 0,
  };

  // Only keys in the evidence form take part in the merge; the rest are counted apart.
  async function* evidenceOnly(source: AsyncGenerator<Entry>, side: Side) {
    for await (const entry of source) {
      if (entry.key !== null) yield { key: entry.key, at: entry.at };
      else if (side === "storage") counts.objectsOutsidePrefix += 1;
      else counts.referencesOutsidePrefix += 1;
    }
  }

  let status: StorageOrphanScanSummary["status"] = "completed";
  let stoppedAt: Side | null = null;
  try {
    const objects = evidenceOnly(scan("storage", (r) => input.store.listKeys(r), parseObject, input, pages), "storage");
    const refs = evidenceOnly(
      scan("references", (r) => input.references.listReferences(r), parseReference(input.storageDomain), input, pages),
      "references",
    );
    let o = await objects.next();
    let r = await refs.next();
    while (!o.done || !r.done) {
      const order = o.done ? 1 : r.done ? -1 : byteOrder(o.value.key, r.value.key);
      if (order === 0) {
        counts.paired += 1;
        o = await objects.next();
        r = await refs.next();
      } else if (order < 0) {
        const value = o.value!;
        counts[isYoung(value.at) ? "youngObjectsWithoutReference" : "objectsWithoutReference"] += 1;
        o = await objects.next();
      } else {
        const value = r.value!;
        counts[isYoung(value.at) ? "youngReferencesWithoutObject" : "referencesWithoutObject"] += 1;
        r = await refs.next();
      }
    }
  } catch (error) {
    // Anything else that stops the pass is still audited, as unavailable.
    status = error instanceof Halt ? error.status : "unavailable";
    stoppedAt = error instanceof Halt ? error.side : null;
  }
  let finishedAt = startedAt;
  try {
    const end = input.now();
    // A clock that stepped back never gives an end before the start.
    if (isClockTime(end) && end > startedAt) finishedAt = end;
  } catch {
    // The start time stands in for an end time the clock could not give.
  }

  const summary: StorageOrphanScanSummary = {
    storageDomain: input.storageDomain,
    status,
    stoppedAt,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    thresholdMs: input.thresholdMs,
    pages: { ...pages },
    counts: status === "completed" ? counts : null,
  };
  let audit: CountStorageOrphansResult["audit"] = "unavailable";
  try {
    const recorded = await input.audit.record(summary);
    if (isPlainObject(recorded) && recorded.status === "recorded") audit = "recorded";
  } catch {
    audit = "unavailable";
  }
  return { summary, audit };
}
