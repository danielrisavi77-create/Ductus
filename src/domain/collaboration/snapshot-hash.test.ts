import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { snapshotHash } from "./snapshot-hash";

const oracle = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("snapshotHash (F-168)", () => {
  it("gives the FIPS 180-4 example digests", () => {
    expect(snapshotHash("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(snapshotHash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(snapshotHash("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("hashes the UTF-8 bytes, also of Croatian letters and astral characters", () => {
    for (const text of ["Rezultat je točan.", "čćđšž ČĆĐŠŽ", "\u{1F600} izvor"]) {
      expect(snapshotHash(text)).toBe(oracle(text));
    }
  });

  it("equals node:crypto on every length around the block boundaries", () => {
    for (let length = 0; length <= 200; length++) {
      const text = "a".repeat(length);
      expect(snapshotHash(text), `length ${length}`).toBe(oracle(text));
    }
  });

  it("equals node:crypto on arbitrary text", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 300 }), (text) => snapshotHash(text) === oracle(text)),
      { numRuns: 200 },
    );
  });
});
