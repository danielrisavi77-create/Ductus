import { DevelopmentSigningKeyError } from "@/adapters/crypto/persistent-development-ed25519-signer";
import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import type { WithActor } from "@/server/db";
import { STORAGE_NOT_CONFIGURED, type ProcessEvidencePayloads } from "@/server/evidence/payload-reader";

import type { CapabilityProbe } from "./ready";

// The probes of /api/ready (DAN-585). Each reaches its capability only
// through the port the web process already uses; none adds an adapter or a
// supplier. A probe returns a closed state or rejects with a coded error.

const coded = (code: string) => Object.assign(new Error(code), { code });

/** One anonymous `SELECT 1`, which also passes the app role lock of withActor. */
export function databaseProbe(withActor: WithActor): CapabilityProbe {
  return async () => {
    await withActor(null, (tx) => tx.query("SELECT 1"));
    return "ready";
  };
}

type Verifiable = { verifyAll(): Promise<Readonly<Record<string, string>>> };

/**
 * The storage domains of the process. Ready when every domain's identity
 * label was read and matched (the router's own check, shared with writes);
 * not configured when the process has no storage or no domain.
 */
export function storageProbe(payloads: () => ProcessEvidencePayloads): CapabilityProbe {
  return async () => {
    const store = payloads();
    if (store === STORAGE_NOT_CONFIGURED) return "not_configured";
    const verifyAll = (store as Partial<Verifiable>).verifyAll;
    if (typeof verifyAll !== "function") return "not_configured";
    const states = Object.values(await verifyAll.call(store));
    if (states.length === 0) return "not_configured";
    if (states.includes("disabled")) throw coded("storage_domain_disabled");
    if (!states.every((state) => state === "verified")) throw coded("storage_domain_unverified");
    return "ready";
  };
}

// The signer refuses with these when the process has no key source at all:
// a production build (no KMS adapter yet) or no seed named.
const SIGNING_NOT_CONFIGURED = new Set(["signing_key_production", "signing_key_not_configured"]);

/**
 * The receipt signer of the process, through SigningKeyProvider: ready when
 * its public key can be read. Nothing is signed.
 */
export function signingProbe(signer: () => SigningKeyProvider): CapabilityProbe {
  return async () => {
    let key: Awaited<ReturnType<SigningKeyProvider["publicVerificationKey"]>> | undefined;
    try {
      key = await signer().publicVerificationKey();
    } catch (error) {
      if (error instanceof DevelopmentSigningKeyError && SIGNING_NOT_CONFIGURED.has(error.code)) return "not_configured";
      throw error;
    }
    if (typeof key?.keyBase64Url !== "string" || key.keyBase64Url === "") throw coded("signing_key_invalid");
    return "ready";
  };
}

/**
 * The web process has no adapter to the worker queue: pg-boss is not wired
 * and the backlog function is granted to the worker alone.
 */
export const workerQueueProbe: CapabilityProbe = async () => "not_configured";
