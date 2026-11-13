import { describe, expect, it } from "vitest";

import {
  evidenceLogInclusionProof,
  evidenceLogLeafHash,
  evidenceLogRoot,
  orderEvidenceLogEntries,
  verifyEvidenceLogInclusion,
} from "./evidence-log-merkle";

/**
 * Table tests for the per-domain receipt log tree (DAN-391, plan #1988):
 * RFC 9162 §2.1 hashing, the inclusion proof and its check, and the order of
 * the leaves (D-93). Every identifier below is invented.
 */

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const fromHex = (value: string) => new Uint8Array(Buffer.from(value, "hex"));

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
  );
}

/**
 * The RFC 6962 reference leaves (certificate-transparency `merkle_tree_test`).
 * They are not 32 bytes long, so their leaf hashes are made here; the tree
 * and the proof take leaf hashes and are checked against the reference roots.
 */
const RFC6962_LEAVES = [
  "",
  "00",
  "10",
  "2021",
  "3031",
  "40414243",
  "5051525354555657",
  "606162636465666768696a6b6c6d6e6f",
];
const RFC6962_ROOTS = [
  "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
  "fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125",
  "aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77",
  "d37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7",
  "4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4",
  "76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef",
  "ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c",
  "5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328",
];
const RFC6962_PATHS: { index: number; size: number; path: string[] }[] = [
  {
    index: 0,
    size: 8,
    path: [
      "96a296d224f285c67bee93c30f8a309157f0daa35dc5b87e410b78630a09cfc7",
      "5f083f0a1a33ca076a95279832580db3e0ef4584bdff1f54c8a360f50de3031e",
      "6b47aaf29ee3c2af9af889bc1fb9254dabd31177f16232dd6aab035ca39bf6e4",
    ],
  },
  {
    index: 5,
    size: 8,
    path: [
      "bc1a0643b12e4d2d7c77918f44e0f4f79a838b6cf9ec5b5c283e1f4d88599e6b",
      "ca854ea128ed050b41b35ffc1b87b8eb2bde461e9e3b5596ece6b9d5975a0ae0",
      "d37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7",
    ],
  },
  {
    index: 2,
    size: 3,
    path: ["fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125"],
  },
  {
    index: 1,
    size: 5,
    path: [
      "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
      "5f083f0a1a33ca076a95279832580db3e0ef4584bdff1f54c8a360f50de3031e",
      "bc1a0643b12e4d2d7c77918f44e0f4f79a838b6cf9ec5b5c283e1f4d88599e6b",
    ],
  },
];

async function referenceLeafHashes(): Promise<Uint8Array[]> {
  return Promise.all(
    RFC6962_LEAVES.map((leaf) => sha256(Uint8Array.of(0, ...fromHex(leaf)))),
  );
}

const bytes32 = (fill: number) => new Uint8Array(32).fill(fill);

/**
 * An object that borrows Uint8Array.prototype but is no byte array: it passes
 * `instanceof` and yields up to 1000 values, counting each one read.
 */
function forgedHash() {
  const forged = {
    yielded: 0,
    *[Symbol.iterator]() {
      for (let i = 0; i < 1000; i += 1) {
        forged.yielded += 1;
        yield 0;
      }
    },
  };
  Object.setPrototypeOf(forged, Uint8Array.prototype);
  return forged as unknown as Uint8Array & { yielded: number };
}

describe("leaf hash", () => {
  it("is SHA-256 over 0x00 and the 32 digest bytes", async () => {
    expect(hex(await evidenceLogLeafHash(new Uint8Array(32)))).toBe(
      "7f9c9e31ac8256ca2f258583df262dbc7d6f68f2a03043d5c99a4ae5a7396ce9",
    );
    expect(
      hex(
        await evidenceLogLeafHash(Uint8Array.from({ length: 32 }, (_, i) => i)),
      ),
    ).toBe("699cacdb4c39d8e0bb1223352765a7f7acdc51dec6694f7b54c3d0a47f0cc409");
  });

  it.each([0, 31, 33, 64])("refuses a digest of %i bytes", async (length) => {
    await expect(evidenceLogLeafHash(new Uint8Array(length))).rejects.toThrow(
      /32 bytes/,
    );
  });

  it("refuses a digest that is not a byte array", async () => {
    await expect(
      evidenceLogLeafHash([...bytes32(1)] as unknown as Uint8Array),
    ).rejects.toThrow(/32 bytes/);
  });

  it("separates a leaf from an inner node over the same bytes", async () => {
    const digest = Uint8Array.from({ length: 32 }, (_, i) => i);
    const leaf = hex(await evidenceLogLeafHash(digest));
    // The same 32 bytes hashed under the inner-node prefix and with no prefix.
    const asNode = hex(await sha256(Uint8Array.of(0x01, ...digest)));
    expect(leaf).toBe(hex(await sha256(Uint8Array.of(0x00, ...digest))));
    expect(leaf).not.toBe(asNode);
    expect(leaf).not.toBe(hex(await sha256(digest)));
  });
});

describe("tree root", () => {
  it("of the empty tree is SHA-256 of nothing", async () => {
    expect(hex(await evidenceLogRoot([]))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it.each(RFC6962_ROOTS.map((root, i) => [i + 1, root] as const))(
    "matches the RFC 6962 reference root for %i leaves",
    async (size, root) => {
      const leaves = await referenceLeafHashes();
      expect(hex(await evidenceLogRoot(leaves.slice(0, size)))).toBe(root);
    },
  );

  it("of one leaf is the leaf hash itself", async () => {
    const leaf = await evidenceLogLeafHash(bytes32(7));
    expect(hex(await evidenceLogRoot([leaf]))).toBe(hex(leaf));
  });

  it("does not duplicate the last leaf of an odd tree", async () => {
    const [a, b, c] = await Promise.all(
      [1, 2, 3].map((n) => evidenceLogLeafHash(bytes32(n))),
    );
    const three = hex(await evidenceLogRoot([a!, b!, c!]));
    expect(three).not.toBe(hex(await evidenceLogRoot([a!, b!, c!, c!])));
  });

  it.each([0, 31, 33])("refuses a leaf hash of %i bytes", async (length) => {
    const good = bytes32(1);
    await expect(
      evidenceLogRoot([good, new Uint8Array(length)]),
    ).rejects.toThrow(/32 bytes/);
  });

  it("refuses a hole in a sparse list and a hash whose length lies", async () => {
    const sparse: Uint8Array[] = [];
    sparse[1] = bytes32(1);
    await expect(evidenceLogRoot(sparse)).rejects.toThrow(/32 bytes/);
    await expect(evidenceLogInclusionProof(sparse, 1)).rejects.toThrow(
      /32 bytes/,
    );
    const short = new Uint8Array(31);
    Object.defineProperty(short, "length", { value: 32 });
    await expect(evidenceLogLeafHash(short)).rejects.toThrow(/32 bytes/);
    await expect(evidenceLogRoot([bytes32(1), short])).rejects.toThrow(
      /32 bytes/,
    );
  });

  it("refuses an object that only borrows the Uint8Array prototype, without reading it", async () => {
    const forged = forgedHash();
    expect(forged instanceof Uint8Array).toBe(true);
    await expect(evidenceLogLeafHash(forged)).rejects.toThrow(/32 bytes/);
    await expect(evidenceLogRoot([bytes32(1), forged])).rejects.toThrow(
      /32 bytes/,
    );
    await expect(evidenceLogInclusionProof([forged], 0)).rejects.toThrow(
      /32 bytes/,
    );
    expect(forged.yielded).toBe(0);
  });

  it("does not change the caller's leaf hashes", async () => {
    const leaves = await referenceLeafHashes();
    const copy = leaves.map((leaf) => hex(leaf));
    await evidenceLogRoot(leaves);
    expect(leaves.map((leaf) => hex(leaf))).toEqual(copy);
  });
});

describe("inclusion proof", () => {
  it.each(RFC6962_PATHS)(
    "matches the RFC 6962 reference path for leaf $index of $size",
    async (row) => {
      const leaves = (await referenceLeafHashes()).slice(0, row.size);
      const proof = await evidenceLogInclusionProof(leaves, row.index);
      expect(proof.map(hex)).toEqual(row.path);
    },
  );

  it("is empty for the only leaf of a one-leaf tree", async () => {
    const leaves = (await referenceLeafHashes()).slice(0, 1);
    expect(await evidenceLogInclusionProof(leaves, 0)).toEqual([]);
  });

  it.each([-1, 3, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses index %s of a three-leaf tree",
    async (index) => {
      const leaves = (await referenceLeafHashes()).slice(0, 3);
      await expect(evidenceLogInclusionProof(leaves, index)).rejects.toThrow(
        /index/,
      );
    },
  );

  it("refuses any index of the empty tree", async () => {
    await expect(evidenceLogInclusionProof([], 0)).rejects.toThrow(/index/);
  });

  it("verifies for every leaf of every reference tree", async () => {
    const all = await referenceLeafHashes();
    for (let size = 1; size <= all.length; size += 1) {
      const leaves = all.slice(0, size);
      const root = await evidenceLogRoot(leaves);
      for (let index = 0; index < size; index += 1) {
        const proof = await evidenceLogInclusionProof(leaves, index);
        await expect(
          verifyEvidenceLogInclusion({
            leafHash: leaves[index]!,
            index,
            treeSize: size,
            proof,
            root,
          }),
        ).resolves.toBe(true);
      }
    }
  });
});

describe("inclusion check refuses without throwing", () => {
  async function honest(size = 5, index = 1) {
    const leaves = (await referenceLeafHashes()).slice(0, size);
    return {
      leafHash: leaves[index]!,
      index,
      treeSize: size,
      proof: await evidenceLogInclusionProof(leaves, index),
      root: await evidenceLogRoot(leaves),
    };
  }

  it.each<[string, unknown]>([
    ["negative", -1],
    ["fraction", 1.5],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
    ["not safe", 2 ** 53],
    ["a string", "1"],
  ])("an index that is %s (V2)", async (_, index) => {
    const input = await honest();
    await expect(
      verifyEvidenceLogInclusion({ ...input, index } as never),
    ).resolves.toBe(false);
  });

  it.each<[string, unknown]>([
    ["zero", 0],
    ["equal to the index", 1],
    ["below the index", 0.5],
    ["not safe", 2 ** 53],
    ["a string", "5"],
  ])("a tree size that is %s (V3)", async (_, treeSize) => {
    const input = await honest();
    await expect(
      verifyEvidenceLogInclusion({ ...input, treeSize } as never),
    ).resolves.toBe(false);
  });

  it.each([0, 31, 33])(
    "a leaf, root or proof element of %i bytes (V4)",
    async (length) => {
      const input = await honest();
      const wrong = new Uint8Array(length);
      await expect(
        verifyEvidenceLogInclusion({ ...input, leafHash: wrong }),
      ).resolves.toBe(false);
      await expect(
        verifyEvidenceLogInclusion({ ...input, root: wrong }),
      ).resolves.toBe(false);
      await expect(
        verifyEvidenceLogInclusion({
          ...input,
          proof: [wrong, ...input.proof.slice(1)],
        }),
      ).resolves.toBe(false);
    },
  );

  it("values that are not byte arrays (V4)", async () => {
    const input = await honest();
    const plain = [...input.leafHash];
    for (const patch of [
      { leafHash: plain },
      { root: plain },
      { proof: [plain, ...input.proof.slice(1)] },
    ]) {
      await expect(
        verifyEvidenceLogInclusion({ ...input, ...patch } as never),
      ).resolves.toBe(false);
    }
    await expect(verifyEvidenceLogInclusion(null as never)).resolves.toBe(
      false,
    );
  });

  it("a proof that is short, long, changed, reordered or not a list (V5)", async () => {
    const input = await honest();
    const [first, second, third] = input.proof;
    const flipped = new Uint8Array(second!);
    flipped[31]! ^= 1;
    for (const proof of [
      [first!, second!],
      [first!, second!, third!, third!],
      [first!, flipped, third!],
      [second!, first!, third!],
      [],
      "proof",
    ]) {
      await expect(
        verifyEvidenceLogInclusion({ ...input, proof } as never),
      ).resolves.toBe(false);
    }
  });

  it("an input whose getter or proof list throws (V4, V5)", async () => {
    const input = await honest();
    const boom = () => {
      throw new Error("hostile getter");
    };
    for (const key of ["leafHash", "index", "treeSize", "proof", "root"]) {
      const hostile = { ...input };
      Object.defineProperty(hostile, key, { get: boom });
      await expect(verifyEvidenceLogInclusion(hostile)).resolves.toBe(false);
    }
    // Throws on reading any element, through the iterator or by index.
    const throwingList = new Proxy([...input.proof], {
      get: (target, key) =>
        key === Symbol.iterator ||
        (typeof key === "string" && /^\d+$/.test(key))
          ? boom()
          : Reflect.get(target, key),
    });
    await expect(
      verifyEvidenceLogInclusion({ ...input, proof: throwingList }),
    ).resolves.toBe(false);
  });

  it("a hash whose length property lies (V4)", async () => {
    const input = await honest();
    const short = new Uint8Array(input.leafHash.subarray(0, 31));
    Object.defineProperty(short, "length", { value: 32 });
    await expect(
      verifyEvidenceLogInclusion({ ...input, leafHash: short }),
    ).resolves.toBe(false);
  });

  it("reads a proof by index up to its length, never through its own iterator (V5)", async () => {
    const input = await honest();
    let yielded = 0;
    const proof = [...input.proof];
    Object.defineProperty(proof, Symbol.iterator, {
      value: function* () {
        for (let i = 0; i < 1000; i += 1) {
          yielded += 1;
          yield input.proof[0]!;
        }
      },
    });
    await expect(verifyEvidenceLogInclusion({ ...input, proof })).resolves.toBe(
      true,
    );
    expect(yielded).toBe(0);
  });

  it("a forged hash that only borrows the Uint8Array prototype, without reading it (V4)", async () => {
    const input = await honest();
    for (const key of ["leafHash", "root"] as const) {
      const forged = forgedHash();
      await expect(
        verifyEvidenceLogInclusion({ ...input, [key]: forged }),
      ).resolves.toBe(false);
      expect(forged.yielded).toBe(0);
    }
    const forged = forgedHash();
    await expect(
      verifyEvidenceLogInclusion({
        ...input,
        proof: [input.proof[0]!, forged, input.proof[2]!],
      }),
    ).resolves.toBe(false);
    expect(forged.yielded).toBe(0);
  });

  it("a proof whose length is not a number, without reading its elements (V5)", async () => {
    const input = await honest();
    let reads = 0;
    let calls = 0;
    const proof = new Proxy([...input.proof], {
      get: (target, key) => {
        if (key === "length") {
          // Below the cap when compared with it, above it afterwards.
          return { valueOf: () => (calls++ === 0 ? 1 : 100) };
        }
        if (typeof key === "string" && /^\d+$/.test(key)) reads += 1;
        return Reflect.get(target, key);
      },
    });
    await expect(verifyEvidenceLogInclusion({ ...input, proof })).resolves.toBe(
      false,
    );
    expect(reads).toBe(0);
  });

  it("a proof length that is not a whole number from 0 to 53 (V5)", async () => {
    const withLength = (elements: Uint8Array[], length: number) =>
      new Proxy(elements, {
        get: (target, key) =>
          key === "length" ? length : Reflect.get(target, key),
      });
    // One leaf: an empty path proves it, so a skipped element must not.
    const single = await honest(1, 0);
    for (const length of [Number.NaN, -1, -Infinity]) {
      const proof = withLength([new Uint8Array(31)], length);
      await expect(
        verifyEvidenceLogInclusion({ ...single, proof }),
      ).resolves.toBe(false);
    }
    // A fractional length must not read one element more than it states.
    const input = await honest();
    for (const length of [2.5, 2.000001]) {
      const proof = withLength([...input.proof], length);
      await expect(
        verifyEvidenceLogInclusion({ ...input, proof }),
      ).resolves.toBe(false);
    }
  });

  it("checks the values as passed, even if the caller changes them meanwhile", async () => {
    const input = await honest();
    const proof = input.proof.map((element) => new Uint8Array(element));
    const root = new Uint8Array(input.root);
    const check = verifyEvidenceLogInclusion({ ...input, proof, root });
    proof[1]![0]! ^= 1;
    root.fill(0);
    await expect(check).resolves.toBe(true);
  });

  it("a changed leaf, a leaf from elsewhere, another root or another size (V6)", async () => {
    const input = await honest();
    const leaves = await referenceLeafHashes();
    const flipped = new Uint8Array(input.leafHash);
    flipped[0]! ^= 0x80;
    await expect(
      verifyEvidenceLogInclusion({ ...input, leafHash: flipped }),
    ).resolves.toBe(false);
    await expect(
      verifyEvidenceLogInclusion({ ...input, leafHash: leaves[2]! }),
    ).resolves.toBe(false);
    await expect(
      verifyEvidenceLogInclusion({
        ...input,
        root: await evidenceLogRoot(leaves.slice(0, 6)),
      }),
    ).resolves.toBe(false);
    // Sizes whose path for leaf 1 has other sides than [L, R, R].
    for (const treeSize of [2, 3, 4, 9, 16]) {
      await expect(
        verifyEvidenceLogInclusion({ ...input, treeSize }),
      ).resolves.toBe(false);
    }
    for (const index of [0, 2, 3, 4]) {
      await expect(
        verifyEvidenceLogInclusion({ ...input, index }),
      ).resolves.toBe(false);
    }
  });

  it("does not bind a size whose path has the same sides; the signed checkpoint does", async () => {
    // RFC 9162 §2.1.3.2 takes tree_size from the signed tree head. Leaf 1 has
    // the path sides [L, R, R] in trees of 5 to 8 leaves alike.
    const input = await honest();
    for (const treeSize of [6, 7, 8]) {
      await expect(
        verifyEvidenceLogInclusion({ ...input, treeSize }),
      ).resolves.toBe(true);
    }
  });

  it("takes an inner node for a leaf under a free size; the caller's own leaf hash and the checkpoint size prevent it", async () => {
    // Four leaves: R = H(1 || N01 || N23). Under size 2, N01 looks like leaf 0.
    const leaves = (await referenceLeafHashes()).slice(0, 4);
    const n01 = await sha256(Uint8Array.of(1, ...leaves[0]!, ...leaves[1]!));
    const n23 = await sha256(Uint8Array.of(1, ...leaves[2]!, ...leaves[3]!));
    const input = {
      leafHash: n01,
      index: 0,
      treeSize: 2,
      proof: [n23],
      root: await evidenceLogRoot(leaves),
    };
    await expect(verifyEvidenceLogInclusion(input)).resolves.toBe(true);
    await expect(
      verifyEvidenceLogInclusion({ ...input, treeSize: 4 }),
    ).resolves.toBe(false);
  });

  it("does not shift with 32-bit arithmetic for a tree beyond 2^32 leaves", async () => {
    const leftSubtree = bytes32(0xaa);
    const leafHash = bytes32(0x55);
    const root = await sha256(Uint8Array.of(1, ...leftSubtree, ...leafHash));
    const input = {
      leafHash,
      index: 2 ** 32,
      treeSize: 2 ** 32 + 1,
      proof: [leftSubtree],
      root,
    };
    await expect(verifyEvidenceLogInclusion(input)).resolves.toBe(true);
    await expect(
      verifyEvidenceLogInclusion({ ...input, index: 0, treeSize: 2 }),
    ).resolves.toBe(false);
  });
});

describe("leaf order", () => {
  const T = "2026-11-13T09:00:00.000Z";

  it("keeps the empty list and a single entry (O1, O2)", () => {
    expect(orderEvidenceLogEntries([])).toEqual([]);
    const one = { acceptedAt: T, receiptId: "r-1" };
    expect(orderEvidenceLogEntries([one])).toEqual([one]);
  });

  it("orders by acceptance time first (O3)", () => {
    const later = { acceptedAt: "2026-11-13T09:01:00.000Z", receiptId: "a" };
    const earlier = { acceptedAt: T, receiptId: "z" };
    expect(orderEvidenceLogEntries([later, earlier])).toEqual([earlier, later]);
  });

  it("orders equal times by the UTF-8 bytes of the receipt id, not UTF-16 (O4)", () => {
    const bmp = { acceptedAt: T, receiptId: "\uFFFF" };
    const astral = { acceptedAt: T, receiptId: "\u{10000}" };
    // UTF-16 code units would put U+10000 (D800 DC00) before U+FFFF.
    expect(["\u{10000}", "\uFFFF"].sort()).toEqual(["\u{10000}", "\uFFFF"]);
    expect(orderEvidenceLogEntries([astral, bmp])).toEqual([bmp, astral]);
    const b = { acceptedAt: T, receiptId: "b" };
    const a = { acceptedAt: T, receiptId: "a" };
    expect(orderEvidenceLogEntries([b, a])).toEqual([a, b]);
  });

  it("compares a v1 millisecond instant with a v2 minute by time (O5)", () => {
    const v1 = { acceptedAt: "2026-11-13T08:59:59.999Z", receiptId: "z" };
    const v2 = { acceptedAt: T, receiptId: "a" };
    expect(orderEvidenceLogEntries([v2, v1])).toEqual([v1, v2]);
  });

  it("compares extended years by time, not as text (O5)", () => {
    const far = { acceptedAt: "+010000-01-01T00:00:00.000Z", receiptId: "a" };
    const near = { acceptedAt: T, receiptId: "b" };
    expect(orderEvidenceLogEntries([far, near])).toEqual([near, far]);
  });

  it.each<unknown>([
    "2026-11-13T10:00:00.000+01:00",
    "2026-11-13T09:00:00Z",
    "2026-11-13 09:00:00.000Z",
    "not a time",
    1_700_000_000_000,
    undefined,
  ])("refuses a non-canonical acceptance time %s (O6)", (acceptedAt) => {
    expect(() =>
      orderEvidenceLogEntries([{ acceptedAt, receiptId: "r" } as never]),
    ).toThrow(/acceptedAt/);
  });

  it("refuses a receipt id seen twice, even at different times (O7)", () => {
    const first = { acceptedAt: T, receiptId: "r-1" };
    const second = { acceptedAt: "2026-11-13T09:05:00.000Z", receiptId: "r-1" };
    expect(() => orderEvidenceLogEntries([first, second])).toThrow(/duplicate/);
  });

  it.each<unknown>(["", "\ud800", "a\udc00", "\udc00\ud800", 7, null])(
    "refuses an empty, malformed or missing receipt id %j (O8)",
    (receiptId) => {
      expect(() =>
        orderEvidenceLogEntries([{ acceptedAt: T, receiptId } as never]),
      ).toThrow(/receiptId/);
    },
  );

  it("refuses a value that is not a list", () => {
    expect(() => orderEvidenceLogEntries("entries" as never)).toThrow(/list/);
  });

  it("refuses a hole in a sparse list", () => {
    const sparse: { acceptedAt: string; receiptId: string }[] = [];
    sparse[1] = { acceptedAt: T, receiptId: "r-1" };
    expect(() => orderEvidenceLogEntries(sparse)).toThrow(/acceptedAt/);
  });

  it("returns a new list and keeps the caller's", () => {
    const input = [
      { acceptedAt: "2026-11-13T09:01:00.000Z", receiptId: "a" },
      { acceptedAt: T, receiptId: "b" },
    ];
    const snapshot = [...input];
    const ordered = orderEvidenceLogEntries(input);
    expect(ordered).not.toBe(input);
    expect(input).toEqual(snapshot);
  });
});
