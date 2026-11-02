import {
  GetPublicKeyCommand,
  SignCommand,
  VerifyCommand,
} from "@aws-sdk/client-kms";

import {
  AWS_KMS_ED25519_ALGORITHM,
  AWS_KMS_ED25519_KEY_SPEC,
  AWS_KMS_SIGN_VERIFY_USAGE,
  type AwsKmsEd25519PublicKeyResult,
  type AwsKmsEd25519SignResult,
  type AwsKmsEd25519Transport,
} from "./aws-kms-ed25519-signer";

const ED25519_SIGNATURE_BYTES = 64;

export type KmsTransportErrorKind =
  | "access_denied"
  | "key_not_found"
  | "timeout"
  | "invalid_response"
  | "network"
  | "service_error";

export type KmsTransportOperation = "sign" | "verify" | "getPublicKey";

/**
 * Closed failure classes of the KMS transport (DAN-295 contract, #1091).
 * The message carries no key id or ARN; awsErrorName is the SDK error name
 * when there is one, for logs.
 */
export class KmsTransportError extends Error {
  constructor(
    readonly kind: KmsTransportErrorKind,
    readonly operation: KmsTransportOperation,
    readonly awsErrorName?: string,
  ) {
    super(`aws-kms: ${operation} ${kind}`);
    this.name = "KmsTransportError";
  }
}

type KmsCommand = SignCommand | VerifyCommand | GetPublicKeyCommand;

/** The one KMSClient method the transport needs; the fake KMS implements it too. */
export interface KmsCommandSender {
  send(
    command: KmsCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown>;
}

const TIMEOUT_NAMES = new Set([
  "TimeoutError",
  "RequestTimeout",
  "RequestTimeoutException",
  "DependencyTimeoutException",
]);

function classify(error: unknown, operation: KmsTransportOperation): KmsTransportError {
  if (typeof error !== "object" || error === null) {
    return new KmsTransportError("network", operation);
  }
  const { name, code, $fault } = error as { name?: unknown; code?: unknown; $fault?: unknown };
  const awsName = typeof name === "string" ? name : undefined;
  if (awsName && TIMEOUT_NAMES.has(awsName)) {
    return new KmsTransportError("timeout", operation, awsName);
  }
  if (code === "ETIMEDOUT") return new KmsTransportError("timeout", operation, awsName);
  // A KMS service exception carries $fault; anything else did not get an
  // answer from KMS and is a transport (network) failure.
  if ($fault !== "client" && $fault !== "server") {
    return new KmsTransportError("network", operation, awsName);
  }
  if (awsName === "AccessDeniedException") {
    return new KmsTransportError("access_denied", operation, awsName);
  }
  if (awsName === "NotFoundException") {
    return new KmsTransportError("key_not_found", operation, awsName);
  }
  return new KmsTransportError("service_error", operation, awsName);
}

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const isBytes = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array && value.byteLength > 0;
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

/**
 * AwsKmsEd25519Transport over the official AWS SDK (D-71). Every call has its
 * own deadline: on expiry the request is aborted and a late answer or late
 * failure is discarded. Credentials, region and the KMSClient itself are
 * composed elsewhere (M3.8-P03); this class never reads the environment.
 */
export class AwsSdkKmsEd25519Transport implements AwsKmsEd25519Transport {
  private readonly timeoutMs: number;

  constructor(
    private readonly client: KmsCommandSender,
    options: { timeoutMs: number },
  ) {
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new Error("aws-kms: timeoutMs must be a positive integer");
    }
    this.timeoutMs = options.timeoutMs;
  }

  private async send(
    command: KmsCommand,
    operation: KmsTransportOperation,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Settle the deadline before aborting, so the AbortError the SDK
        // raises on abort can never win the race below.
        reject(new KmsTransportError("timeout", operation));
        controller.abort();
      }, this.timeoutMs);
    });
    const sent = Promise.resolve().then(() =>
      this.client.send(command, { abortSignal: controller.signal }),
    );
    // Promise.race subscribes to `sent`, so a failure that arrives after the
    // deadline is handled and dropped, never an unhandled rejection.
    let output: unknown;
    try {
      output = await Promise.race([sent, deadline]);
    } catch (error) {
      if (error instanceof KmsTransportError) throw error;
      if (
        operation === "verify" &&
        record(error)?.name === "KMSInvalidSignatureException"
      ) {
        return { SignatureValid: false };
      }
      throw classify(error, operation);
    } finally {
      clearTimeout(timer);
    }
    const out = record(output);
    if (!out) throw new KmsTransportError("invalid_response", operation);
    return out;
  }

  async sign(input: Parameters<AwsKmsEd25519Transport["sign"]>[0]): Promise<AwsKmsEd25519SignResult> {
    const out = await this.send(
      new SignCommand({
        KeyId: input.keyId,
        Message: input.message,
        MessageType: input.messageType,
        SigningAlgorithm: input.signingAlgorithm,
      }),
      "sign",
    );
    if (
      !isText(out.KeyId) ||
      out.SigningAlgorithm !== AWS_KMS_ED25519_ALGORITHM ||
      !isBytes(out.Signature) ||
      out.Signature.byteLength !== ED25519_SIGNATURE_BYTES
    ) {
      throw new KmsTransportError("invalid_response", "sign");
    }
    return { keyId: out.KeyId, signingAlgorithm: out.SigningAlgorithm, signature: out.Signature };
  }

  async verify(input: Parameters<AwsKmsEd25519Transport["verify"]>[0]): Promise<boolean> {
    const out = await this.send(
      new VerifyCommand({
        KeyId: input.keyId,
        Message: input.message,
        Signature: input.signature,
        MessageType: input.messageType,
        SigningAlgorithm: input.signingAlgorithm,
      }),
      "verify",
    );
    if (typeof out.SignatureValid !== "boolean") {
      throw new KmsTransportError("invalid_response", "verify");
    }
    return out.SignatureValid;
  }

  async getPublicKey(
    input: Parameters<AwsKmsEd25519Transport["getPublicKey"]>[0],
  ): Promise<AwsKmsEd25519PublicKeyResult> {
    const out = await this.send(new GetPublicKeyCommand({ KeyId: input.keyId }), "getPublicKey");
    const algorithms = out.SigningAlgorithms;
    if (
      !isText(out.KeyId) ||
      out.KeySpec !== AWS_KMS_ED25519_KEY_SPEC ||
      out.KeyUsage !== AWS_KMS_SIGN_VERIFY_USAGE ||
      !Array.isArray(algorithms) ||
      !algorithms.every((a) => typeof a === "string") ||
      !algorithms.includes(AWS_KMS_ED25519_ALGORITHM) ||
      !isBytes(out.PublicKey)
    ) {
      throw new KmsTransportError("invalid_response", "getPublicKey");
    }
    return {
      keyId: out.KeyId,
      keySpec: out.KeySpec,
      keyUsage: out.KeyUsage,
      signingAlgorithms: algorithms as string[],
      publicKeySpkiDer: out.PublicKey,
    };
  }
}
