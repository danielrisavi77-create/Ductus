import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import {
  evidenceLogInclusionProof,
  evidenceLogLeafHash,
  evidenceLogRoot,
  orderEvidenceLogEntries,
  verifyEvidenceLogInclusion,
} from "./evidence-log-merkle";

/**
 * Property tests for the per-domain receipt log tree (DAN-391, plan #1988):
 * an honest proof passes for every leaf of every tree up to 64 leaves, and
 * any change to the leaf, the proof, the root, the index, the size or the
 * order of the leaves makes it fail. Every digest and id is generated.
 */

const digest = fc.uint8Array({ minLength: 32, maxLength: 32 });

/** Distinct digests, so that no two leaves of one tree are equal. */
const digests = fc.uniqueArray(digest, {
  minLength: 1,
  maxLength: 64,
  selector: (bytes) => Buffer.from(bytes).toString("hex"),
});

async function honestTree(leafDigests: Uint8Array[], pick: number) {
  const leaves = await Promise.all(
    leafDigests.map((d) => evidenceLogLeafHash(d)),
  );
  const index = pick % leaves.length;
  return {
    leaves,
    input: {
      leafHash: leaves[index]!,
      index,
      treeSize: leaves.length,
      proof: await evidenceLogInclusionProof(leaves, index),
      root: await evidenceLogRoot(leaves),
    },
  };
}

/**
 * Independent model of the proof shape: for each proof element, from the leaf
 * up, whether the sibling is on the left or the right (PATH, §2.1.3.1).
 */
function pathSides(index: number, size: number): ("L" | "R")[] {
  if (size === 1) return [];
  let k = 1;
  while (k * 2 < size) k *= 2;
  return index < k
    ? [...pathSides(index, k), "R"]
    : [...pathSides(index - k, size - k), "L"];
}

function flipBit(bytes: Uint8Array, bit: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  copy[(bit >> 3) % copy.length]! ^= 1 << (bit & 7);
  return copy;
}

describe("inclusion proof", () => {
  test.prop([digests])(
    "passes for every leaf of the tree",
    async (leafDigests) => {
      const { leaves, input } = await honestTree(leafDigests, 0);
      for (let index = 0; index < leaves.length; index += 1) {
        const proof = await evidenceLogInclusionProof(leaves, index);
        expect(
          await verifyEvidenceLogInclusion({
            ...input,
            leafHash: leaves[index]!,
            index,
            proof,
          }),
        ).toBe(true);
      }
    },
  );

  test.prop([digests, fc.nat(), fc.nat(255)])(
    "fails for any bit changed in the leaf",
    async (d, pick, bit) => {
      const { input } = await honestTree(d, pick);
      expect(
        await verifyEvidenceLogInclusion({
          ...input,
          leafHash: flipBit(input.leafHash, bit),
        }),
      ).toBe(false);
    },
  );

  test.prop([digests, fc.nat(), fc.nat(255)])(
    "fails for any bit changed in the root",
    async (d, pick, bit) => {
      const { input } = await honestTree(d, pick);
      expect(
        await verifyEvidenceLogInclusion({
          ...input,
          root: flipBit(input.root, bit),
        }),
      ).toBe(false);
    },
  );

  test.prop([
    digests.filter((d) => d.length > 1),
    fc.nat(),
    fc.nat(),
    fc.nat(255),
  ])(
    "fails for any bit changed in any proof element",
    async (d, pick, element, bit) => {
      const { input } = await honestTree(d, pick);
      const at = element % input.proof.length;
      const proof = input.proof.map((p, i) => (i === at ? flipBit(p, bit) : p));
      expect(await verifyEvidenceLogInclusion({ ...input, proof })).toBe(false);
    },
  );

  test.prop([digests.filter((d) => d.length > 1), fc.nat(), fc.nat()])(
    "fails for another index of the same tree",
    async (d, pick, other) => {
      const { leaves, input } = await honestTree(d, pick);
      const index =
        (input.index + 1 + (other % (leaves.length - 1))) % leaves.length;
      expect(await verifyEvidenceLogInclusion({ ...input, index })).toBe(false);
    },
  );

  test.prop([digests, fc.nat(), fc.integer({ min: 1, max: 128 })])(
    "passes for another tree size exactly when the path has the same shape",
    async (d, pick, treeSize) => {
      const { input } = await honestTree(d, pick);
      fc.pre(treeSize !== input.treeSize);
      // RFC 9162 binds the size through the signed checkpoint, not through the
      // proof: a size whose path has the same sides is not caught here.
      const same =
        input.index < treeSize &&
        pathSides(input.index, treeSize).join() ===
          pathSides(input.index, input.treeSize).join();
      expect(await verifyEvidenceLogInclusion({ ...input, treeSize })).toBe(
        same,
      );
    },
  );

  test.prop([digests.filter((d) => d.length > 1), fc.nat(), fc.nat()])(
    "fails against the root of the leaves in another order",
    async (d, pick, shift) => {
      const { leaves, input } = await honestTree(d, pick);
      // A rotation that is not the identity: every leaf moves.
      const by = 1 + (shift % (leaves.length - 1));
      const rotated = [...leaves.slice(by), ...leaves.slice(0, by)];
      const root = await evidenceLogRoot(rotated);
      expect(await verifyEvidenceLogInclusion({ ...input, root })).toBe(false);
    },
  );
});

describe("leaf order", () => {
  const FIRST_MS = Date.parse("2026-01-01T00:00:00.000Z");
  const entry = fc.record({
    // Few distinct times, so that ties on acceptedAt are common.
    acceptedAt: fc
      .integer({ min: 0, max: 5 })
      .map((n) => new Date(FIRST_MS + n * 60_000).toISOString()),
    receiptId: fc.string({ unit: "grapheme", minLength: 1, maxLength: 4 }),
  });
  const entries = fc.uniqueArray(entry, {
    maxLength: 40,
    selector: (e) => e.receiptId,
  });

  const utf8 = (value: string) => [...new TextEncoder().encode(value)];
  function utf8Before(a: string, b: string): boolean {
    const [x, y] = [utf8(a), utf8(b)];
    for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
      if (x[i] !== y[i]) return x[i]! < y[i]!;
    }
    return x.length < y.length;
  }

  test.prop([entries, fc.nat()])(
    "does not depend on the order of the input",
    (list, seed) => {
      const shuffled = fc.sample(
        fc.shuffledSubarray(list, { minLength: list.length }),
        { numRuns: 1, seed },
      )[0]!;
      expect(orderEvidenceLogEntries(shuffled)).toEqual(
        orderEvidenceLogEntries(list),
      );
    },
  );

  test.prop([entries])(
    "is ascending by time, then by UTF-8 bytes of the receipt id",
    (list) => {
      const ordered = orderEvidenceLogEntries(list);
      expect(ordered).toHaveLength(list.length);
      for (let i = 1; i < ordered.length; i += 1) {
        const [prev, next] = [ordered[i - 1]!, ordered[i]!];
        const [tp, tn] = [
          Date.parse(prev.acceptedAt),
          Date.parse(next.acceptedAt),
        ];
        expect(
          tp < tn || (tp === tn && utf8Before(prev.receiptId, next.receiptId)),
        ).toBe(true);
      }
    },
  );
});
