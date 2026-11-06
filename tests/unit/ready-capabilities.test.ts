import { afterEach, describe, expect, it, vi } from "vitest";

import { DevelopmentSigningKeyError } from "@/adapters/crypto/persistent-development-ed25519-signer";
import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import { STORAGE_NOT_CONFIGURED, type ProcessEvidencePayloads } from "@/server/evidence/payload-reader";
import {
  CAPABILITIES,
  CAPABILITY_TIMEOUT_MS,
  checkCapabilities,
  type Capability,
  type CapabilityProbe,
} from "@/server/ready";
import { databaseProbe, signingProbe, storageProbe, workerQueueProbe } from "@/server/ready-probes";

afterEach(() => {
  vi.useRealTimers();
});

const SECRET = "postgres://user:pw@db.internal:5432/ductus s3.internal key=AKIA0000";

const allReady = (): Record<Capability, CapabilityProbe> => ({
  database: async () => "ready",
  storage: async () => "ready",
  signing: async () => "ready",
  worker_queue: async () => "ready",
});

// DAN-585: the input classes of one probe, as the contract on #1091 lists them.
const PROBE_CLASSES: [string, () => CapabilityProbe, "ready" | "unavailable" | "not_configured", string | null][] = [
  ["resolves ready", () => async () => "ready", "ready", null],
  ["resolves not_configured", () => async () => "not_configured", "not_configured", null],
  ["resolves unavailable", () => async () => "unavailable", "unavailable", "UNAVAILABLE"],
  ["resolves a value outside the closed set", () => (async () => "yes") as unknown as CapabilityProbe, "unavailable", "UNEXPECTED"],
  ["resolves nothing", () => (async () => undefined) as unknown as CapabilityProbe, "unavailable", "UNEXPECTED"],
  ["rejects with a coded Error", () => async () => Promise.reject(Object.assign(new Error(SECRET), { code: "ECONNREFUSED" })), "unavailable", "ECONNREFUSED"],
  ["rejects with a code that is not closed", () => async () => Promise.reject(Object.assign(new Error("x"), { code: SECRET })), "unavailable", "ERROR"],
  ["rejects with a non-Error", () => async () => Promise.reject(SECRET), "unavailable", "ERROR"],
  ["throws synchronously", () => (() => { throw new Error(SECRET); }) as unknown as CapabilityProbe, "unavailable", "ERROR"],
  ["is not a function", () => SECRET as unknown as CapabilityProbe, "unavailable", "ERROR"],
];

describe("checkCapabilities: one probe per input class", () => {
  it.each(PROBE_CLASSES)("storage %s", async (_name, make, state, code) => {
    const result = await checkCapabilities({ ...allReady(), storage: make() });
    expect(result.capabilities.storage).toBe(state);
    expect(result.faults).toEqual(code === null ? [] : [{ capability: "storage", code }]);
    expect(result.ready).toBe(state !== "unavailable");
    expect(JSON.stringify(result)).not.toMatch(/postgres|pw|internal|AKIA/);
  });

  it("a probe that never answers is unavailable after its own timeout and no later", async () => {
    vi.useFakeTimers();
    const pending = checkCapabilities(
      { ...allReady(), signing: () => new Promise(() => {}) },
      { ...CAPABILITY_TIMEOUT_MS, signing: 50 },
    );
    await vi.advanceTimersByTimeAsync(50);
    const result = await pending;
    expect(result.capabilities.signing).toBe("unavailable");
    expect(result.faults).toEqual([{ capability: "signing", code: "TIMEOUT" }]);
    expect(result.ready).toBe(false);
  });

  it("answers every capability, in the closed list, and nothing else", async () => {
    const result = await checkCapabilities(allReady());
    expect(Object.keys(result.capabilities)).toEqual([...CAPABILITIES]);
    expect(CAPABILITIES).toEqual(["database", "storage", "signing", "worker_queue"]);
  });

  it("is not ready without the database even when it is only not configured", async () => {
    const result = await checkCapabilities({ ...allReady(), database: async () => "not_configured" });
    expect(result.ready).toBe(false);
  });

  it("runs the probes side by side: the slowest bounds the wait", async () => {
    vi.useFakeTimers();
    const slow = (ms: number): CapabilityProbe => () => new Promise((resolve) => setTimeout(() => resolve("ready"), ms));
    const pending = checkCapabilities({ database: slow(40), storage: slow(40), signing: slow(40), worker_queue: slow(40) });
    await vi.advanceTimersByTimeAsync(40);
    expect((await pending).ready).toBe(true);
  });

  // Istodobnost: two calls in flight do not share an outcome or a timer.
  it("two concurrent checks with different outcomes keep their own", async () => {
    vi.useFakeTimers();
    const hung = checkCapabilities({ ...allReady(), database: () => new Promise(() => {}) }, { ...CAPABILITY_TIMEOUT_MS, database: 30 });
    const fine = checkCapabilities(allReady(), { ...CAPABILITY_TIMEOUT_MS, database: 30 });
    await vi.advanceTimersByTimeAsync(30);
    const [a, b] = await Promise.all([hung, fine]);
    expect(a.capabilities.database).toBe("unavailable");
    expect(b.capabilities.database).toBe("ready");
    expect(b.faults).toEqual([]);
  });
});

describe("databaseProbe", () => {
  it("runs one anonymous SELECT 1", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const withActor = vi.fn(async (_token: unknown, fn: (tx: { query: typeof query }) => Promise<unknown>) => fn({ query }));
    expect(await databaseProbe(withActor as never)()).toBe("ready");
    expect(withActor.mock.calls[0][0]).toBeNull();
    expect(query).toHaveBeenCalledWith("SELECT 1");
  });

  it("passes the failure on to be coded", async () => {
    const withActor = async () => Promise.reject(Object.assign(new Error(SECRET), { code: "57P01" }));
    const result = await checkCapabilities({ ...allReady(), database: databaseProbe(withActor as never) });
    expect(result.faults).toEqual([{ capability: "database", code: "57P01" }]);
  });
});

const router = (verifyAll: () => Promise<Record<string, string>>) =>
  ({ ...STORAGE_NOT_CONFIGURED, verifyAll }) as unknown as ProcessEvidencePayloads;

describe("storageProbe", () => {
  const CLASSES: [string, () => ProcessEvidencePayloads, "ready" | "unavailable" | "not_configured", string | null][] = [
    ["the unconfigured sentinel", () => STORAGE_NOT_CONFIGURED, "not_configured", null],
    ["a store without a verification interface", () => ({ ...STORAGE_NOT_CONFIGURED }), "not_configured", null],
    ["a router with no domain", () => router(async () => ({})), "not_configured", null],
    ["every domain verified", () => router(async () => ({ "fak-a": "verified", "fak-b": "verified" })), "ready", null],
    ["a domain still unverified", () => router(async () => ({ "fak-a": "verified", "fak-b": "unverified" })), "unavailable", "storage_domain_unverified"],
    ["a disabled domain", () => router(async () => ({ "fak-a": "disabled", "fak-b": "unverified" })), "unavailable", "storage_domain_disabled"],
    ["a state outside the closed set", () => router(async () => ({ "fak-a": "maybe" })), "unavailable", "storage_domain_unverified"],
    ["verifyAll throws", () => router(async () => Promise.reject(new Error(SECRET))), "unavailable", "ERROR"],
  ];

  it.each(CLASSES)("%s", async (_name, make, state, code) => {
    const result = await checkCapabilities({ ...allReady(), storage: storageProbe(make) });
    expect(result.capabilities.storage).toBe(state);
    expect(result.faults).toEqual(code === null ? [] : [{ capability: "storage", code }]);
    expect(JSON.stringify(result)).not.toMatch(/fak-|internal/);
  });

  it("a storage getter that throws is unavailable, not a failed route", async () => {
    const result = await checkCapabilities({
      ...allReady(),
      storage: storageProbe(() => {
        throw new Error(SECRET);
      }),
    });
    expect(result.capabilities.storage).toBe("unavailable");
  });
});

const signer = (publicVerificationKey: SigningKeyProvider["publicVerificationKey"]): SigningKeyProvider => ({
  sign: () => Promise.reject(new Error("not used")),
  verify: () => Promise.reject(new Error("not used")),
  publicVerificationKey,
});

describe("signingProbe", () => {
  const key = { algorithm: "Ed25519", keyId: "k", keyVersion: "v", encoding: "spki-der", keyBase64Url: "AAAA" } as const;
  const CLASSES: [string, () => SigningKeyProvider, "ready" | "unavailable" | "not_configured", string | null][] = [
    ["the key is available", () => signer(async () => key), "ready", null],
    ["a production build without KMS", () => signer(() => Promise.reject(new DevelopmentSigningKeyError("signing_key_production"))), "not_configured", null],
    ["no seed named", () => signer(() => Promise.reject(new DevelopmentSigningKeyError("signing_key_not_configured"))), "not_configured", null],
    ["a named seed that is missing", () => signer(() => Promise.reject(new DevelopmentSigningKeyError("signing_key_missing"))), "unavailable", "signing_key_missing"],
    ["a seed with open permissions", () => signer(() => Promise.reject(new DevelopmentSigningKeyError("signing_key_permissions"))), "unavailable", "signing_key_permissions"],
    ["a generic error with text", () => signer(() => Promise.reject(new Error(SECRET))), "unavailable", "ERROR"],
    ["an empty key", () => signer(async () => ({ ...key, keyBase64Url: "" })), "unavailable", "signing_key_invalid"],
    ["no key at all", () => signer(async () => undefined as never), "unavailable", "signing_key_invalid"],
  ];

  it.each(CLASSES)("%s", async (_name, make, state, code) => {
    const result = await checkCapabilities({ ...allReady(), signing: signingProbe(make) });
    expect(result.capabilities.signing).toBe(state);
    expect(result.faults).toEqual(code === null ? [] : [{ capability: "signing", code }]);
    expect(JSON.stringify(result)).not.toMatch(/AAAA|internal/);
  });
});

describe("workerQueueProbe", () => {
  it("is not configured: the web process has no queue adapter", async () => {
    expect(await workerQueueProbe()).toBe("not_configured");
  });
});
