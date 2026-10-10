import { describe, expect, it } from "vitest";

import {
  isPublicVerificationKey,
  isSignatureEnvelope,
} from "./signature";

describe("signature trust metadata", () => {
  it("accepts only algorithm-compatible signature encodings", () => {
    expect(
      isSignatureEnvelope({
        algorithm: "Ed25519",
        keyId: "ed-key",
        keyVersion: "v1",
        signatureEncoding: "raw",
        signatureBase64Url: "AQID",
      }),
    ).toBe(true);
    expect(
      isSignatureEnvelope({
        algorithm: "Ed25519",
        keyId: "ed-key",
        keyVersion: "v1",
        signatureEncoding: "der",
        signatureBase64Url: "AQID",
      }),
    ).toBe(false);

    for (const encoding of ["ieee-p1363", "der"] as const) {
      expect(
        isSignatureEnvelope({
          algorithm: "ECDSA_P256_SHA256",
          keyId: "p256-key",
          keyVersion: "v2",
          signatureEncoding: encoding,
          signatureBase64Url: "AQID",
        }),
      ).toBe(true);
    }
    expect(
      isSignatureEnvelope({
        algorithm: "ECDSA_P256_SHA256",
        keyId: "p256-key",
        keyVersion: "v2",
        signatureEncoding: "raw",
        signatureBase64Url: "AQID",
      }),
    ).toBe(false);

    expect(
      isSignatureEnvelope({
        algorithm: "RSA_PSS_SHA256",
        keyId: "rsa-key",
        keyVersion: "v3",
        signatureEncoding: "raw",
        signatureBase64Url: "AQID",
      }),
    ).toBe(true);
    expect(
      isSignatureEnvelope({
        algorithm: "RSA_PSS_SHA256",
        keyId: "rsa-key",
        keyVersion: "v3",
        signatureEncoding: "der",
        signatureBase64Url: "AQID",
      }),
    ).toBe(false);
  });

  it("validates public SPKI metadata independently of signature encoding", () => {
    expect(
      isPublicVerificationKey({
        algorithm: "ECDSA_P256_SHA256",
        keyId: "p256-key",
        keyVersion: "v2",
        encoding: "spki-der",
        keyBase64Url: "AQID",
      }),
    ).toBe(true);

    expect(
      isPublicVerificationKey({
        algorithm: "Ed25519",
        keyId: "ed-key",
        keyVersion: "v1",
        encoding: "raw",
        keyBase64Url: "AQID",
      }),
    ).toBe(false);

    expect(
      isPublicVerificationKey({
        algorithm: "mystery",
        keyId: "key",
        keyVersion: "v1",
        encoding: "spki-der",
        keyBase64Url: "AQID",
      }),
    ).toBe(false);
  });

  it("rejects a field it does not know, and anything that is not a plain object", () => {
    const envelope = {
      algorithm: "Ed25519",
      keyId: "ed-key",
      keyVersion: "v1",
      signatureEncoding: "raw",
      signatureBase64Url: "AQID",
    };
    const key = {
      algorithm: "Ed25519",
      keyId: "ed-key",
      keyVersion: "v1",
      encoding: "spki-der",
      keyBase64Url: "AQID",
    };
    expect(isSignatureEnvelope(envelope)).toBe(true);
    expect(isPublicVerificationKey(key)).toBe(true);

    for (const extra of [
      { extra: 1 },
      { principalId: "student-izmisljeni-2" },
      { keyBase64Url: "AQID" },
      { note: undefined },
      JSON.parse('{"__proto__": {"algorithm": "Ed25519"}}'),
    ]) {
      expect(isSignatureEnvelope({ ...envelope, ...extra })).toBe(false);
    }
    for (const extra of [
      { extra: 1 },
      { privateKeyBase64Url: "AQID" },
      { signatureBase64Url: "AQID" },
    ]) {
      expect(isPublicVerificationKey({ ...key, ...extra })).toBe(false);
    }

    class Carrier {
      algorithm = "Ed25519";
      keyId = "ed-key";
      keyVersion = "v1";
      signatureEncoding = "raw";
      signatureBase64Url = "AQID";
    }
    expect(isSignatureEnvelope(new Carrier())).toBe(false);
    expect(isSignatureEnvelope([envelope])).toBe(false);
    expect(isPublicVerificationKey(Object.assign(Object.create(key), {}))).toBe(false);
  });

  it("rejects blank metadata and non-base64url bytes", () => {
    expect(
      isSignatureEnvelope({
        algorithm: "Ed25519",
        keyId: "",
        keyVersion: "v1",
        signatureEncoding: "raw",
        signatureBase64Url: "AQID",
      }),
    ).toBe(false);

    expect(
      isSignatureEnvelope({
        algorithm: "Ed25519",
        keyId: "key",
        keyVersion: "v1",
        signatureEncoding: "raw",
        signatureBase64Url: "not+base64/url",
      }),
    ).toBe(false);
  });
});
