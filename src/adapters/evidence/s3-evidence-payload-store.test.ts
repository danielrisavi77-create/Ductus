import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";

import {
  S3EvidencePayloadStore,
  type S3EvidencePayloadStoreConfig,
} from "./s3-evidence-payload-store";

const PACKAGE = "paket-izmisljeni-1";
const payload = (text: string) => JSON.stringify({ text });
const hashOf = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const keyOf = (pkg: string, hash: string) =>
  `/ductus-evidence/v2/${pkg}/${hash}.json`;

type Call = { method: string; path: string; headers: Headers };

/**
 * In-process S3 stand-in: conditional create is atomic, the signed payload
 * hash and the SHA-256 checksum are checked against the bytes received.
 * `hook` may answer a call itself before the store sees it.
 */
function fakeS3(
  hook?: (call: Call, signal: AbortSignal) => Promise<Response> | null,
) {
  const objects = new Map<string, Uint8Array>();
  const calls: Call[] = [];
  const fetch = vi.fn(
    async (url: URL | string | Request, init?: RequestInit) => {
      const call = {
        method: init?.method ?? "GET",
        path: new URL(String(url)).pathname,
        headers: new Headers(init?.headers),
      };
      calls.push(call);
      const own = hook?.(call, init!.signal!);
      if (own) return own;
      const body = init?.body ? (init.body as Uint8Array) : new Uint8Array();
      if (!call.headers.get("authorization")?.startsWith("AWS4-HMAC-SHA256 ")) {
        return new Response(null, { status: 403 });
      }
      if (call.method === "GET") {
        const found = objects.get(call.path);
        return found
          ? new Response(found.slice(), { status: 200 })
          : new Response(null, { status: 404 });
      }
      const checksum = createHash("sha256").update(body).digest("base64");
      if (
        call.headers.get("x-amz-content-sha256") !== hashOf(body) ||
        call.headers.get("x-amz-checksum-sha256") !== checksum
      ) {
        return new Response(null, { status: 400 });
      }
      if (call.headers.get("if-none-match") !== "*") {
        return new Response(null, { status: 501 });
      }
      if (objects.has(call.path)) return new Response(null, { status: 412 });
      objects.set(call.path, body.slice());
      return new Response(null, { status: 200 });
    },
  );
  return { objects, calls, fetch };
}

function storeWith(
  fetch: typeof globalThis.fetch,
  overrides: Partial<S3EvidencePayloadStoreConfig> = {},
) {
  const warn = vi.fn();
  const store = new S3EvidencePayloadStore({
    endpoint: "http://127.0.0.1:9100",
    region: "eu-central-1",
    bucket: "ductus-evidence",
    credentials: { accessKeyId: "fake-id", secretAccessKey: "fake-secret" },
    requestTimeoutMs: 1_000,
    fetch,
    warn,
    ...overrides,
  });
  return { store, warn };
}

const put = (store: S3EvidencePayloadStore, text: string, pkg = PACKAGE) =>
  store.putImmutable({
    evidencePackageId: pkg,
    segmentHash: hashOf(payload(text)),
    canonicalPayload: payload(text),
  });

/** Never answers; rejects only when the request is aborted. */
const hang = (signal: AbortSignal) =>
  new Promise<Response>((_, reject) =>
    signal.addEventListener("abort", () => reject(signal.reason)),
  );

describe("S3EvidencePayloadStore", () => {
  it("stores once under v2/<package>/<hash>.json, then answers existing", async () => {
    const s3 = fakeS3();
    const { store } = storeWith(s3.fetch);
    const hash = hashOf(payload("a"));
    const ref = `s3://ductus-evidence/v2/${PACKAGE}/${hash}.json`;

    await expect(put(store, "a")).resolves.toEqual({
      status: "stored",
      storageRef: ref,
    });
    await expect(put(store, "a")).resolves.toEqual({
      status: "existing",
      storageRef: ref,
    });
    expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "PUT", "GET"]);
    expect(s3.calls[0].path).toBe(keyOf(PACKAGE, hash));
    expect(s3.objects.size).toBe(1);
  });

  it("answers conflict for other bytes at the key, keeps them and logs ids only", async () => {
    const s3 = fakeS3();
    const { store, warn } = storeWith(s3.fetch);
    const hash = hashOf(payload("a"));
    const tampered = new TextEncoder().encode(payload("b"));
    s3.objects.set(keyOf(PACKAGE, hash), tampered);

    await expect(put(store, "a")).resolves.toEqual({ status: "conflict" });
    expect(s3.objects.get(keyOf(PACKAGE, hash))).toEqual(tampered);
    expect(warn).toHaveBeenCalledWith("evidence payload conflict", {
      evidencePackageId: PACKAGE,
      segmentHash: hash,
    });
  });

  it("decides concurrent writes of the same key by the condition", async () => {
    const s3 = fakeS3();
    const { store } = storeWith(s3.fetch);
    const results = await Promise.all([put(store, "a"), put(store, "a")]);

    expect(results.map((r) => r.status).sort()).toEqual(["existing", "stored"]);
    expect(s3.objects.size).toBe(1);
  });

  it("treats a concurrent-write answer (409) like 412 and compares bytes", async () => {
    const s3 = fakeS3();
    const { store } = storeWith(s3.fetch);
    await put(store, "a");
    s3.fetch.mockImplementationOnce(
      async () => new Response(null, { status: 409 }),
    );

    await expect(put(store, "a")).resolves.toMatchObject({
      status: "existing",
    });
  });

  it.each([
    ["GET not found", () => new Response(null, { status: 404 })],
    ["GET server error", () => new Response(null, { status: 500 })],
    [
      "GET network failure",
      () => Promise.reject(new TypeError("fetch failed")),
    ],
    [
      "GET over the size limit",
      () => new Response(new Uint8Array(MAX_EVIDENCE_SEGMENT_BYTES + 1)),
    ],
  ])("never answers existing after 412 on %s", async (_, answer) => {
    const s3 = fakeS3((call) =>
      call.method === "PUT"
        ? Promise.resolve(new Response(null, { status: 412 }))
        : Promise.resolve().then(answer),
    );
    const { store } = storeWith(s3.fetch);

    await expect(put(store, "a")).resolves.toMatchObject({
      status: "unavailable",
    });
  });

  it("aborts a request that never answers and does not retry it", async () => {
    let signal: AbortSignal | undefined;
    const s3 = fakeS3((_, s) => ((signal = s), hang(s)));
    const { store } = storeWith(s3.fetch, { requestTimeoutMs: 20 });

    await expect(put(store, "a")).resolves.toEqual({
      status: "unavailable",
      reason: "storage_timeout",
    });
    expect(signal?.aborted).toBe(true);
    expect(s3.calls).toHaveLength(1);
  });

  it("aborts a GET whose body never ends", async () => {
    const s3 = fakeS3((call) =>
      call.method === "PUT"
        ? Promise.resolve(new Response(null, { status: 412 }))
        : Promise.resolve(
            new Response(
              new ReadableStream({ pull: () => new Promise(() => {}) }),
            ),
          ),
    );
    const { store } = storeWith(s3.fetch, { requestTimeoutMs: 20 });

    await expect(put(store, "a")).resolves.toEqual({
      status: "unavailable",
      reason: "storage_timeout",
    });
  });

  it("lets the client retry after a timeout, written or not", async () => {
    let mode: "write-then-hang" | "hang" | "normal" = "write-then-hang";
    const s3 = fakeS3((call, signal) => {
      if (mode === "normal") return null;
      if (mode === "write-then-hang") {
        s3.objects.set(call.path, new TextEncoder().encode(payload("a")));
      }
      return hang(signal);
    });
    const { store } = storeWith(s3.fetch, { requestTimeoutMs: 20 });

    await expect(put(store, "a")).resolves.toMatchObject({
      status: "unavailable",
    });
    mode = "normal";
    await expect(put(store, "a")).resolves.toMatchObject({
      status: "existing",
    });

    mode = "hang";
    await expect(put(store, "b")).resolves.toMatchObject({
      status: "unavailable",
    });
    mode = "normal";
    await expect(put(store, "b")).resolves.toMatchObject({ status: "stored" });
    expect(s3.objects.size).toBe(2);
  });

  it("answers unavailable, once, when storage refuses or fails", async () => {
    for (const status of [400, 403, 500, 503]) {
      const s3 = fakeS3(() => Promise.resolve(new Response(null, { status })));
      const { store } = storeWith(s3.fetch);
      await expect(put(store, "a")).resolves.toEqual({
        status: "unavailable",
        reason: `storage_put_status_${status}`,
      });
      expect(s3.calls).toHaveLength(1);
    }
  });

  it("sends a checksum storage can hold the received bytes to", async () => {
    const s3 = fakeS3((call) => {
      // A corrupted transfer: the fake checks the checksum against other bytes.
      if (call.method === "PUT")
        call.headers.set("x-amz-checksum-sha256", "AAAA");
      return null;
    });
    const { store } = storeWith(s3.fetch);
    await expect(put(store, "a")).resolves.toMatchObject({
      status: "unavailable",
    });
    expect(s3.objects.size).toBe(0);
    const sent = s3.fetch.mock.calls[0][1]!;
    const body = sent.body as Uint8Array;

    expect(new Headers(sent.headers).get("x-amz-checksum-sha256")).toBe(
      createHash("sha256").update(body).digest("base64"),
    );
    expect(new Headers(sent.headers).get("if-none-match")).toBe("*");
  });

  it.each([
    "",
    "Paket-1",
    "pakEt",
    "-paket",
    "_paket",
    ".",
    "..",
    "a/b",
    "a%2Fb",
    "a\\b",
    "a.b",
    "paket\n",
    "pa ket",
    "pa\u0000ket",
    "paket́",
    "ｐaket",
    "pаket",
    "paket٣",
    "a".repeat(129),
  ])("refuses package id %j before any request", async (pkg) => {
    const s3 = fakeS3();
    const { store } = storeWith(s3.fetch);

    await expect(put(store, "a", pkg)).resolves.toEqual({ status: "invalid" });
    expect(s3.calls).toHaveLength(0);
  });

  it("accepts ids of length 1 and 128 and keeps the whole key short", async () => {
    const s3 = fakeS3();
    const { store } = storeWith(s3.fetch);
    for (const pkg of ["a", "a".repeat(128)]) {
      await expect(put(store, "a", pkg)).resolves.toMatchObject({
        status: "stored",
      });
    }
    // S3 keys are at most 1024 bytes.
    expect(Math.max(...s3.calls.map((c) => c.path.length))).toBeLessThan(1024);
  });

  it("refuses a hash in another form or of other bytes before any request", async () => {
    const s3 = fakeS3();
    const { store } = storeWith(s3.fetch);
    const text = payload("a");
    for (const segmentHash of [
      hashOf(text).toUpperCase(),
      hashOf(payload("b")),
      "ab",
    ]) {
      await expect(
        store.putImmutable({
          evidencePackageId: PACKAGE,
          segmentHash,
          canonicalPayload: text,
        }),
      ).resolves.toEqual({ status: "invalid" });
    }
    const big = "x".repeat(MAX_EVIDENCE_SEGMENT_BYTES + 1);
    await expect(
      store.putImmutable({
        evidencePackageId: PACKAGE,
        segmentHash: hashOf(big),
        canonicalPayload: big,
      }),
    ).resolves.toEqual({ status: "invalid" });
    expect(s3.calls).toHaveLength(0);
  });

  it.each<[string, unknown]>([
    ["missing", undefined],
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["text", "1000"],
    ["not a number", Number.NaN],
    ["over the limit", 60_001],
  ])("refuses to start with a %s timeout", (_, requestTimeoutMs) => {
    expect(() =>
      storeWith(fakeS3().fetch, {
        requestTimeoutMs: requestTimeoutMs as number,
      }),
    ).toThrow(TypeError);
  });

  it("refuses to start on plain http beyond loopback or with an endpoint path", () => {
    for (const endpoint of [
      "http://s3.example.eu",
      "https://s3.example.eu/bucket",
      "ftp://127.0.0.1",
    ]) {
      expect(() => storeWith(fakeS3().fetch, { endpoint })).toThrow(TypeError);
    }
    expect(() =>
      storeWith(fakeS3().fetch, { endpoint: "https://s3.example.eu" }),
    ).not.toThrow();
  });

  it("has no multipart, delete or listing path", () => {
    const source = readFileSync(
      new URL("./s3-evidence-payload-store.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/uploadId|uploads|"DELETE"|"POST"|list-type/);
    expect(source.match(/"(GET|PUT)"/g)).not.toBeNull();
  });
});
