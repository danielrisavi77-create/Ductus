import {
  generateKeyPairSync,
  randomUUID,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";

import {
  GetPublicKeyCommand,
  InvalidKeyUsageException,
  KMSInvalidSignatureException,
  KMSServiceException,
  NotFoundException,
  SignCommand,
  VerifyCommand,
} from "@aws-sdk/client-kms";

import {
  AWS_KMS_ED25519_ALGORITHM,
  AWS_KMS_ED25519_KEY_SPEC,
  AWS_KMS_RAW_MESSAGE_TYPE,
  AWS_KMS_SIGN_VERIFY_USAGE,
} from "./aws-kms-ed25519-signer";
import type { KmsCommandSender } from "./aws-kms-sdk-transport";

const META = { $metadata: {} };
const MAX_RAW_MESSAGE_BYTES = 4096;
// Synthetic account and region; nothing here names a real AWS account.
const ARN_PREFIX = "arn:aws:kms:eu-central-1:000000000000:key/";

type FakeKey = { privateKey: KeyObject; publicKey: KeyObject };

/**
 * In-memory stand-in for AWS KMS, for local runs and CI (DAN-295). It answers
 * the three commands AwsSdkKmsEd25519Transport sends, with the output and
 * exception shapes of the SDK. Keys are ephemeral Ed25519 pairs generated in
 * process memory; nothing is read from or written to disk.
 *
 * `fault` injects a transport failure on the next calls: "network" rejects
 * like a reset socket, "hang" never answers and only stops on abort.
 */
export class FakeKmsClient implements KmsCommandSender {
  private readonly keys = new Map<string, FakeKey>();
  private readonly aliases = new Map<string, string>();
  private readonly denied = new Set<string>();
  fault: "network" | "hang" | null = null;

  constructor() {
    // An allowlist, as for the development signer (F-020): an unset, empty or
    // misspelt NODE_ENV counts as production.
    if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test") {
      throw new Error("fake KMS is prohibited outside development and test");
    }
  }

  /** Creates a key and points `alias` at it; returns the concrete key ARN. */
  createKey(alias?: string): string {
    const arn = `${ARN_PREFIX}${randomUUID()}`;
    this.keys.set(arn, generateKeyPairSync("ed25519"));
    if (alias) this.aliases.set(alias, arn);
    return arn;
  }

  deny(keyArn: string): void {
    this.denied.add(keyArn);
  }

  allow(keyArn: string): void {
    this.denied.delete(keyArn);
  }

  private resolve(keyId: string | undefined): { arn: string; key: FakeKey } {
    const arn = keyId && (this.aliases.get(keyId) ?? keyId);
    const key = arn ? this.keys.get(arn) : undefined;
    if (!arn || !key) throw new NotFoundException({ message: "key not found", ...META });
    if (this.denied.has(arn)) {
      throw new KMSServiceException({
        name: "AccessDeniedException",
        $fault: "client",
        message: "access denied",
        ...META,
      });
    }
    return { arn, key };
  }

  private checkRawEd25519(input: {
    Message?: Uint8Array;
    MessageType?: string;
    SigningAlgorithm?: string;
  }): Uint8Array {
    if (
      input.MessageType !== AWS_KMS_RAW_MESSAGE_TYPE ||
      input.SigningAlgorithm !== AWS_KMS_ED25519_ALGORITHM ||
      !(input.Message instanceof Uint8Array) ||
      input.Message.byteLength < 1 ||
      input.Message.byteLength > MAX_RAW_MESSAGE_BYTES
    ) {
      throw new InvalidKeyUsageException({ message: "unsupported request", ...META });
    }
    return input.Message;
  }

  async send(
    command: SignCommand | VerifyCommand | GetPublicKeyCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown> {
    if (this.fault === "network") {
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    }
    if (this.fault === "hang") {
      return new Promise((_, reject) => {
        options?.abortSignal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    }

    if (command instanceof SignCommand) {
      const { arn, key } = this.resolve(command.input.KeyId);
      const message = this.checkRawEd25519(command.input);
      return {
        KeyId: arn,
        SigningAlgorithm: AWS_KMS_ED25519_ALGORITHM,
        Signature: new Uint8Array(nodeSign(null, message, key.privateKey)),
        $metadata: {},
      };
    }
    if (command instanceof VerifyCommand) {
      const { arn, key } = this.resolve(command.input.KeyId);
      const message = this.checkRawEd25519(command.input);
      const signature = command.input.Signature;
      const valid =
        signature instanceof Uint8Array &&
        nodeVerify(null, message, key.publicKey, signature);
      if (!valid) {
        throw new KMSInvalidSignatureException({ message: "invalid signature", ...META });
      }
      return { KeyId: arn, SignatureValid: true, SigningAlgorithm: AWS_KMS_ED25519_ALGORITHM, $metadata: {} };
    }
    const { arn, key } = this.resolve(command.input.KeyId);
    return {
      KeyId: arn,
      KeySpec: AWS_KMS_ED25519_KEY_SPEC,
      KeyUsage: AWS_KMS_SIGN_VERIFY_USAGE,
      SigningAlgorithms: [AWS_KMS_ED25519_ALGORITHM],
      PublicKey: new Uint8Array(key.publicKey.export({ type: "spki", format: "der" })),
      $metadata: {},
    };
  }
}
