import { afterEach, describe, expect, it, vi } from "vitest";

import { InstitutionRoutedPayloadStore } from "@/adapters/evidence/institution-routed-payload-store";

import { createEvidencePayloadReader, STORAGE_NOT_CONFIGURED } from "./payload-reader";

// Synthetic only: invented institutions, bucket names and a placeholder key.
const FAK_A = "11111111-1111-4111-8111-111111111111";
const FAK_B = "22222222-2222-4222-8222-222222222222";
const SECRET = "izmisljeni-tajni-kljuc-samo-za-test";
const ENDPOINT = "https://s3.example.eu";

function env(over: Record<string, string | undefined> = {}) {
  return {
    EVIDENCE_STORAGE_DOMAINS: JSON.stringify({
      requestTimeoutMs: 1_000,
      domains: [
        {
          label: "fak-a-eu-1",
          institutionId: FAK_A,
          endpoint: ENDPOINT,
          region: "eu-central-1",
          bucket: "ductus-fak-a",
          accessKeyIdVar: "EVIDENCE_S3_LOCAL_KEY_ID",
          secretAccessKeyVar: "EVIDENCE_S3_LOCAL_SECRET",
          capability: {
            provider: "test-only",
            endpoint: ENDPOINT,
            conditionalWrite: "verified",
            checksumEcho: "verified",
            verifiedOn: "2026-10-11",
            contractTest: "local-stack/s3-evidence-payload-store.integration",
          },
        },
      ],
    }),
    EVIDENCE_S3_LOCAL_KEY_ID: "TESTKEYID0000000",
    EVIDENCE_S3_LOCAL_SECRET: SECRET,
    NODE_ENV: "test",
    ...over,
  };
}

const read = { evidencePackageId: "pkg-ana-z1", segmentHash: "a".repeat(64) };

afterEach(() => vi.restoreAllMocks());

describe("createEvidencePayloadReader (B-13 step 4, B2)", () => {
  it("builds the router over the configured storage domains", () => {
    const log = vi.fn();
    expect(createEvidencePayloadReader(env(), log)).toBeInstanceOf(InstitutionRoutedPayloadStore);
    expect(log).not.toHaveBeenCalled();
  });

  it("never reads an institution without a domain from another one (P2)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.spyOn(globalThis, "fetch");
    const reader = createEvidencePayloadReader(env(), vi.fn());
    await expect(reader.readImmutable({ institutionId: FAK_B, ...read })).resolves.toEqual({
      status: "unavailable",
      reason: "storage_unavailable",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers every read as unavailable when storage is not configured, and logs no value", async () => {
    const cases = [
      env({ EVIDENCE_STORAGE_DOMAINS: undefined }),
      env({ EVIDENCE_STORAGE_DOMAINS: "{" }),
      env({ EVIDENCE_S3_LOCAL_SECRET: undefined }),
      env({ EVIDENCE_STORAGE_DOMAINS: env().EVIDENCE_STORAGE_DOMAINS.replace(ENDPOINT, "http://s3.example.eu") }),
    ];
    for (const given of cases) {
      const log = vi.fn();
      const reader = createEvidencePayloadReader(given, log);
      expect(reader).toBe(STORAGE_NOT_CONFIGURED);
      await expect(reader.readImmutable({ institutionId: FAK_A, ...read })).resolves.toEqual({
        status: "unavailable",
        reason: "storage_not_configured",
      });
      // Ingest writes and names nothing either, and never in another bucket.
      const unconfigured = { status: "unavailable", reason: "storage_not_configured" };
      await expect(reader.putImmutable({ institutionId: FAK_A, ...read, canonicalPayload: "{}" })).resolves.toEqual(unconfigured);
      await expect(reader.storageRefFor({ institutionId: FAK_A, ...read })).resolves.toEqual(unconfigured);
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET);
      expect(JSON.stringify(log.mock.calls)).not.toContain("TESTKEYID");
    }
  });

  it("logs a closed code for a fault that is not a configuration error", () => {
    const log = vi.fn();
    const hostile = new Proxy({}, { get: () => { throw new Error(SECRET); } });
    expect(createEvidencePayloadReader(hostile, log)).toBe(STORAGE_NOT_CONFIGURED);
    expect(log).toHaveBeenCalledWith("evidence storage is not configured", "storage_config_failed");
  });
});
