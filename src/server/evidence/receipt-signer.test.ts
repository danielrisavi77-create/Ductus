import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  DevelopmentSigningKeyError,
  PersistentDevelopmentEd25519SigningKeyProvider,
} from "@/adapters/crypto/persistent-development-ed25519-signer";

import { createEvidenceReceiptSigner } from "./receipt-signer";

const MESSAGE = new Uint8Array(59);
const code = (promise: Promise<unknown>) =>
  promise.then(
    () => "signed",
    (error: unknown) => (error instanceof DevelopmentSigningKeyError ? error.code : "other"),
  );

describe("createEvidenceReceiptSigner", () => {
  it("is the persistent development signer outside production", () => {
    expect(createEvidenceReceiptSigner({ NODE_ENV: "development" }, tmpdir())).toBeInstanceOf(
      PersistentDevelopmentEd25519SigningKeyProvider,
    );
  });

  it("refuses every call in production, with no other key in its place (T9)", async () => {
    const signer = createEvidenceReceiptSigner({ NODE_ENV: "production", DUCTUS_DEV_SIGNING_KEY_FILE: "/any/seed" }, tmpdir());
    expect(signer).not.toBeInstanceOf(PersistentDevelopmentEd25519SigningKeyProvider);
    expect(await code(signer.sign(MESSAGE))).toBe("signing_key_production");
    expect(await code(signer.publicVerificationKey())).toBe("signing_key_production");
  });

  it("makes no key when none is configured: no fallback to a key in memory (T5)", async () => {
    const signer = createEvidenceReceiptSigner({ NODE_ENV: "development" }, tmpdir());
    expect(await code(signer.sign(MESSAGE))).toBe("signing_key_not_configured");
  });
});
