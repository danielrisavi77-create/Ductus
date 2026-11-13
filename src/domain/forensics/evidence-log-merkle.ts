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

// The built-in %TypedArray% getters read an array's internal slots, so an
// object that only borrows Uint8Array.prototype, a Proxy or an own `length`
// property cannot pass for a 32-byte hash.
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayTag = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)!.get!;
const typedArrayLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "length",
)!.get!;

/**
 * A private 32-byte copy of a hash, or null. Only a real Uint8Array of 32
 * bytes is copied, and its length is read before the copy is made.
 */
function hashCopy(value: unknown): Uint8Array | null {
  if (typedArrayTag.call(value) !== "Uint8Array") return null;
  if (typedArrayLength.call(value) !== EVIDENCE_LOG_HASH_BYTES) return null;
  return new Uint8Array(value as Uint8Array);
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
  const copy = hashCopy(digest);
  if (copy === null) {
    throw new Error("evidence-log: a receipt digest must be 32 bytes");
  }
  return sha256(LEAF_PREFIX, copy);
}

/** Copies of the leaf hashes; a hole in a sparse list is a missing hash. */
function leafCopies(leafHashes: readonly Uint8Array[]): Uint8Array[] {
  if (!Array.isArray(leafHashes)) {
    throw new Error("evidence-log: leaf hashes must be a list");
  }
  return Array.from(leafHashes as readonly unknown[], (value) => {
    const copy = hashCopy(value);
    if (copy === null) {
      throw new Error("evidence-log: every leaf hash must be 32 bytes");
    }
    return copy;
  });
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
  if (end - start === 1) return leaves[start]!;
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
  const leaves = leafCopies(leafHashes);
  if (leaves.length === 0) return sha256(null);
  return subtreeRoot(leaves, 0, leaves.length);
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
  const leaves = leafCopies(leafHashes);
  if (!Number.isSafeInteger(index) || index < 0 || index >= leaves.length) {
    throw new Error("evidence-log: the leaf index is outside the tree");
  }
  const proof: Uint8Array[] = [];
  await collectPath(leaves, index, 0, leaves.length, proof);
  return proof;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i]! ^ right[i]!;
  return difference === 0;
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
  if (!Array.isArray(proof)) return false;
  // An index loop over a numeric length read once, not the list's own
  // iterator, so no proof is read past MAX_PROOF_LENGTH elements.
  const length: unknown = proof.length;
  if (typeof length !== "number" || length > MAX_PROOF_LENGTH) return false;
  const path: (Uint8Array | null)[] = [];
  for (let i = 0; i < length; i += 1) path.push(hashCopy(proof[i]));

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
 * Checks an inclusion proof (§2.1.3.2). The result means "this leaf is in
 * the tree with this root" only when the caller supplies two things itself:
 * `treeSize` from the signed checkpoint, never from the proof's sender, and
 * `leafHash` computed with `evidenceLogLeafHash(D)` from the record D. With
 * a free size, the same proof also fits other indexes and sizes with the
 * same left/right path, and an inner node can pass as a leaf.
 *
 * A malformed input of any kind,
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
  // Array.from, not map: a hole in a sparse list is an entry to reject.
  const keyed = Array.from(entries, (entry: T) => {
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
