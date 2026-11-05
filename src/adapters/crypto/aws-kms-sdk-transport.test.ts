import { verify as nodeVerify, createPublicKey } from "node:crypto";

import {
  DependencyTimeoutException,
  DisabledException,
  GetPublicKeyCommand,
  InvalidKeyUsageException,
  KMSClient,
  KMSInvalidSignatureException,
  KMSInvalidStateException,
  KMSServiceException,
  KeyUnavailableException,
  NotFoundException,
  SignCommand,
  VerifyCommand,
} from "@aws-sdk/client-kms";
import { fc, test as fcTest } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";

import {
  AWS_KMS_ED25519_ALGORITHM,
  AWS_KMS_ED25519_KEY_SPEC,
  AWS_KMS_RAW_MESSAGE_TYPE,
  AWS_KMS_SIGN_VERIFY_USAGE,
  AwsKmsEd25519SigningKeyProvider,
} from "./aws-kms-ed25519-signer";
import {
  AwsSdkKmsEd25519Transport,
  KmsTransportError,
  type KmsCommandSender,
  type KmsTransportErrorKind,
} from "./aws-kms-sdk-transport";
import { FakeKmsClient } from "./fake-kms-client";

const ARN = "arn:aws:kms:eu-central-1:000000000000:key/sinteticki-1";
const OTHER_ARN = "arn:aws:kms:eu-central-1:000000000000:key/sinteticki-2";
const MESSAGE = new TextEncoder().encode("sinteticka-potvrda");
const SIG64 = new Uint8Array(64).fill(7);
const SPKI = new Uint8Array([48, 42, 48, 5, 6, 3, 43, 101, 112, 3, 33, 0, ...new Uint8Array(32)]);

// The real SDK client must fit the narrow port, or composition (M3.8-P03) cannot use it.
const kmsClientFitsSender: KMSClient extends KmsCommandSender ? true : never = true;
void kmsClientFitsSender;

type Op = "sign" | "verify" | "getPublicKey";

function stub(respond: (command: unknown, signal?: AbortSignal) => Promise<unknown>) {
  const sender: KmsCommandSender = {
    send: (command, options) => respond(command, options?.abortSignal),
  };
  return new AwsSdkKmsEd25519Transport(sender, { timeoutMs: 50 });
}

function call(transport: AwsSdkKmsEd25519Transport, op: Op, keyId = ARN): Promise<unknown> {
  const base = {
    keyId,
    message: MESSAGE,
    messageType: AWS_KMS_RAW_MESSAGE_TYPE,
    signingAlgorithm: AWS_KMS_ED25519_ALGORITHM,
  };
  if (op === "sign") return transport.sign(base);
  if (op === "verify") return transport.verify({ ...base, signature: SIG64 });
  return transport.getPublicKey({ keyId });
}

const okOutput: Record<Op, Record<string, unknown>> = {
  sign: { KeyId: ARN, SigningAlgorithm: AWS_KMS_ED25519_ALGORITHM, Signature: SIG64 },
  verify: { KeyId: ARN, SigningAlgorithm: AWS_KMS_ED25519_ALGORITHM, SignatureValid: true },
  getPublicKey: {
    KeyId: ARN,
    KeySpec: AWS_KMS_ED25519_KEY_SPEC,
    KeyUsage: AWS_KMS_SIGN_VERIFY_USAGE,
    SigningAlgorithms: [AWS_KMS_ED25519_ALGORITHM],
    PublicKey: SPKI,
  },
};

const meta = { $metadata: {} };
function netError(code: string): Error {
  return Object.assign(new Error(`socket ${code}`), { code });
}

// Input classes from the DAN-295 contract (#1091): every failure class, for every operation.
const FAILURES: Array<[string, () => unknown, KmsTransportErrorKind]> = [
  ["access denied (unmodelled in the KMS SDK)", () => new KMSServiceException({ name: "AccessDeniedException", $fault: "client", message: "x", ...meta }), "access_denied"],
  ["missing key", () => new NotFoundException({ message: "x", ...meta }), "key_not_found"],
  ["SDK timeout", () => Object.assign(new Error("timed out"), { name: "TimeoutError" }), "timeout"],
  ["KMS dependency timeout", () => new DependencyTimeoutException({ message: "x", ...meta }), "timeout"],
  ["connection reset", () => netError("ECONNRESET"), "network"],
  ["DNS failure", () => netError("ENOTFOUND"), "network"],
  ["connection refused", () => netError("ECONNREFUSED"), "network"],
  ["DNS retry", () => netError("EAI_AGAIN"), "network"],
  ["fault-less error", () => new Error("boom"), "network"],
  ["non-error rejection", () => "string", "network"],
  ["disabled key", () => new DisabledException({ message: "x", ...meta }), "service_error"],
  ["invalid key state", () => new KMSInvalidStateException({ message: "x", ...meta }), "service_error"],
  ["key unavailable", () => new KeyUnavailableException({ message: "x", ...meta }), "service_error"],
  ["wrong key usage", () => new InvalidKeyUsageException({ message: "x", ...meta }), "service_error"],
  ["unknown service error", () => new KMSServiceException({ name: "ThrottlingException", $fault: "client", message: "x", ...meta }), "service_error"],
];

const INVALID: Array<[Op, string, Record<string, unknown> | null]> = [
  ["sign", "null output", null],
  ["sign", "missing KeyId", { ...okOutput.sign, KeyId: undefined }],
  ["sign", "blank KeyId", { ...okOutput.sign, KeyId: " " }],
  ["sign", "other algorithm", { ...okOutput.sign, SigningAlgorithm: "ECDSA_SHA_256" }],
  ["sign", "signature as string", { ...okOutput.sign, Signature: "AAAA" }],
  ["sign", "63-byte signature", { ...okOutput.sign, Signature: new Uint8Array(63) }],
  ["sign", "65-byte signature", { ...okOutput.sign, Signature: new Uint8Array(65) }],
  ["sign", "answer for another key", { ...okOutput.sign, KeyId: OTHER_ARN }],
  ["verify", "null output", null],
  ["verify", "SignatureValid missing", { KeyId: ARN }],
  ["verify", "SignatureValid as string", { ...okOutput.verify, SignatureValid: "true" }],
  // QA c.6585451053: a boolean alone is not a complete answer to the same request.
  ["verify", "only SignatureValid", { SignatureValid: true }],
  ["verify", "missing KeyId", { ...okOutput.verify, KeyId: undefined }],
  ["verify", "blank KeyId", { ...okOutput.verify, KeyId: " " }],
  ["verify", "answer for another key", { ...okOutput.verify, KeyId: OTHER_ARN }],
  ["verify", "missing algorithm", { ...okOutput.verify, SigningAlgorithm: undefined }],
  ["verify", "other algorithm", { ...okOutput.verify, SigningAlgorithm: "ECDSA_SHA_256" }],
  ["verify", "other key, SignatureValid false", { ...okOutput.verify, KeyId: OTHER_ARN, SignatureValid: false }],
  ["getPublicKey", "null output", null],
  ["getPublicKey", "missing PublicKey", { ...okOutput.getPublicKey, PublicKey: undefined }],
  ["getPublicKey", "empty PublicKey", { ...okOutput.getPublicKey, PublicKey: new Uint8Array() }],
  ["getPublicKey", "other KeySpec", { ...okOutput.getPublicKey, KeySpec: "ECC_NIST_P256" }],
  ["getPublicKey", "other KeyUsage", { ...okOutput.getPublicKey, KeyUsage: "ENCRYPT_DECRYPT" }],
  ["getPublicKey", "no Ed25519 algorithm", { ...okOutput.getPublicKey, SigningAlgorithms: ["ECDSA_SHA_256"] }],
  ["getPublicKey", "algorithms not an array", { ...okOutput.getPublicKey, SigningAlgorithms: "ED25519_SHA_512" }],
  ["getPublicKey", "missing KeyId", { ...okOutput.getPublicKey, KeyId: undefined }],
  ["getPublicKey", "answer for another key", { ...okOutput.getPublicKey, KeyId: OTHER_ARN }],
];

async function expectKind(promise: Promise<unknown>, kind: KmsTransportErrorKind, op: Op) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(KmsTransportError);
  expect((error as KmsTransportError).kind).toBe(kind);
  expect((error as KmsTransportError).operation).toBe(op);
  expect((error as Error).message).not.toContain(ARN);
}

describe("AwsSdkKmsEd25519Transport input classes", () => {
  const OPS: Op[] = ["sign", "verify", "getPublicKey"];

  it.each(OPS)("success: %s maps the SDK command and output", async (op) => {
    const seen: unknown[] = [];
    const transport = stub(async (command) => {
      seen.push(command);
      return okOutput[op];
    });
    const result = await call(transport, op);
    const command = seen[0];
    if (op === "sign") {
      expect(command).toBeInstanceOf(SignCommand);
      expect((command as SignCommand).input).toEqual({
        KeyId: ARN,
        Message: MESSAGE,
        MessageType: "RAW",
        SigningAlgorithm: "ED25519_SHA_512",
      });
      expect(result).toEqual({ keyId: ARN, signingAlgorithm: AWS_KMS_ED25519_ALGORITHM, signature: SIG64 });
    } else if (op === "verify") {
      expect(command).toBeInstanceOf(VerifyCommand);
      expect((command as VerifyCommand).input).toEqual({
        KeyId: ARN,
        Message: MESSAGE,
        Signature: SIG64,
        MessageType: "RAW",
        SigningAlgorithm: "ED25519_SHA_512",
      });
      expect(result).toBe(true);
    } else {
      expect(command).toBeInstanceOf(GetPublicKeyCommand);
      expect((command as GetPublicKeyCommand).input).toEqual({ KeyId: ARN });
      expect(result).toEqual({
        keyId: ARN,
        keySpec: AWS_KMS_ED25519_KEY_SPEC,
        keyUsage: AWS_KMS_SIGN_VERIFY_USAGE,
        signingAlgorithms: [AWS_KMS_ED25519_ALGORITHM],
        publicKeySpkiDer: SPKI,
      });
    }
  });

  for (const op of OPS) {
    it.each(FAILURES)(`${op}: %s is classified`, async (_label, make, kind) => {
      await expectKind(call(stub(() => Promise.reject(make())), op), kind, op);
    });

    it(`${op}: a synchronous throw is classified, not leaked`, async () => {
      const sender: KmsCommandSender = {
        send: () => {
          throw new NotFoundException({ message: "x", ...meta });
        },
      };
      await expectKind(call(new AwsSdkKmsEd25519Transport(sender, { timeoutMs: 50 }), op), "key_not_found", op);
    });

    it(`${op}: no answer within the deadline is a timeout and aborts the request`, async () => {
      let aborted = false;
      const transport = stub(
        (_command, signal) =>
          new Promise(() => {
            signal?.addEventListener("abort", () => (aborted = true));
          }),
      );
      await expectKind(call(transport, op), "timeout", op);
      expect(aborted).toBe(true);
    });

    it(`${op}: an AbortError raised by our own abort is still a timeout`, async () => {
      const transport = stub(
        (_command, signal) =>
          new Promise((_, reject) => {
            signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            );
          }),
      );
      await expectKind(call(transport, op), "timeout", op);
    });

    it(`${op}: an answer after the deadline is discarded, a late failure is not unhandled`, async () => {
      const late = (value: unknown, fail: boolean) =>
        stub(
          () =>
            new Promise((resolve, reject) =>
              setTimeout(() => (fail ? reject(new Error("late")) : resolve(value)), 120),
            ),
        );
      await expectKind(call(late(okOutput[op], false), op), "timeout", op);
      await expectKind(call(late(null, true), op), "timeout", op);
      await new Promise((r) => setTimeout(r, 150));
    });
  }

  it.each(INVALID)("%s: %s is an invalid response", async (op, _label, output) => {
    await expectKind(call(stub(async () => output), op), "invalid_response", op);
  });

  it("verify: KMSInvalidSignatureException is false, SignatureValid false is false", async () => {
    const rejected = stub(() =>
      Promise.reject(new KMSInvalidSignatureException({ message: "x", ...meta })),
    );
    expect(await call(rejected, "verify")).toBe(false);
    const answer = { ...okOutput.verify, SignatureValid: false };
    expect(await call(stub(async () => answer), "verify")).toBe(false);
  });

  // QA c.6585451053: the answer must name the key the request asked for.
  const ALIAS = "alias/ductus-sinteticki";
  const BINDING: Array<[string, string, string, boolean]> = [
    ["alias, any key ARN", ALIAS, OTHER_ARN, true],
    ["alias ARN, any key ARN", "arn:aws:kms:eu-central-1:000000000000:alias/ductus-sinteticki", ARN, true],
    ["alias, answer names the alias", ALIAS, ALIAS, false],
    ["bare key id, its ARN", "sinteticki-1", ARN, true],
    ["bare key id, another key", "sinteticki-1", OTHER_ARN, false],
    ["bare key id, longer id", "sinteticki-1", "arn:aws:kms:eu-central-1:000000000000:key/xsinteticki-1", false],
    ["key ARN, bare id back", ARN, "sinteticki-1", false],
  ];
  it.each(OPS.flatMap((op) => BINDING.map((row) => [op, ...row] as const)))(
    "%s: %s is %s",
    async (op, _name, requested, returned, ok) => {
      const t = stub(async () => ({ ...okOutput[op], KeyId: returned }));
      if (ok) {
        await expect(call(t, op, requested)).resolves.toBeDefined();
      } else {
        await expectKind(call(t, op, requested), "invalid_response", op);
      }
    },
  );

  it("KMSInvalidSignatureException on sign is a service error, not false", async () => {
    const t = stub(() => Promise.reject(new KMSInvalidSignatureException({ message: "x", ...meta })));
    await expectKind(call(t, "sign"), "service_error", "sign");
  });

  // Orchestrator addition to the contract (#1091 c.6584610964): a renamed or
  // unknown SDK exception is always service_error, never success.
  const KNOWN = new Set([
    "AccessDeniedException",
    "NotFoundException",
    "KMSInvalidSignatureException",
    "TimeoutError",
    "RequestTimeout",
    "RequestTimeoutException",
    "DependencyTimeoutException",
  ]);
  it.each(["AccessDenied", "KeyNotFoundException", "notfoundexception", "", "Timeout"])(
    "renamed SDK exception %j is service_error on every operation",
    async (name) => {
      for (const op of OPS) {
        const error = new KMSServiceException({ name, $fault: "server", message: "x", ...meta });
        await expectKind(call(stub(() => Promise.reject(error)), op), "service_error", op);
      }
    },
  );

  fcTest.prop([
    fc.string().filter((name) => !KNOWN.has(name)),
    fc.constantFrom<"client" | "server">("client", "server"),
    fc.constantFrom<Op>("sign", "verify", "getPublicKey"),
  ])("any unknown SDK exception name is service_error, never success", async (name, fault, op) => {
    const error = new KMSServiceException({ name, $fault: fault, message: "x", ...meta });
    await expectKind(call(stub(() => Promise.reject(error)), op), "service_error", op);
  });

  it("concurrent calls keep separate deadlines", async () => {
    const transport = stub((command) =>
      command instanceof SignCommand ? new Promise(() => {}) : Promise.resolve(okOutput.getPublicKey),
    );
    const [signed, key] = await Promise.allSettled([call(transport, "sign"), call(transport, "getPublicKey")]);
    expect(signed.status).toBe("rejected");
    expect((signed as PromiseRejectedResult).reason).toMatchObject({ kind: "timeout" });
    expect(key).toMatchObject({ status: "fulfilled", value: { keyId: ARN } });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])("rejects timeoutMs %s", (timeoutMs) => {
    expect(() => new AwsSdkKmsEd25519Transport({ send: async () => ({}) }, { timeoutMs })).toThrow(
      "aws-kms: timeoutMs must be a positive integer",
    );
  });
});

describe("FakeKmsClient behind the SDK transport", () => {
  const ALIAS = "alias/ductus-sinteticki";

  function setup() {
    const fake = new FakeKmsClient();
    const first = fake.createKey(ALIAS);
    const transport = new AwsSdkKmsEd25519Transport(fake, { timeoutMs: 50 });
    return { fake, first, transport };
  }

  it("signs end to end through the provider and the signature verifies with the public key", async () => {
    const { first, transport } = setup();
    const provider = new AwsKmsEd25519SigningKeyProvider(transport, ALIAS, [first]);
    const envelope = await provider.sign(MESSAGE);
    expect(envelope.keyVersion).toBe(first);
    expect(await provider.verify(MESSAGE, envelope)).toBe(true);
    expect(await provider.verify(new TextEncoder().encode("drugo"), envelope)).toBe(false);

    const key = await provider.publicVerificationKey();
    const publicKey = createPublicKey({ key: Buffer.from(key.keyBase64Url, "base64url"), format: "der", type: "spki" });
    expect(nodeVerify(null, MESSAGE, publicKey, Buffer.from(envelope.signatureBase64Url, "base64url"))).toBe(true);
  });

  it("maps each fake fault to its class", async () => {
    const { fake, first, transport } = setup();
    const input = { keyId: first, message: MESSAGE, messageType: AWS_KMS_RAW_MESSAGE_TYPE, signingAlgorithm: AWS_KMS_ED25519_ALGORITHM } as const;
    await expectKind(transport.sign({ ...input, keyId: "alias/nepostojeci" }), "key_not_found", "sign");
    fake.deny(first);
    await expectKind(transport.sign(input), "access_denied", "sign");
    fake.allow(first);
    fake.fault = "network";
    await expectKind(transport.getPublicKey({ keyId: first }), "network", "getPublicKey");
    fake.fault = "hang";
    await expectKind(transport.verify({ ...input, signature: SIG64 }), "timeout", "verify");
    fake.fault = null;
    expect(await transport.verify({ ...input, signature: SIG64 })).toBe(false);
    await expectKind(transport.sign({ ...input, message: new Uint8Array(4097) }), "service_error", "sign");
  });

  it("an alias rotated between two calls is refused unless the new version is trusted", async () => {
    const { fake, first, transport } = setup();
    const provider = new AwsKmsEd25519SigningKeyProvider(transport, ALIAS, [first]);
    const before = await provider.sign(MESSAGE);
    const second = fake.createKey(ALIAS);
    await expect(provider.sign(MESSAGE)).rejects.toThrow("aws-kms: signing key version not trusted");
    await expect(provider.publicVerificationKey()).rejects.toThrow("aws-kms: signing key version not trusted");
    // The pinned historical version still verifies after rotation.
    expect(await provider.verify(MESSAGE, before)).toBe(true);
    const rotated = new AwsKmsEd25519SigningKeyProvider(transport, ALIAS, [first, second]);
    expect((await rotated.sign(MESSAGE)).keyVersion).toBe(second);
  });

  it("refuses construction outside development and test", () => {
    const previous = process.env.NODE_ENV;
    try {
      for (const env of ["production", "", "prod", "Test"]) {
        (process.env as Record<string, string>).NODE_ENV = env;
        expect(() => new FakeKmsClient()).toThrow("fake KMS is prohibited outside development and test");
      }
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = previous;
    }
  });
});
