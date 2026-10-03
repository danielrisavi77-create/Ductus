import {
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";

import type {
  PublicVerificationKey,
  SignatureEnvelope,
  SigningKeyProvider,
} from "@/application/ports/signing-key-provider";

/**
 * Local/test-only Ed25519 signer.
 *
 * It intentionally generates an ephemeral private key in process memory and
 * refuses construction in NODE_ENV=production. Production evidence signing
 * must use the future KMS/HSM adapter instead.
 */
export class DevelopmentEd25519SigningKeyProvider
  implements SigningKeyProvider
{
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor(
    private readonly keyId = "pisac-dev-ed25519",
    private readonly keyVersion = "ephemeral-v1",
  ) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "development signer is prohibited in production",
      );
    }
    const pair = generateKeyPairSync("ed25519");
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  async sign(message: Uint8Array): Promise<SignatureEnvelope> {
    const signature = nodeSign(null, Buffer.from(message), this.privateKey);
    return {
      algorithm: "Ed25519",
      keyId: this.keyId,
      keyVersion: this.keyVersion,
      signatureEncoding: "raw",
      signatureBase64Url: signature.toString("base64url"),
    };
  }

  async publicVerificationKey(): Promise<PublicVerificationKey> {
    const der = this.publicKey.export({
      type: "spki",
      format: "der",
    });
    return {
      algorithm: "Ed25519",
      keyId: this.keyId,
      keyVersion: this.keyVersion,
      encoding: "spki-der",
      keyBase64Url: Buffer.from(der).toString("base64url"),
    };
  }

  async verify(
    message: Uint8Array,
    signature: SignatureEnvelope,
  ): Promise<boolean> {
    if (
      signature.algorithm !== "Ed25519" ||
      signature.signatureEncoding !== "raw" ||
      signature.keyId !== this.keyId ||
      signature.keyVersion !== this.keyVersion
    ) {
      return false;
    }
    return nodeVerify(
      null,
      Buffer.from(message),
      this.publicKey,
      Buffer.from(signature.signatureBase64Url, "base64url"),
    );
  }
}
