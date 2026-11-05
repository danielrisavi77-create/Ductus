import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { InMemoryEvidencePayloadStore } from "@/adapters/evidence/in-memory-evidence-payload-store";
import { InstitutionRoutedPayloadStore } from "@/adapters/evidence/institution-routed-payload-store";
import { S3EvidencePayloadStore, STORAGE_IDENTITY_KEY } from "@/adapters/evidence/s3-evidence-payload-store";
import { S3SecretCredentials } from "@/adapters/evidence/s3-signature";
import type { EvidencePayloadPutResult } from "@/application/ports/evidence-trust";

// DAN-491 (M1.5b): one contract for every EvidencePayloadStore the server can
// be given, run against each of them. Institutions, packages and texts are
// invented; the S3 below is an in-process stand-in, no network.
const FAK_A = "00000000-0000-4000-8000-00000000000a";
const FAK_B = "00000000-0000-4000-8000-00000000000b";
const PACKAGE = "paket-izmisljeni-1";
const REGION = "eu-central-1";
const payload = (text: string) => JSON.stringify({ text });
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const keyOf = (institutionId: string, text: string) => ({
  institutionId,
  evidencePackageId: PACKAGE,
  segmentHash: sha256(payload(text)),
});
const putOf = (institutionId: string, text: string, bytes = payload(text)) => ({
  ...keyOf(institutionId, text),
  canonicalPayload: bytes,
});
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const NoSuchKey = () =>
  new Response("<?xml version=\"1.0\"?><Error><Code>NoSuchKey</Code></Error>", { status: 404 });

/**
 * In-process S3: path-style buckets, atomic conditional create, the checksum
 * echoed on a stored write and `NoSuchKey` for a missing object. A PUT
 * without `If-None-Match: *` is refused, so an unconditional write cannot pass.
 */
function fakeS3() {
  const objects = new Map<string, Uint8Array>();
  const fetch = vi.fn(async (url: URL | string | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (!new Headers(init?.headers).get("authorization")?.startsWith("AWS4-HMAC-SHA256 ")) {
      return new Response(null, { status: 403 });
    }
    if ((init?.method ?? "GET") === "GET") {
      const found = objects.get(path);
      return found ? new Response(found.slice(), { status: 200 }) : NoSuchKey();
    }
    if (new Headers(init?.headers).get("if-none-match") !== "*") {
      return new Response(null, { status: 400 });
    }
    if (objects.has(path)) return new Response(null, { status: 412 });
    const body = (init?.body as Uint8Array).slice();
    objects.set(path, body);
    const checksum = createHash("sha256").update(body).digest("base64");
    return new Response(null, { status: 200, headers: { "x-amz-checksum-sha256": checksum } });
  });
  return { objects, fetch };
}

function s3Store(s3: ReturnType<typeof fakeS3>, bucket: string, storageDomain: string) {
  const endpoint = "http://127.0.0.1:9100";
  return new S3EvidencePayloadStore({
    endpoint,
    region: REGION,
    bucket,
    storageDomain,
    credentials: new S3SecretCredentials({ accessKeyId: "fake-id", secretAccessKey: "fake-secret" }),
    requestTimeoutMs: 1_000,
    allowPlainHttpOnLoopback: true,
    capability: {
      provider: "fake-s3",
      endpoint,
      conditionalWrite: "verified",
      checksumEcho: "verified",
      verifiedOn: "2026-10-11",
      contractTest: "unit/fake-s3",
    },
    fetch: s3.fetch as typeof fetch,
    warn: () => {},
  });
}

type Subject = {
  putImmutable(input: ReturnType<typeof putOf>): Promise<EvidencePayloadPutResult>;
  readImmutable(input: ReturnType<typeof keyOf>): ReturnType<InMemoryEvidencePayloadStore["readImmutable"]>;
  /** Puts other bytes under a key directly, as a damaged or older object would be. */
  plant(institutionId: string, text: string, bytes: string): Promise<void>;
  /** What the store holds, to see that a refused write changed nothing. */
  snapshot(): string[];
  /** What a put of other bytes under a hash already stored answers. */
  otherBytesUnderStoredHash: "conflict" | "invalid";
};

const bucketOf: Record<string, string> = { [FAK_A]: "ductus-evidence-a", [FAK_B]: "ductus-evidence-b" };
const objectPath = (institutionId: string, text: string) =>
  `/${bucketOf[institutionId]}/v2/${institutionId}/${PACKAGE}/${sha256(payload(text))}.json`;

const snapshotOf = (s3: ReturnType<typeof fakeS3>) =>
  [...s3.objects].map(([path, bytes]) => `${path}=${sha256(bytes)}`).sort();

const subjects: [string, () => Subject][] = [
  [
    "InMemoryEvidencePayloadStore",
    () => {
      const store = new InMemoryEvidencePayloadStore();
      return {
        putImmutable: (input) => store.putImmutable(input),
        readImmutable: (input) => store.readImmutable(input),
        // The memory store does not check bytes against the hash.
        plant: async (institutionId, text, bytes) => {
          expect((await store.putImmutable(putOf(institutionId, text, bytes))).status).toBe("stored");
        },
        snapshot: () => [`size:${store.size}`],
        otherBytesUnderStoredHash: "conflict",
      };
    },
  ],
  [
    "S3EvidencePayloadStore",
    () => {
      const s3 = fakeS3();
      // One bucket per institution in production; here one store per bucket.
      const a = s3Store(s3, bucketOf[FAK_A], "fak-a-eu-1");
      const b = s3Store(s3, bucketOf[FAK_B], "fak-b-eu-1");
      // A malformed institution id goes to the store of A, which refuses it.
      const storeOf = (institutionId: string) => (institutionId === FAK_B ? b : a);
      return {
        putImmutable: (input) => storeOf(input.institutionId).putImmutable(input),
        readImmutable: (input) => storeOf(input.institutionId).readImmutable(input),
        plant: async (institutionId, text, bytes) => {
          s3.objects.set(objectPath(institutionId, text), new TextEncoder().encode(bytes));
        },
        snapshot: () => snapshotOf(s3),
        otherBytesUnderStoredHash: "invalid",
      };
    },
  ],
  [
    "InstitutionRoutedPayloadStore over S3",
    () => {
      const s3 = fakeS3();
      for (const institutionId of [FAK_A, FAK_B]) {
        s3.objects.set(
          `/${bucketOf[institutionId]}/${STORAGE_IDENTITY_KEY}`,
          new TextEncoder().encode(JSON.stringify({ institutionId, region: REGION })),
        );
      }
      const router = new InstitutionRoutedPayloadStore(
        [
          { label: "fak-a-eu-1", institutionId: FAK_A, store: s3Store(s3, bucketOf[FAK_A], "fak-a-eu-1") },
          { label: "fak-b-eu-1", institutionId: FAK_B, store: s3Store(s3, bucketOf[FAK_B], "fak-b-eu-1") },
        ],
        () => {},
      );
      return {
        putImmutable: (input) => router.putImmutable(input),
        readImmutable: (input) => router.readImmutable(input),
        plant: async (institutionId, text, bytes) => {
          s3.objects.set(objectPath(institutionId, text), new TextEncoder().encode(bytes));
        },
        snapshot: () => snapshotOf(s3),
        otherBytesUnderStoredHash: "invalid",
      };
    },
  ],
];

// Pairs that differ in bytes but could pass for one text: one byte, a space,
// and the same letter composed (NFC) and decomposed (NFD).
const NEAR_TWINS: [string, string, string][] = [
  ["one byte", "izmisljeni odlomak A", "izmisljeni odlomak B"],
  ["one space", "izmisljeni odlomak", "izmisljeni  odlomak"],
  ["NFC and NFD", "čaša".normalize("NFC"), "čaša".normalize("NFD")],
];

describe.each(subjects)("EvidencePayloadStore contract: %s", (_, make) => {
  it("stores the first write and reads back the same bytes", async () => {
    const store = make();
    const first = await store.putImmutable(putOf(FAK_A, "prvi odlomak"));
    expect(first).toEqual({ status: "stored", storageRef: expect.stringContaining(`v2/${FAK_A}/${PACKAGE}/`) });
    const read = await store.readImmutable(keyOf(FAK_A, "prvi odlomak"));
    expect(read.status).toBe("found");
    expect(decode((read as { bytes: Uint8Array }).bytes)).toBe(payload("prvi odlomak"));
  });

  it("answers a repeat of the same bytes as existing, with the same storageRef", async () => {
    const store = make();
    const first = await store.putImmutable(putOf(FAK_A, "prvi odlomak"));
    const again = await store.putImmutable(putOf(FAK_A, "prvi odlomak"));
    expect(again).toEqual({ status: "existing", storageRef: (first as { storageRef: string }).storageRef });
  });

  it.each(NEAR_TWINS)("answers %s of other bytes already under the key as a conflict", async (_, text, other) => {
    expect(payload(text)).not.toBe(payload(other));
    const store = make();
    await store.plant(FAK_A, text, payload(other));
    await expect(store.putImmutable(putOf(FAK_A, text))).resolves.toEqual({ status: "conflict" });
  });

  it.each(NEAR_TWINS)("never stores %s of other bytes under a hash already stored", async (_, text, other) => {
    const store = make();
    await store.putImmutable(putOf(FAK_A, text));
    const outcome = await store.putImmutable(putOf(FAK_A, text, payload(other)));
    expect(outcome).toEqual({ status: store.otherBytesUnderStoredHash });
    const read = await store.readImmutable(keyOf(FAK_A, text));
    expect(decode((read as { bytes: Uint8Array }).bytes)).toBe(payload(text));
  });

  it("reads a key that was never written as not_found", async () => {
    await expect(make().readImmutable(keyOf(FAK_A, "nikad upisan"))).resolves.toEqual({ status: "not_found" });
  });

  it.each([
    ["an institution id that is not a lowercase UUID", { institutionId: FAK_A.toUpperCase() }],
    ["an empty package id", { evidencePackageId: "" }],
    ["a hash that is not SHA-256 hex", { segmentHash: "abc" }],
  ])("refuses %s as invalid and stores nothing", async (_, change) => {
    const store = make();
    await store.putImmutable(putOf(FAK_A, "prvi odlomak"));
    const before = store.snapshot();
    await expect(store.putImmutable({ ...putOf(FAK_A, "odlomak"), ...change })).resolves.toEqual({ status: "invalid" });
    expect(store.snapshot()).toEqual(before);
  });

  it("does not show one institution's write to another", async () => {
    const store = make();
    expect((await store.putImmutable(putOf(FAK_A, "odlomak ustanove A"))).status).toBe("stored");
    await expect(store.readImmutable(keyOf(FAK_B, "odlomak ustanove A"))).resolves.toEqual({ status: "not_found" });
    const other = await store.putImmutable(putOf(FAK_B, "odlomak ustanove A"));
    expect(other.status).not.toBe("existing");
    expect(other.status).not.toBe("conflict");
  });
});
