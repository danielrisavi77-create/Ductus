import type {
  PublicVerificationKey,
  SignatureEnvelope,
} from "@/domain/forensics/signature";

/**
 * Provider-neutral evidence/artifact signing boundary.
 *
 * Production implementations are expected to keep private key material in a
 * KMS/HSM. The application receives signatures, never exportable private keys.
 */
export interface SigningKeyProvider {
  sign(message: Uint8Array): Promise<SignatureEnvelope>;
  verify(
    message: Uint8Array,
    signature: SignatureEnvelope,
  ): Promise<boolean>;
  publicVerificationKey(): Promise<PublicVerificationKey>;
}

export type {
  PublicVerificationKey,
  SignatureAlgorithm,
  SignatureEncoding,
  SignatureEnvelope,
} from "@/domain/forensics/signature";
