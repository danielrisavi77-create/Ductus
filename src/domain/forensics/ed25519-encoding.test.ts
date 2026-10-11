import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ed25519KeyFromSpki, isCanonicalEd25519Signature, isSoundEd25519Point } from "./ed25519-encoding";

/**
 * The byte checks on their own (QA 6106245321 on PR 247). The lists of weak
 * and non-canonical points are attacked through the verifier, in
 * `evidence-receipt-verifier.test.ts`; here are the sizes and the edges.
 */
const bytes = (hex: string) => new Uint8Array(Buffer.from(hex, "hex"));
// p = 2^255 - 19 and L, the order of the base point, little endian.
const P_MINUS_2 = "eb" + "ff".repeat(30) + "7f";
const L = "edd3f55c1a631258d69cf7a2def9de14" + "00".repeat(15) + "10";
const L_MINUS_1 = "ecd3f55c1a631258d69cf7a2def9de14" + "00".repeat(15) + "10";
const BASE_POINT = "58" + "66".repeat(31);

describe("Ed25519 bytes: points", () => {
  it("takes the base point and the key of a fresh pair", () => {
    expect(isSoundEd25519Point(bytes(BASE_POINT))).toBe(true);
    const spki = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" });
    const key = ed25519KeyFromSpki(new Uint8Array(spki));
    expect(key).toHaveLength(32);
    expect(isSoundEd25519Point(key as Uint8Array)).toBe(true);
  });

  it("takes y up to p - 2 and refuses p - 1, which is the point of order 2, and p", () => {
    expect(isSoundEd25519Point(bytes(P_MINUS_2))).toBe(true);
    expect(isSoundEd25519Point(bytes("ec" + "ff".repeat(30) + "7f"))).toBe(false);
    expect(isSoundEd25519Point(bytes("ed" + "ff".repeat(30) + "7f"))).toBe(false);
    // 2 and 3 are next to the y of the identity and are not of small order.
    expect(isSoundEd25519Point(bytes("02" + "00".repeat(31)))).toBe(true);
    expect(isSoundEd25519Point(bytes("03" + "00".repeat(30) + "80"))).toBe(true);
  });

  it("refuses anything that is not 32 bytes", () => {
    expect(isSoundEd25519Point(bytes(BASE_POINT).subarray(0, 31))).toBe(false);
    expect(isSoundEd25519Point(bytes(`${BASE_POINT}00`))).toBe(false);
    expect(isSoundEd25519Point(new Uint8Array(0))).toBe(false);
  });
});

describe("Ed25519 bytes: signatures", () => {
  it("takes what a signer writes", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    expect(isCanonicalEd25519Signature(new Uint8Array(sign(null, Buffer.from("poruka"), privateKey)))).toBe(true);
  });

  it("takes S up to L - 1 and refuses L", () => {
    expect(isCanonicalEd25519Signature(bytes(BASE_POINT + L_MINUS_1))).toBe(true);
    expect(isCanonicalEd25519Signature(bytes(BASE_POINT + L))).toBe(false);
    expect(isCanonicalEd25519Signature(bytes(BASE_POINT + "00".repeat(32)))).toBe(true);
    // The identity as R.
    expect(isCanonicalEd25519Signature(bytes("01" + "00".repeat(63)))).toBe(false);
  });

  it("refuses anything that is not 64 bytes", () => {
    const signature = bytes(BASE_POINT + L_MINUS_1);
    expect(isCanonicalEd25519Signature(signature.subarray(0, 63))).toBe(false);
    expect(isCanonicalEd25519Signature(bytes(`${BASE_POINT}${L_MINUS_1}00`))).toBe(false);
    expect(isCanonicalEd25519Signature(signature.subarray(0, 32))).toBe(false);
  });
});

describe("Ed25519 bytes: SPKI", () => {
  const PREFIX = "302a300506032b6570032100";

  it("gives the 32 bytes after the Ed25519 prefix", () => {
    expect(Buffer.from(ed25519KeyFromSpki(bytes(PREFIX + BASE_POINT)) as Uint8Array).toString("hex")).toBe(BASE_POINT);
  });

  it("gives nothing for another size or another prefix", () => {
    expect(ed25519KeyFromSpki(bytes(PREFIX + BASE_POINT).subarray(0, 43))).toBeNull();
    expect(ed25519KeyFromSpki(bytes(`${PREFIX}${BASE_POINT}00`))).toBeNull();
    for (let index = 0; index < PREFIX.length / 2; index += 1) {
      const other = bytes(PREFIX + BASE_POINT);
      other[index] ^= 1;
      expect(ed25519KeyFromSpki(other)).toBeNull();
    }
  });
});
