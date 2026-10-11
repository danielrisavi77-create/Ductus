import { describe, expect, it } from "vitest";

import {
  EVIDENCE_STORAGE_DOMAINS,
  EvidenceStorageConfigError,
  loadEvidenceStorageConfig,
} from "./evidence-storage-config";

// Invented institutions and credentials; nothing here is a real secret.
const FAK_A = "00000000-0000-4000-8000-00000000000a";
const FAK_B = "00000000-0000-4000-8000-00000000000b";
const SECRET_A = "secret-a-canary";
const SECRET_B = "secret-b-canary";

// Variable names only; built here so no literal looks like a key to scanners.
const credentialVars = (name: string) => ({
  accessKeyIdVar: `EVIDENCE_S3_${name}_KEY_ID`,
  secretAccessKeyVar: `EVIDENCE_S3_${name}_SECRET`,
});

const domainA = {
  label: "fak-a-eu-1",
  institutionId: FAK_A,
  endpoint: "https://s3.example.eu",
  region: "eu-central-1",
  bucket: "ductus-fak-a",
  ...credentialVars("FAK_A"),
};
const domainB = {
  ...domainA,
  label: "fak-b-eu-1",
  institutionId: FAK_B,
  bucket: "ductus-fak-b",
  ...credentialVars("FAK_B"),
};
const secrets = {
  EVIDENCE_S3_FAK_A_KEY_ID: "key-a",
  EVIDENCE_S3_FAK_A_SECRET: SECRET_A,
  EVIDENCE_S3_FAK_B_KEY_ID: "key-b",
  EVIDENCE_S3_FAK_B_SECRET: SECRET_B,
};

function envWith(config: unknown, extra: Record<string, string> = {}) {
  return {
    ...secrets,
    [EVIDENCE_STORAGE_DOMAINS]:
      typeof config === "string" ? config : JSON.stringify(config),
    ...extra,
  };
}

const config = (domains: unknown[], top: Record<string, unknown> = {}) => ({
  requestTimeoutMs: 5_000,
  domains,
  ...top,
});

/** The error the load stops with; it must never carry a value. */
function refusal(env: Record<string, string | undefined>): Error {
  try {
    loadEvidenceStorageConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(EvidenceStorageConfigError);
    const message = (error as Error).message;
    for (const value of [SECRET_A, SECRET_B, "key-a", "key-b", "s3.example"]) {
      expect(message).not.toContain(value);
    }
    return error as Error;
  }
  throw new Error("configuration was accepted");
}

describe("loadEvidenceStorageConfig", () => {
  it("loads one domain per institution with credentials from the named variables", () => {
    expect(loadEvidenceStorageConfig(envWith(config([domainA, domainB])))).toEqual({
      requestTimeoutMs: 5_000,
      domains: [
        {
          label: "fak-a-eu-1",
          institutionId: FAK_A,
          endpoint: "https://s3.example.eu",
          region: "eu-central-1",
          bucket: "ductus-fak-a",
          credentials: { accessKeyId: "key-a", secretAccessKey: SECRET_A },
        },
        {
          label: "fak-b-eu-1",
          institutionId: FAK_B,
          endpoint: "https://s3.example.eu",
          region: "eu-central-1",
          bucket: "ductus-fak-b",
          credentials: { accessKeyId: "key-b", secretAccessKey: SECRET_B },
        },
      ],
    });
  });

  it.each<[string, Record<string, string | undefined>, RegExp]>([
    ["no variable", { [EVIDENCE_STORAGE_DOMAINS]: undefined }, /is not set/],
    ["a blank variable", { [EVIDENCE_STORAGE_DOMAINS]: "  " }, /is not set/],
    ["text that is not JSON", envWith("{domains"), /not valid JSON/],
    ["a list at the top", envWith([domainA]), /must be an object/],
    ["no timeout", envWith({ domains: [domainA] }), /requestTimeoutMs is missing/],
    ["no domain list", envWith({ requestTimeoutMs: 5_000 }), /domains must be a list/],
    ["an unknown top-level field", envWith(config([domainA], { fallbackBucket: "x" })), /unknown field/],
    ["an unknown domain field", envWith(config([{ ...domainA, default: true }])), /domain 0: unknown field/],
    ["a domain that is not an object", envWith(config(["fak-a"])), /domain 0 must be an object/],
    ["an invalid label", envWith(config([{ ...domainA, label: "Fak_A" }])), /label is not valid/],
    ["an upper-case institution", envWith(config([{ ...domainA, institutionId: FAK_A.toUpperCase() }])), /not a lowercase UUID/],
    ["a missing bucket", envWith(config([{ ...domainA, bucket: "" }])), /bucket is missing/],
    ["a missing region", envWith(config([{ ...domainA, region: undefined }])), /region is missing/],
  ])("stops startup on %s", (_, env, message) => {
    expect(refusal(env).message).toMatch(message);
  });

  it("never falls back when an institution has no domain (P2)", () => {
    const loaded = loadEvidenceStorageConfig(envWith(config([domainA])));
    expect(loaded.domains.map((d) => d.institutionId)).toEqual([FAK_A]);
    // An empty list is a valid configuration: no institution gets storage.
    expect(loadEvidenceStorageConfig(envWith(config([]))).domains).toEqual([]);
  });

  describe("S14: plain http only to loopback", () => {
    it.each([
      "http://s3.example.eu",
      "http://10.0.0.1:9000",
      "http://ductus-objects:9000",
      "ftp://s3.example.eu",
      "s3.example.eu",
    ])("stops startup on endpoint %s", (endpoint) => {
      expect(
        refusal(envWith(config([{ ...domainA, endpoint }]))).message,
      ).toMatch(/endpoint (must use https outside loopback|is not a URL)/);
    });

    it.each(["http://127.0.0.1:9100", "http://localhost:9100", "http://[::1]:9100"])(
      "accepts loopback endpoint %s",
      (endpoint) => {
        expect(
          loadEvidenceStorageConfig(envWith(config([{ ...domainA, endpoint }])))
            .domains[0].endpoint,
        ).toBe(endpoint);
      },
    );
  });

  describe("credentials", () => {
    it.each(["S3_SECRET", "DATABASE_URL", "EVIDENCE_S3_", "evidence_s3_a", "EVIDENCE_S3_A-B"])(
      "refuses a credential variable named %s",
      (name) => {
        expect(
          refusal(envWith(config([{ ...domainA, secretAccessKeyVar: name }]))).message,
        ).toMatch(/must be named EVIDENCE_S3_\*/);
      },
    );

    it.each([undefined, ""])("stops startup when a named secret is %j", (value) => {
      const env = envWith(config([domainA]), {});
      env.EVIDENCE_S3_FAK_A_SECRET = value as string;
      expect(refusal(env).message).toMatch(/EVIDENCE_S3_FAK_A_SECRET is not set/);
    });
  });

  describe("P9: domains share nothing", () => {
    it.each<[string, Record<string, unknown>, RegExp]>([
      ["label", { label: domainA.label }, /share one label/],
      ["institution", { institutionId: FAK_A }, /share one institution/],
      ["bucket", { bucket: domainA.bucket }, /share one bucket/],
      ["bucket on another endpoint", { bucket: domainA.bucket, endpoint: "https://s3.other.eu" }, /share one bucket/],
      ["access key", { accessKeyIdVar: domainA.accessKeyIdVar }, /share one access key/],
    ])("refuses two domains with one %s", (_, change, message) => {
      const error = refusal(envWith(config([domainA, { ...domainB, ...change }])));
      expect(error.message).toMatch(message);
    });

    it("refuses one access key in two variables as well", () => {
      const env = envWith(config([domainA, domainB]), {
        EVIDENCE_S3_FAK_B_KEY_ID: "key-a",
      });
      expect(refusal(env).message).toMatch(/fak-a-eu-1 and fak-b-eu-1 share one access key/);
    });

    it("allows a shared key only when asked for and every endpoint is on loopback", () => {
      const local = (endpoint: string) => ({ endpoint });
      const shared = [
        { ...domainA, ...local("http://127.0.0.1:9100") },
        { ...domainB, ...local("http://127.0.0.1:9100"), accessKeyIdVar: domainA.accessKeyIdVar, secretAccessKeyVar: domainA.secretAccessKeyVar },
      ];

      expect(refusal(envWith(config(shared))).message).toMatch(/share one access key/);
      expect(
        loadEvidenceStorageConfig(envWith(config(shared, { sharedCredentials: "loopback-only" })))
          .domains.map((d) => d.credentials.accessKeyId),
      ).toEqual(["key-a", "key-a"]);
    });

    it.each([
      ["one remote endpoint", { sharedCredentials: "loopback-only" }, /allowed only on loopback endpoints/],
      ["another mode", { sharedCredentials: "always" }, /may only be "loopback-only"/],
    ])("refuses shared credentials with %s", (_, top, message) => {
      const domains = [
        { ...domainA, endpoint: "http://127.0.0.1:9100" },
        { ...domainB, accessKeyIdVar: domainA.accessKeyIdVar },
      ];
      expect(refusal(envWith(config(domains, top))).message).toMatch(message);
    });
  });
});
