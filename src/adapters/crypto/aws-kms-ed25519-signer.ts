import type {
  PublicVerificationKey,
  SignatureEnvelope,
  SigningKeyProvider,
} from "@/application/ports/signing-key-provider";

export const AWS_KMS_ED25519_KEY_SPEC = "ECC_NIST_EDWARDS25519" as const;  // gitleaks:allow (public AWS KMS key spec name, not a secret)
export const AWS_KMS_SIGN_VERIFY_USAGE = "SIGN_VERIFY" as const;
export const AWS_KMS_ED25519_ALGORITHM = "ED25519_SHA_512" as const;
export const AWS_KMS_RAW_MESSAGE_TYPE = "RAW" as const;
const MAX_KMS_RAW_MESSAGE_BYTES = 4096;

export type AwsKmsEd25519SignResult = {
  keyId: string;
  signingAlgorithm: string;
  signature: Uint8Array;
};

export type AwsKmsEd25519PublicKeyResult = {
  keyId: string;
  keySpec: string;
  keyUsage: string;
  signingAlgorithms: readonly string[];
  publicKeySpkiDer: Uint8Array;
};

export interface AwsKmsEd25519Transport {
  sign(input: {
    keyId: string;
    message: Uint8Array;
    messageType: typeof AWS_KMS_RAW_MESSAGE_TYPE;
    signingAlgorithm: typeof AWS_KMS_ED25519_ALGORITHM;
  }): Promise<AwsKmsEd25519SignResult>;

  verify(input: {
    keyId: string;
    message: Uint8Array;
    signature: Uint8Array;
    messageType: typeof AWS_KMS_RAW_MESSAGE_TYPE;
    signingAlgorithm: typeof AWS_KMS_ED25519_ALGORITHM;
  }): Promise<boolean>;

  getPublicKey(input: {
    keyId: string;
  }): Promise<AwsKmsEd25519PublicKeyResult>;
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    return new Uint8Array(Buffer.from(value, "base64url"));
  } catch {
    return null;
  }
}

function assertKmsKeyMetadata(
  result: AwsKmsEd25519PublicKeyResult,
): void {
  if (
    !result.keyId.trim() ||
    result.keySpec !== AWS_KMS_ED25519_KEY_SPEC ||
    result.keyUsage !== AWS_KMS_SIGN_VERIFY_USAGE ||
    !result.signingAlgorithms.includes(AWS_KMS_ED25519_ALGORITHM) ||
    result.publicKeySpkiDer.byteLength < 1
  ) {
    throw new Error("aws-kms: incompatible signing key");
  }
}

/**
 * Production SigningKeyProvider semantics for an AWS KMS Ed25519 key.
 *
 * The transport is intentionally injected. Production composition should use
 * the official AWS KMS SDK; this module does not hand-roll AWS SigV4.
 *
 * Receipt bytes are supplied as RAW input to ED25519_SHA_512 as required for
 * ECC_NIST_EDWARDS25519 KMS keys. keyVersion stores the concrete KMS KeyId/ARN
 * returned by Sign, so historical verification never follows a rotated alias.
 */
export class AwsKmsEd25519SigningKeyProvider
  implements SigningKeyProvider
{
  constructor(
    private readonly transport: AwsKmsEd25519Transport,
    private readonly configuredKeyId: string,
  ) {
    if (!configuredKeyId.trim()) {
      throw new Error("aws-kms: key id required");
    }
  }

  async sign(message: Uint8Array): Promise<SignatureEnvelope> {
    if (
      message.byteLength < 1 ||
      message.byteLength > MAX_KMS_RAW_MESSAGE_BYTES
    ) {
      throw new Error("aws-kms: raw message size unsupported");
    }

    const result = await this.transport.sign({
      keyId: this.configuredKeyId,
      message,
      messageType: AWS_KMS_RAW_MESSAGE_TYPE,
      signingAlgorithm: AWS_KMS_ED25519_ALGORITHM,
    });

    if (
      !result.keyId.trim() ||
      result.signingAlgorithm !== AWS_KMS_ED25519_ALGORITHM ||
      result.signature.byteLength < 1
    ) {
      throw new Error("aws-kms: invalid Sign response");
    }

    return {
      algorithm: "Ed25519",
      keyId: this.configuredKeyId,
      keyVersion: result.keyId,
      signatureEncoding: "raw",
      signatureBase64Url: toBase64Url(result.signature),
    };
  }

  async verify(
    message: Uint8Array,
    signature: SignatureEnvelope,
  ): Promise<boolean> {
    if (
      signature.algorithm !== "Ed25519" ||
      signature.signatureEncoding !== "raw" ||
      signature.keyId !== this.configuredKeyId ||
      !signature.keyVersion.trim()
    ) {
      return false;
    }

    const bytes = fromBase64Url(signature.signatureBase64Url);
    if (!bytes) return false;

    try {
      return await this.transport.verify({
        // Verify against the exact key version/ARN that signed the receipt,
        // not a possibly rotated alias.
        keyId: signature.keyVersion,
        message,
        signature: bytes,
        messageType: AWS_KMS_RAW_MESSAGE_TYPE,
        signingAlgorithm: AWS_KMS_ED25519_ALGORITHM,
      });
    } catch {
      return false;
    }
  }

  async publicVerificationKey(): Promise<PublicVerificationKey> {
    const result = await this.transport.getPublicKey({
      keyId: this.configuredKeyId,
    });
    assertKmsKeyMetadata(result);

    return {
      algorithm: "Ed25519",
      keyId: this.configuredKeyId,
      keyVersion: result.keyId,
      encoding: "spki-der",
      keyBase64Url: toBase64Url(result.publicKeySpkiDer),
    };
  }
}
