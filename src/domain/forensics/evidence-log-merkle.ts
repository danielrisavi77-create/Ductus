import { canonicalInstant } from "./evidence-receipt";

/**
 * Merkle tree of one domain's receipt log (D-93, RFC 9162 §2.1). Pure
 * functions, no I/O: the daily root, the inclusion proof for one receipt and
 * the check of that proof.
 *
 * - leaf: SHA-256(0x00 ‖ D), where D is the 32-byte receipt digest (D-92);
 * - inner node: SHA-256(0x01 ‖ left ‖ right), split at the largest power of
 *   two below the size, so the last leaf of an odd tree is never duplicated;
 * - empty tree: SHA-256 of no bytes;
 * - leaf order: acceptance time ascending, then the UTF-8 bytes of receiptId.
 *
 * The older `crypto.ts` tree (DAN-302) has neither prefix and duplicates the
 * last leaf; it stays as it is and nothing here builds on it.
 */

export const EVIDENCE_LOG_HASH_BYTES = 32;

/** The longest proof any safe tree size can have (a size below 2^53). */
const MAX_PROOF_LENGTH = 53;

const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;

export type EvidenceLogInclusion = {
  leafHash: Uint8Array;
  index: number;
  treeSize: number;
  proof: readonly Uint8Array[];
  root: Uint8Array;
};

export type EvidenceLogEntryKey = { acceptedAt: string; receiptId: string };

function isHash(value: unknown): value is Uint8Array {
  return (
    value instanceof Uint8Array && value.length === EVIDENCE_LOG_HASH_BYTES
  );
}

async function sha256(
  prefix: number | null,
  ...parts: Uint8Array[]
): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("evidence-log: Web Crypto unavailable");
  }
  const head = prefix === null ? 0 : 1;
  const input = new Uint8Array(
    head + parts.reduce((sum, part) => sum + part.length, 0),
  );
  if (prefix !== null) input[0] = prefix;
  let offset = head;
  for (const part of parts) {
    input.set(part, offset);
    offset += part.length;
  }
  return new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", input),
  );
}

const hashNode = (left: Uint8Array, right: Uint8Array) =>
  sha256(NODE_PREFIX, left, right);

/** The leaf hash of one receipt digest D; D must be exactly 32 bytes. */
export async function evidenceLogLeafHash(
  digest: Uint8Array,
): Promise<Uint8Array> {
  if (!isHash(digest)) {
    throw new Error("evidence-log: a receipt digest must be 32 bytes");
  }
  return sha256(LEAF_PREFIX, digest);
}

function checkLeafHashes(leafHashes: readonly Uint8Array[]): void {
  if (!Array.isArray(leafHashes) || !leafHashes.every(isHash)) {
    throw new Error("evidence-log: every leaf hash must be 32 bytes");
  }
}

/** The largest power of two strictly below n (n ≥ 2). */
function splitPoint(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

async function subtreeRoot(
  leaves: readonly Uint8Array[],
  start: number,
  end: number,
): Promise<Uint8Array> {
  if (end - start === 1) return new Uint8Array(leaves[start]!);
  const middle = start + splitPoint(end - start);
  return hashNode(
    await subtreeRoot(leaves, start, middle),
    await subtreeRoot(leaves, middle, end),
  );
}

/** The tree root over leaf hashes already in log order (MTH, §2.1.1). */
export async function evidenceLogRoot(
  leafHashes: readonly Uint8Array[],
): Promise<Uint8Array> {
  checkLeafHashes(leafHashes);
  if (leafHashes.length === 0) return sha256(null);
  return subtreeRoot(leafHashes, 0, leafHashes.length);
}

async function collectPath(
  leaves: readonly Uint8Array[],
  index: number,
  start: number,
  end: number,
  out: Uint8Array[],
): Promise<void> {
  if (end - start === 1) return;
  const middle = start + splitPoint(end - start);
  if (index < middle) {
    await collectPath(leaves, index, start, middle, out);
    out.push(await subtreeRoot(leaves, middle, end));
  } else {
    await collectPath(leaves, index, middle, end, out);
    out.push(await subtreeRoot(leaves, start, middle));
  }
}

/** The inclusion proof of the leaf at `index` (PATH, §2.1.3.1), leaf side first. */
export async function evidenceLogInclusionProof(
  leafHashes: readonly Uint8Array[],
  index: number,
): Promise<Uint8Array[]> {
  checkLeafHashes(leafHashes);
  if (!Number.isSafeInteger(index) || index < 0 || index >= leafHashes.length) {
    throw new Error("evidence-log: the leaf index is outside the tree");
  }
  const proof: Uint8Array[] = [];
  await collectPath(leafHashes, index, 0, leafHashes.length, proof);
  return proof;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i]! ^ right[i]!;
  return difference === 0;
}

/** A private 32-byte copy of a hash, or null; the copy keeps its real length. */
function hashCopy(value: unknown): Uint8Array | null {
  if (!(value instanceof Uint8Array)) return null;
  const copy = new Uint8Array(value);
  return copy.length === EVIDENCE_LOG_HASH_BYTES ? copy : null;
}

async function checkInclusion(input: unknown): Promise<boolean> {
  if (typeof input !== "object" || input === null) return false;
  const { leafHash, index, treeSize, proof, root } = input as Partial<
    Record<keyof EvidenceLogInclusion, unknown>
  >;
  if (!Number.isSafeInteger(index) || (index as number) < 0) return false;
  if (
    !Number.isSafeInteger(treeSize) ||
    (treeSize as number) <= (index as number)
  ) {
    return false;
  }
  const leaf = hashCopy(leafHash);
  const expected = hashCopy(root);
  if (leaf === null || expected === null) return false;
  if (!Array.isArray(proof) || proof.length > MAX_PROOF_LENGTH) return false;
  const path = Array.from(proof as readonly unknown[], hashCopy);

  let fn = index as number;
  let sn = (treeSize as number) - 1;
  let r = leaf;
  for (const element of path) {
    if (sn === 0 || element === null) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = await hashNode(element, r);
      while (fn % 2 === 0 && fn !== 0) {
        fn = Math.floor(fn / 2);
        sn = Math.floor(sn / 2);
      }
    } else {
      r = await hashNode(r, element);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && sameBytes(r, expected);
}

/**
 * Checks an inclusion proof (§2.1.3.2). A malformed input of any kind,
 * including a getter or list that throws, is a failed check, never an
 * exception; only missing Web Crypto throws. The hashes are copied once at
 * the start, so a caller changing them while the check runs changes nothing.
 * Halving uses division, not bit shifts, so sizes above 2^32 stay exact.
 */
export async function verifyEvidenceLogInclusion(
  input: EvidenceLogInclusion,
): Promise<boolean> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("evidence-log: Web Crypto unavailable");
  }
  try {
    return await checkInclusion(input);
  } catch {
    return false;
  }
}

/** A high surrogate without a low one after it, or a low one without a high one before it. */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  }
  return left.length - right.length;
}

/**
 * Puts log entries in leaf order (D-93): canonical UTC `acceptedAt` ascending
 * by time value (a v1 millisecond instant and a v2 whole minute compare
 * correctly), then the UTF-8 bytes of `receiptId`. Throws on a non-canonical
 * time, an empty or malformed receipt id, or a receipt id seen twice, since
 * any of these would make the order, and so the root, ambiguous.
 */
export function orderEvidenceLogEntries<T extends EvidenceLogEntryKey>(
  entries: readonly T[],
): T[] {
  if (!Array.isArray(entries)) {
    throw new Error("evidence-log: entries must be a list");
  }
  const encoder = new TextEncoder();
  const seen = new Set<string>();
  const keyed = entries.map((entry: T) => {
    const { acceptedAt, receiptId } = (entry ?? {}) as Partial<
      Record<keyof EvidenceLogEntryKey, unknown>
    >;
    if (!canonicalInstant(acceptedAt)) {
      throw new Error(
        "evidence-log: acceptedAt must be a canonical UTC instant",
      );
    }
    if (
      typeof receiptId !== "string" ||
      receiptId === "" ||
      LONE_SURROGATE.test(receiptId)
    ) {
      throw new Error(
        "evidence-log: receiptId must be a non-empty well-formed string",
      );
    }
    if (seen.has(receiptId)) {
      throw new Error("evidence-log: duplicate receiptId");
    }
    seen.add(receiptId);
    return {
      entry,
      time: Date.parse(acceptedAt),
      id: encoder.encode(receiptId),
    };
  });
  keyed.sort((a, b) => a.time - b.time || compareBytes(a.id, b.id));
  return keyed.map(({ entry }) => entry);
}
