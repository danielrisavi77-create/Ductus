import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadEvidenceStorageConfig } from "@/adapters/evidence/evidence-storage-config";
import { InstitutionRoutedPayloadStore } from "@/adapters/evidence/institution-routed-payload-store";
import { STORAGE_IDENTITY_KEY } from "@/adapters/evidence/s3-evidence-payload-store";
import { sha256Hex, signS3Request, sigV4Authorization } from "@/adapters/evidence/s3-signature";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// B-8 step 4b / DAN-83 (docs/BACKEND.md 4.1 and 4.13): the db/local script
// gives an institution its storage domain in the local store of compose.yaml,
// and the configuration it prints is the one the web process loads. Loopback
// only; random synthetic institutions and buckets, all removed afterwards.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? "http://127.0.0.1:9100";
requireLoopbackDatabaseUrl(SAFE_ADMIN_URL, "The storage domain test runs only against loopback services.");
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(S3_ENDPOINT).hostname)) {
  throw new Error("The storage domain test runs only against loopback services.");
}
const credentials = {
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "ductus-local",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "ductus-local-only",
};
const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("../../db/local/evidence-storage-domain.mjs", import.meta.url));
const suffix = randomBytes(5).toString("hex");
const [own, other, regional] = ["own", "other", "regional"].map((name) => ({ id: randomUUID(), slug: `it-${name}-${suffix}` }));
const bucketOf = (slug: string) => `ductus-evidence-${slug}`;
const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 1 });
const written: string[][] = [];

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "test",
    S3_ENDPOINT,
    EVIDENCE_S3_LOCAL_KEY_ID: credentials.accessKeyId,
    EVIDENCE_S3_LOCAL_SECRET: credentials.secretAccessKey,
    ...extra,
  } as NodeJS.ProcessEnv;
}

/** The script's stdout, or its stderr when it refuses. */
async function provision(slug: string, extra: Record<string, string> = {}, args = ["--institution", slug]) {
  return run(process.execPath, [SCRIPT, ...args], { env: env(extra) }).then(
    ({ stdout }) => ({ ok: true as const, out: stdout.trim() }),
    (error: { stderr: string }) => ({ ok: false as const, out: error.stderr }),
  );
}

async function s3(method: "GET" | "PUT", path: string[], body = new Uint8Array()) {
  const signed = signS3Request({ method, endpoint: new URL(S3_ENDPOINT), path, headers: {}, body, region: "us-east-1", credentials, now: new Date() });
  const response = await fetch(signed.url, { method, headers: signed.headers, body: method === "PUT" ? body : undefined });
  return { status: response.status, text: await response.text() };
}

// Test cleanup only: the application never deletes (its signer has no DELETE).
async function s3Delete(path: string[]) {
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const url = new URL(`/${path.join("/")}`, S3_ENDPOINT);
  const headers = { host: url.host, "x-amz-content-sha256": sha256Hex(""), "x-amz-date": amzDate };
  const authorization = sigV4Authorization({
    method: "DELETE", canonicalPath: url.pathname, headers, payloadSha256Hex: sha256Hex(""),
    region: "us-east-1", service: "s3", credentials, amzDate,
  });
  await fetch(url, { method: "DELETE", headers: { ...headers, authorization } }).then((r) => r.arrayBuffer());
}

beforeAll(async () => {
  for (const p of [own, other, regional]) {
    await admin.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [p.id, p.slug]);
  }
});

afterAll(async () => {
  for (const path of written.reverse()) await s3Delete(path);
  for (const p of [own, other, regional]) {
    await s3Delete([bucketOf(p.slug), STORAGE_IDENTITY_KEY]);
    await s3Delete([bucketOf(p.slug)]);
    await admin.query("DELETE FROM identity.institution WHERE id = $1", [p.id]);
  }
  await admin.end();
});

describe("local evidence storage domain", () => {
  it("makes the bucket once and prints a configuration the web process stores and reads with", async () => {
    const first = await provision(own.slug);
    expect(first.ok).toBe(true);
    expect(await provision(own.slug)).toEqual(first);
    // Variable names only, never a credential value.
    expect(first.out).not.toContain(credentials.secretAccessKey);
    expect(first.out).not.toContain(`"${credentials.accessKeyId}"`);
    const [name, value] = [first.out.slice(0, first.out.indexOf("=")), first.out.slice(first.out.indexOf("=") + 1)];
    expect(name).toBe("EVIDENCE_STORAGE_DOMAINS");
    expect(JSON.parse(value).domains).toMatchObject([
      { label: `local-${own.slug}`, institutionId: own.id, bucket: bucketOf(own.slug) },
    ]);
    const label = await s3("GET", [bucketOf(own.slug), STORAGE_IDENTITY_KEY]);
    expect(JSON.parse(label.text)).toEqual({ institutionId: own.id, region: "us-east-1" });

    const config = loadEvidenceStorageConfig({
      EVIDENCE_STORAGE_DOMAINS: value,
      EVIDENCE_S3_LOCAL_KEY_ID: credentials.accessKeyId,
      EVIDENCE_S3_LOCAL_SECRET: credentials.secretAccessKey,
    });
    const store = InstitutionRoutedPayloadStore.fromConfig(config, { allowPlainHttpOnLoopback: true, warn: () => undefined });
    const canonicalPayload = JSON.stringify({ text: "izmisljeni odlomak", nonce: suffix });
    const input = { institutionId: own.id, evidencePackageId: `paket-${suffix}`, segmentHash: sha256Hex(canonicalPayload), canonicalPayload };
    const stored = await store.putImmutable(input);
    expect(stored).toEqual({
      status: "stored",
      storageRef: `local-${own.slug}:v2/${own.id}/${input.evidencePackageId}/${input.segmentHash}.json`,
    });
    written.push([bucketOf(own.slug), "v2", own.id, input.evidencePackageId, `${input.segmentHash}.json`]);
    const read = await store.readImmutable({ institutionId: own.id, evidencePackageId: input.evidencePackageId, segmentHash: input.segmentHash });
    expect(read.status).toBe("found");
    // No domain for another institution (P2).
    const elsewhere = await store.readImmutable({ ...input, institutionId: other.id });
    expect(elsewhere.status).toBe("unavailable");
  });

  it("never replaces the label of a bucket made for another institution (P3)", async () => {
    const bucket = bucketOf(other.slug);
    expect([200, 409]).toContain((await s3("PUT", [bucket])).status);
    const foreign = JSON.stringify({ institutionId: own.id, region: "us-east-1" });
    expect((await s3("PUT", [bucket, STORAGE_IDENTITY_KEY], new TextEncoder().encode(foreign))).status).toBe(200);

    const refused = await provision(other.slug);
    expect(refused).toEqual({ ok: false, out: expect.stringContaining("labelled for another institution") });
    expect((await s3("GET", [bucket, STORAGE_IDENTITY_KEY])).text).toBe(foreign);
  });

  it("never accepts a label of this institution for another region", async () => {
    const bucket = bucketOf(regional.slug);
    expect([200, 409]).toContain((await s3("PUT", [bucket])).status);
    const elsewhere = JSON.stringify({ institutionId: regional.id, region: "eu-central-1" });
    expect((await s3("PUT", [bucket, STORAGE_IDENTITY_KEY], new TextEncoder().encode(elsewhere))).status).toBe(200);

    expect(await provision(regional.slug)).toEqual({ ok: false, out: expect.stringContaining("another institution or region") });
    expect((await s3("GET", [bucket, STORAGE_IDENTITY_KEY])).text).toBe(elsewhere);
  });

  it.each([
    ["--institution=<slug>", [`--institution=${own.slug}`]],
    ["an unknown argument", ["--institution", own.slug, "--force"]],
    ["--institution without a slug", ["--institution"]],
  ])("refuses %s instead of reading another institution", async (_, args) => {
    expect(await provision(own.slug, {}, args)).toEqual({ ok: false, out: expect.stringContaining("--institution") });
  });

  it.each([
    ["production", { NODE_ENV: "production" }, "refused in production"],
    ["a store outside loopback", { S3_ENDPOINT: "http://192.0.2.10:9100" }, "must be the local store on loopback"],
    ["no credentials", { EVIDENCE_S3_LOCAL_SECRET: "" }, "must be set"],
  ])("refuses %s before any request", async (_, extra, message) => {
    expect(await provision(`it-none-${suffix}`, extra)).toEqual({ ok: false, out: expect.stringContaining(message) });
  });

  it("refuses an institution that does not exist and makes no bucket for it", async () => {
    const slug = `it-none-${suffix}`;
    expect(await provision(slug)).toEqual({ ok: false, out: expect.stringContaining("no institution") });
    expect((await s3("GET", [bucketOf(slug), STORAGE_IDENTITY_KEY])).status).toBe(404);
  });
});
