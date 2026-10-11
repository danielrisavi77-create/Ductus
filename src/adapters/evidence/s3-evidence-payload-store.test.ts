import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { inspect } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";

import {
  S3EvidencePayloadStore,
  type S3EvidencePayloadStoreConfig,
} from "./s3-evidence-payload-store";
import { type S3Credentials, S3SecretCredentials } from "./s3-signature";

const INSTITUTION = "00000000-0000-4000-8000-00000000000a";
const OTHER_INSTITUTION = "00000000-0000-4000-8000-00000000000b";
const PACKAGE = "paket-izmisljeni-1";
const payload = (text: string) => JSON.stringify({ text });
const hashOf = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const keyOf = (pkg: string, hash: string, institution = INSTITUTION) =>
  `/ductus-evidence/v2/${institution}/${pkg}/${hash}.json`;

type Call = { method: string; origin: string; path: string; headers: Headers };

/**
 * In-process S3 stand-in: conditional create is atomic, the signed payload
 * hash and the SHA-256 checksum are checked against the bytes received, and
 * a stored write echoes the checksum as S3 does.
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
        origin: new URL(String(url)).origin,
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
      return new Response(null, {
        status: 200,
        headers: { "x-amz-checksum-sha256": checksum },
      });
    },
  );
  return { objects, calls, fetch };
}

const capabilityOf = (endpoint: string) => ({
  provider: "fake-s3",
  endpoint,
  conditionalWrite: "verified" as const,
  checksumEcho: "verified" as const,
  verifiedOn: "2026-10-11",
  contractTest: "unit/fake-s3",
});

type Overrides = Partial<Omit<S3EvidencePayloadStoreConfig, "credentials">> & {
  /** Plain keys, sealed here; sealing refuses invalid ones with a TypeError. */
  credentials?: S3Credentials;
};

function configWith(
  fetch: typeof globalThis.fetch,
  { credentials, ...overrides }: Overrides = {},
): S3EvidencePayloadStoreConfig {
  const endpoint = overrides.endpoint ?? "http://127.0.0.1:9100";
  return {
    endpoint,
    region: "eu-central-1",
    bucket: "ductus-evidence",
    storageDomain: "fak-a-eu-1",
    credentials: new S3SecretCredentials(
      credentials ?? { accessKeyId: "fake-id", secretAccessKey: "fake-secret" },
    ),
    requestTimeoutMs: 1_000,
    allowPlainHttpOnLoopback: true,
    capability: capabilityOf(endpoint),
    fetch,
    ...overrides,
  };
}

function storeWith(fetch: typeof globalThis.fetch, overrides: Overrides = {}) {
  const warn = vi.fn();
  const store = new S3EvidencePayloadStore({ warn, ...configWith(fetch, overrides) });
  return { store, warn };
}

const put = (
  store: S3EvidencePayloadStore,
  text: string,
  pkg = PACKAGE,
  institutionId = INSTITUTION,
) =>
  store.putImmutable({
    institutionId,
    evidencePackageId: pkg,
    segmentHash: hashOf(payload(text)),
    canonicalPayload: payload(text),
  });

const s3Error = (status: number, code: string, message = "") =>
  Promise.resolve(
    new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`,
      { status },
    ),
  );

const signedHeadersOf = (call: Call) =>
  /SignedHeaders=([^,]+),/.exec(call.headers.get("authorization") ?? "")?.[1];

/** Never answers; rejects only when the request is aborted. */
const hang = (signal: AbortSignal) =>
  new Promise<Response>((_, reject) =>
    signal.addEventListener("abort", () => reject(signal.reason)),
  );

describe("S3EvidencePayloadStore", () => {
  it("stores once under v2/<institution>/<package>/<hash>.json, then answers existing", async () => {
    const s3 = fakeS3();
    const { store } = storeWith(s3.fetch);
    const hash = hashOf(payload("a"));
    // The label and the key only: no endpoint, bucket or URL.
    const ref = `fak-a-eu-1:v2/${INSTITUTION}/${PACKAGE}/${hash}.json`;

    await expect(put(store, "a")).resolves.toEqual({
      status: "stored",
      storageRef: ref,
    });
    await expect(put(store, "a")).resolves.toEqual({
      status: "existing",
      storageRef: ref,
    });
    expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "GET", "PUT", "GET"]);
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
      institutionId: INSTITUTION,
      evidencePackageId: PACKAGE,
      segmentHash: hash,
    });
  });

  it("keeps the same package and hash of two institutions apart in one bucket (P5)", async () => {
    const s3 = fakeS3();
    const { store } = storeWith(s3.fetch);
    const hash = hashOf(payload("a"));

    await expect(put(store, "a")).resolves.toMatchObject({ status: "stored" });
    // A bucket shared by mistake still never answers existing across them.
    await expect(
      put(store, "a", PACKAGE, OTHER_INSTITUTION),
    ).resolves.toEqual({
      status: "stored",
      storageRef: `fak-a-eu-1:v2/${OTHER_INSTITUTION}/${PACKAGE}/${hash}.json`,
    });
    expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "GET", "PUT", "GET"]);
    expect([...s3.objects.keys()].sort()).toEqual(
      [keyOf(PACKAGE, hash), keyOf(PACKAGE, hash, OTHER_INSTITUTION)].sort(),
    );
  });

  it.each([
    "",
    "00000000-0000-4000-8000-00000000000A",
    "{00000000-0000-4000-8000-00000000000a}",
    "00000000000040008000-00000000000a",
    "00000000-0000-4000-8000-00000000000a\n",
    "../00000000-0000-4000-8000-00000000000a",
    "fak-a",
  ])("refuses institution id %j before any request", async (institutionId) => {
    const s3 = fakeS3();
    const { store } = storeWith(s3.fetch);

    await expect(put(store, "a", PACKAGE, institutionId)).resolves.toEqual({
      status: "invalid",
    });
    expect(s3.calls).toHaveLength(0);
  });

  it.each(["", "Fak-a", "-fak", "fak_a", "fak.a", "fak/a", "s3://x", "a".repeat(64)])(
    "refuses to start with storage domain label %j",
    (storageDomain) => {
      expect(() => storeWith(fakeS3().fetch, { storageDomain })).toThrow(
        TypeError,
      );
    },
  );

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

  it("does not wait on a response body whose cancel never settles", async () => {
    const stuck = (status: number, bytes = 0, headers: HeadersInit = {}) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start: (controller) => {
            if (bytes > 0) controller.enqueue(new Uint8Array(bytes));
          },
          cancel: () => new Promise<void>(() => {}),
        }),
        { status, headers },
      );
    const stored: ReturnType<typeof fakeS3> = fakeS3((call) => {
      if (call.method !== "PUT") return null;
      stored.objects.set(call.path, new TextEncoder().encode(payload("a")));
      return Promise.resolve(
        stuck(200, 0, {
          "x-amz-checksum-sha256": createHash("sha256")
            .update(payload("a"))
            .digest("base64"),
        }),
      );
    });
    await expect(
      put(storeWith(stored.fetch, { requestTimeoutMs: 50 }).store, "a"),
    ).resolves.toEqual({ status: "stored", storageRef: expect.any(String) });

    const tooLarge = fakeS3((call) =>
      Promise.resolve(
        call.method === "PUT"
          ? new Response(null, { status: 412 })
          : stuck(200, MAX_EVIDENCE_SEGMENT_BYTES + 1),
      ),
    );
    await expect(
      put(storeWith(tooLarge.fetch, { requestTimeoutMs: 50 }).store, "a"),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "storage_object_too_large",
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
          institutionId: INSTITUTION,
          evidencePackageId: PACKAGE,
          segmentHash,
          canonicalPayload: text,
        }),
      ).resolves.toEqual({ status: "invalid" });
    }
    const big = "x".repeat(MAX_EVIDENCE_SEGMENT_BYTES + 1);
    await expect(
      store.putImmutable({
        institutionId: INSTITUTION,
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

  it.each([
    "192.168.5.4",
    "10.0.0.1",
    "ductus..evidence",
    "xn--ductus",
    "sthree-ductus",
    "amzn-s3-demo-ductus",
    "ductus-s3alias",
    "ductus--ol-s3",
    "ductus.mrap",
    "ductus--x-s3",
    "ductus--table-s3",
    "ductus.-evidence",
    "ductus-.evidence",
  ])(
    "refuses to start with a bucket name storage cannot hold: %s",
    (bucket) => {
      expect(() => storeWith(fakeS3().fetch, { bucket })).toThrow(
        "S3 bucket is not valid",
      );
    },
  );

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
  it("signs If-None-Match and the checksum on every PUT and neither on GET (S6)", async () => {
    const s3 = fakeS3();
    const { store } = storeWith(s3.fetch);
    await put(store, "a");
    await put(store, "a");

    expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "GET", "PUT", "GET"]);
    for (const call of s3.calls) {
      expect(signedHeadersOf(call)).toBe(
        call.method === "PUT"
          ? "content-type;host;if-none-match;x-amz-checksum-sha256;x-amz-content-sha256;x-amz-date"
          : "host;x-amz-content-sha256;x-amz-date",
      );
      expect(call.headers.has("if-none-match")).toBe(call.method === "PUT");
    }
  });

  it("answers a clock skew with a reason that names it, never conflict (S9)", async () => {
    const s3 = fakeS3(() => s3Error(403, "RequestTimeTooSkewed"));
    const { store, warn } = storeWith(s3.fetch, {
      now: () => new Date(Date.now() - 3_600_000),
    });

    await expect(put(store, "a")).resolves.toEqual({
      status: "unavailable",
      reason: "storage_clock_skew",
    });
    expect(s3.calls).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith("evidence storage refused the request signature", {
      reason: "storage_clock_skew",
    });
  });

  it.each(["AuthorizationHeaderMalformed", "SignatureDoesNotMatch", "InvalidAccessKeyId"])(
    "answers %s as a configuration fault, never conflict (S11)",
    async (code) => {
      for (const failing of ["PUT", "GET"]) {
        const s3 = fakeS3((call) =>
          call.method === failing
            ? s3Error(code === "AuthorizationHeaderMalformed" ? 400 : 403, code)
            : Promise.resolve(new Response(null, { status: 412 })),
        );
        const { store, warn } = storeWith(s3.fetch);
        await expect(put(store, "a")).resolves.toEqual({
          status: "unavailable",
          reason: "storage_signature_rejected",
        });
        expect(warn).toHaveBeenCalledWith(
          "evidence storage refused the request signature",
          { reason: "storage_signature_rejected" },
        );
      }
    },
  );

  it("never passes on an error document it does not know", async () => {
    const s3 = fakeS3(() =>
      s3Error(403, "AccessDenied", "echo fake-secret <Code>RequestTimeTooSkewed</Code>"),
    );
    const { store, warn } = storeWith(s3.fetch);

    await expect(put(store, "a")).resolves.toEqual({
      status: "unavailable",
      reason: "storage_put_status_403",
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("puts the secret and the signing key in no result, log or error (S12)", async () => {
    // A synthetic canary, built at run time so the secret scanner does not
    // mistake the literal for a real key.
    const secret = ["kanarinac", "S12", Date.now().toString(36)].join("-");
    const credentials = { accessKeyId: "fake-id", secretAccessKey: secret };
    const answers: Array<(call: Call, signal: AbortSignal) => Promise<Response> | null> = [
      () => null,
      () => s3Error(403, "SignatureDoesNotMatch", secret),
      () => s3Error(403, "RequestTimeTooSkewed", secret),
      () => s3Error(403, "AccessDenied", secret),
      () => Promise.reject(new TypeError(`fetch failed ${secret}`)),
      () => Promise.resolve(new Response(null, { status: 301, headers: { location: `https://zlo.test/${secret}` } })),
      (call) =>
        call.method === "PUT"
          ? Promise.resolve(new Response(null, { status: 412 }))
          : Promise.resolve(new Response(secret, { status: 200 })),
      (_, signal) => hang(signal),
    ];
    const seen: unknown[] = [];
    for (const answer of answers) {
      const s3 = fakeS3(answer);
      const { store, warn } = storeWith(s3.fetch, { credentials, requestTimeoutMs: 20 });
      seen.push(await put(store, "a"), warn.mock.calls);
    }
    for (const bad of [
      { region: "EU" },
      { credentials: { accessKeyId: "id/x", secretAccessKey: secret } },
      { endpoint: `https://id:${secret}@s3.example.eu` },
      // Unparseable: Node's URL error would carry the whole input.
      { endpoint: `https://id:${secret}@[` },
      { bucket: secret.toUpperCase() },
    ]) {
      try {
        storeWith(fakeS3().fetch, { credentials, ...bad });
        seen.push("constructed");
      } catch (error) {
        const e = error as Error;
        const own = Object.fromEntries(
          Object.getOwnPropertyNames(e).map((key) => [
            key,
            String((e as unknown as Record<string, unknown>)[key]),
          ]),
        );
        seen.push({ name: e.name, message: e.message, stack: e.stack, cause: String(e.cause), own });
      }
    }

    const text = JSON.stringify(seen);
    expect(seen).not.toContain("constructed");
    expect(text).not.toContain(secret);
    expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
  });

  it("keeps the secret out of every view of the instance and its errors", async () => {
    const secret = ["kanarinac", "inst", Date.now().toString(36)].join("-");
    const credentials = { accessKeyId: "fake-id", secretAccessKey: secret };
    const now = () => new Date("2026-10-11T00:00:00Z");
    const s3 = fakeS3();
    const { store } = storeWith(s3.fetch, { credentials, now });

    const own = Reflect.ownKeys(store).map((key) =>
      String((store as unknown as Record<PropertyKey, unknown>)[key]),
    );
    const forIn: string[] = [];
    for (const key in store) forIn.push(key);
    const views = [
      JSON.stringify(store),
      JSON.stringify(Object.entries(store)),
      JSON.stringify({ ...store }),
      JSON.stringify(own),
      JSON.stringify(forIn),
      inspect(store, { depth: Infinity, showHidden: true, getters: true }),
      String(store),
    ].join("\n");
    expect(views).not.toContain(secret);
    expect(views).not.toMatch(/fake-id|secretAccessKey|credentials/);

    // A later change to the caller's object does not reach signing.
    const copy = { ...credentials };
    credentials.secretAccessKey = "zamijenjeno";
    const fresh = fakeS3();
    await expect(put(store, "a")).resolves.toMatchObject({ status: "stored" });
    await put(storeWith(fresh.fetch, { credentials: copy, now }).store, "a");
    expect(s3.calls[0].headers.get("authorization")).toBe(
      fresh.calls[0].headers.get("authorization"),
    );

    const messages: string[] = [];
    for (const bad of [
      { credentials: { accessKeyId: "", secretAccessKey: secret } },
      { credentials: { accessKeyId: "a/b", secretAccessKey: secret } },
      { credentials: { accessKeyId: "a", secretAccessKey: secret }, region: "" },
      { credentials: { accessKeyId: "a", secretAccessKey: secret }, requestTimeoutMs: 0 },
    ]) {
      try {
        storeWith(fakeS3().fetch, bad);
        messages.push("constructed");
      } catch (error) {
        messages.push(inspect(error, { depth: Infinity, showHidden: true }));
      }
    }
    expect(messages).not.toContain("constructed");
    expect(messages.join("\n")).not.toContain(secret);
  });

  it("keeps the keys out of every view of the configuration (QA napad 4)", () => {
    // Synthetic canaries, built at run time so the secret scanner does not
    // mistake the literals for real keys.
    const stamp = Date.now().toString(36);
    const keyId = ["kanarinacid", stamp].join("-");
    const secret = ["kanarinac", "cfg", stamp].join("-");
    const config = configWith(fakeS3().fetch, {
      credentials: { accessKeyId: keyId, secretAccessKey: secret },
    });
    new S3EvidencePayloadStore(config);

    const sealed = config.credentials;
    const deep = { depth: Infinity, showHidden: true, getters: true };
    const views = [
      JSON.stringify(config),
      inspect(config, deep),
      inspect(config, { ...deep, customInspect: false }),
      JSON.stringify(sealed),
      inspect(sealed, deep),
      inspect(sealed, { ...deep, customInspect: false }),
      String(sealed),
      `${sealed}`,
      JSON.stringify({ ...sealed }),
      JSON.stringify(Object.entries(sealed)),
      JSON.stringify(Reflect.ownKeys(sealed).map(String)),
    ].join("\n");
    expect(views).not.toContain(keyId);
    expect(views).not.toContain(secret);
    expect(views).toContain("redacted");
    expect(Object.isFrozen(sealed)).toBe(true);
  });

  it("seals the same key values it validated, reading each once", () => {
    const reads = { accessKeyId: 0, secretAccessKey: 0 };
    // A getter that answers a valid key first and a different one after.
    const shifting = {
      get accessKeyId() {
        return reads.accessKeyId++ === 0 ? "fake-id-first" : "fake id other!";
      },
      get secretAccessKey() {
        return reads.secretAccessKey++ === 0 ? "fake-secret-first" : "";
      },
    };

    const sealed = new S3SecretCredentials(shifting);

    expect(S3SecretCredentials.reveal(sealed)).toEqual({
      accessKeyId: "fake-id-first",
      secretAccessKey: "fake-secret-first",
    });
    expect(reads).toEqual({ accessKeyId: 1, secretAccessKey: 1 });
  });

  it("refuses plain keys in place of sealed ones, naming no value", () => {
    const secret = ["kanarinac", "plain", Date.now().toString(36)].join("-");
    for (const credentials of [
      { accessKeyId: "fake-id", secretAccessKey: secret },
      null,
      undefined,
      "fake-id",
    ]) {
      let message = "";
      try {
        new S3EvidencePayloadStore({
          ...configWith(fakeS3().fetch),
          credentials: credentials as unknown as S3SecretCredentials,
        });
      } catch (error) {
        message = inspect(error, { depth: Infinity, showHidden: true });
      }
      expect(message).toContain("TypeError");
      expect(message).not.toContain(secret);
    }
  });

  it("does not follow a redirect and makes no second request (S13)", async () => {
    for (const status of [301, 302, 307, 308]) {
      const s3 = fakeS3(() =>
        Promise.resolve(
          new Response(null, { status, headers: { location: "https://zlo.test/x" } }),
        ),
      );
      const { store } = storeWith(s3.fetch);
      await expect(put(store, "a")).resolves.toEqual({
        status: "unavailable",
        reason: `storage_put_status_${status}`,
      });
      expect(s3.calls).toHaveLength(1);
      expect(s3.fetch.mock.calls[0][1]?.redirect).toBe("error");
    }
    // What fetch itself does with redirect: "error".
    const s3 = fakeS3(() => Promise.reject(new TypeError("unexpected redirect")));
    const { store } = storeWith(s3.fetch);
    await expect(put(store, "a")).resolves.toEqual({
      status: "unavailable",
      reason: "storage_request_failed",
    });
    expect(s3.calls).toHaveLength(1);
  });

  it("sends every request to the configured origin only (S14)", async () => {
    const s3 = fakeS3();
    const { store } = storeWith(s3.fetch, { endpoint: "https://s3.example.eu:8443" });
    await put(store, "a");
    await put(store, "a");

    expect(s3.calls).toHaveLength(4);
    expect(new Set(s3.calls.map((c) => c.origin))).toEqual(
      new Set(["https://s3.example.eu:8443"]),
    );
    expect(s3.calls.every((c) => c.path.startsWith("/ductus-evidence/v2/"))).toBe(true);
  });

  it.each([
    "http://s3.example.eu",
    "http://10.0.0.1:9000",
    "https://s3.example.eu/?x=1",
    "https://s3.example.eu/#x",
    "https://user@s3.example.eu",
  ])("refuses to start with endpoint %s (S14)", (endpoint) => {
    expect(() => storeWith(fakeS3().fetch, { endpoint })).toThrow(TypeError);
  });

  it.each<[string, Overrides]>([
    ["an upper-case region", { region: "EU-CENTRAL-1" }],
    ["an empty region", { region: "" }],
    ["a region with a slash", { region: "eu/central" }],
    ["a key id with a slash", { credentials: { accessKeyId: "a/b", secretAccessKey: "s" } }],
    ["an empty key id", { credentials: { accessKeyId: "", secretAccessKey: "s" } }],
    ["an empty secret", { credentials: { accessKeyId: "a", secretAccessKey: "" } }],
    ["a blank secret", { credentials: { accessKeyId: "a", secretAccessKey: " " } }],
    ["a newline secret", { credentials: { accessKeyId: "a", secretAccessKey: "\n" } }],
    ["a secret with a line break", { credentials: { accessKeyId: "a", secretAccessKey: "a\nb" } }],
    ["a secret with a trailing newline", { credentials: { accessKeyId: "a", secretAccessKey: "ab\n" } }],
  ])("refuses to start with %s (S10)", (_, overrides) => {
    expect(() => storeWith(fakeS3().fetch, overrides)).toThrow(TypeError);
  });

  it("bounds the whole call, read-back included, by one deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const s3 = fakeS3((call, signal) =>
        call.method === "PUT"
          ? new Promise((resolve) =>
              setTimeout(() => resolve(new Response(null, { status: 412 })), 60),
            )
          : hang(signal),
      );
      const { store } = storeWith(s3.fetch, { requestTimeoutMs: 100 });
      let result: unknown;
      void put(store, "a").then((r) => (result = r));

      await vi.advanceTimersByTimeAsync(99);
      expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "GET"]);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(result).toEqual({ status: "unavailable", reason: "storage_timeout" });
    } finally {
      vi.useRealTimers();
    }
  });
  it("allows plain http on loopback only when the configuration asks for it", () => {
    expect(() =>
      storeWith(fakeS3().fetch, { allowPlainHttpOnLoopback: false }),
    ).toThrow(TypeError);
    expect(() =>
      storeWith(fakeS3().fetch, { allowPlainHttpOnLoopback: undefined }),
    ).toThrow(TypeError);
    expect(() =>
      storeWith(fakeS3().fetch, {
        endpoint: "https://s3.example.eu",
        allowPlainHttpOnLoopback: false,
      }),
    ).not.toThrow();
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => storeWith(fakeS3().fetch)).toThrow(TypeError);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("answers storage_timeout when fetch ignores the abort signal", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const s3 = fakeS3(() => new Promise<Response>(() => undefined));
      const { store } = storeWith(s3.fetch, { requestTimeoutMs: 20 });
      let result: unknown;
      void put(store, "a").then((r) => (result = r));

      await vi.advanceTimersByTimeAsync(20);
      expect(result).toEqual({ status: "unavailable", reason: "storage_timeout" });
      expect(s3.fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never answers stored for a write that succeeds after the deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const s3 = fakeS3(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(new Response(null, { status: 200 })), 80),
          ),
      );
      const { store } = storeWith(s3.fetch, { requestTimeoutMs: 20 });
      let result: unknown;
      void put(store, "a").then((r) => (result = r));

      await vi.advanceTimersByTimeAsync(100);
      expect(result).toEqual({ status: "unavailable", reason: "storage_timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["conflict", "signature"])(
    "keeps a throwing logger from failing or leaking out of the call (%s)",
    async (kind) => {
      const canary = ["kanarinac", "logger", Date.now().toString(36)].join("-");
      const s3 = fakeS3((call) =>
        kind === "signature"
          ? s3Error(403, "SignatureDoesNotMatch")
          : call.method === "PUT"
            ? Promise.resolve(new Response(null, { status: 412 }))
            : Promise.resolve(new Response(payload("b"))),
      );
      const { store } = storeWith(s3.fetch, {
        warn: () => {
          throw new Error(canary, { cause: new Error(canary) });
        },
      });

      const result = await put(store, "a");
      expect(result).toEqual(
        kind === "signature"
          ? { status: "unavailable", reason: "storage_signature_rejected" }
          : { status: "conflict" },
      );
      expect(inspect(result, { depth: Infinity })).not.toContain(canary);
    },
  );

  it.each(["conflict", "signature", "unverified"])(
    "keeps a rejecting async logger from an unhandled rejection (%s)",
    async (kind) => {
      const canary = ["kanarinac", "async", Date.now().toString(36)].join("-");
      const unhandled: unknown[] = [];
      const listener = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", listener);
      try {
        const s3 = fakeS3((call) => {
          if (kind === "signature") return s3Error(403, "SignatureDoesNotMatch");
          if (kind === "unverified") {
            return Promise.resolve(new Response(null, { status: 200 }));
          }
          return call.method === "PUT"
            ? Promise.resolve(new Response(null, { status: 412 }))
            : Promise.resolve(new Response(payload("b")));
        });
        // Not vi.fn: a mock observes the promises it returns, which would
        // handle the rejection in place of the adapter.
        let warned = 0;
        const warn = () => {
          warned += 1;
          return Promise.reject(new Error(canary));
        };
        const { store } = storeWith(s3.fetch, { warn });

        const result = await put(store, "a");
        expect(result).toEqual(
          {
            conflict: { status: "conflict" },
            signature: { status: "unavailable", reason: "storage_signature_rejected" },
            unverified: { status: "unavailable", reason: "storage_write_unverified" },
          }[kind],
        );
        expect(warned).toBeGreaterThan(0);
        // Unhandled rejections are reported after the microtask queue drains.
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(unhandled).toEqual([]);
        expect(inspect(result, { depth: Infinity })).not.toContain(canary);
      } finally {
        process.off("unhandledRejection", listener);
      }
    },
  );
});

describe("write proof (#155, S1 to S6)", () => {
  const unverified = { status: "unavailable", reason: "storage_write_unverified" };
  const checksumOf = (text: string) =>
    createHash("sha256").update(payload(text)).digest("base64");
  /** Stores the bytes as the fake would, then answers 200 with `headers`. */
  const writtenWith = (
    s3: ReturnType<typeof fakeS3>,
    call: Call,
    headers: Record<string, string>,
    text = "a",
  ) => {
    s3.objects.set(call.path, new TextEncoder().encode(payload(text)));
    return Promise.resolve(new Response(null, { status: 200, headers }));
  };

  it("S1: an empty 200 from a server that stored nothing is not stored", async () => {
    const methods: string[] = [];
    const server = createServer((request, response) => {
      methods.push(request.method ?? "");
      request.resume();
      request.on("end", () => response.writeHead(200).end());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const { store } = storeWith(globalThis.fetch, {
        endpoint: `http://127.0.0.1:${port}`,
      });
      await expect(put(store, "a")).resolves.toEqual(unverified);
      expect(methods).toEqual(["PUT"]);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it.each([
    ["no checksum echo", {}],
    ["the checksum of other bytes", { "x-amz-checksum-sha256": checksumOf("b") }],
    ["a malformed checksum", { "x-amz-checksum-sha256": "nije-zbroj" }],
  ])("S2: a 200 with %s is not stored", async (_, headers) => {
    const s3: ReturnType<typeof fakeS3> = fakeS3((call) =>
      call.method === "PUT" ? writtenWith(s3, call, headers) : null,
    );
    const { store, warn } = storeWith(s3.fetch);

    await expect(put(store, "a")).resolves.toEqual(unverified);
    await expect(put(store, "a")).resolves.not.toMatchObject({ status: "stored" });
    // The orphan candidate signal: ids and the hash only.
    expect(warn).toHaveBeenCalledWith("evidence payload write unverified", {
      institutionId: INSTITUTION,
      evidencePackageId: PACKAGE,
      segmentHash: hashOf(payload("a")),
    });
  });

  it.each([
    ["not found", () => Promise.resolve(new Response(null, { status: 404 }))],
    ["a server error", () => Promise.resolve(new Response(null, { status: 500 }))],
    ["a failed request", () => Promise.reject(new TypeError("fetch failed"))],
  ])("S3: an echoed write whose read-back is %s is not stored", async (_, get) => {
    const s3 = fakeS3((call) =>
      call.method === "PUT"
        ? Promise.resolve(
            new Response(null, {
              status: 200,
              headers: { "x-amz-checksum-sha256": checksumOf("a") },
            }),
          )
        : get(),
    );
    const { store, warn } = storeWith(s3.fetch);

    await expect(put(store, "a")).resolves.toEqual(unverified);
    expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "GET"]);
    expect(warn).toHaveBeenCalledWith("evidence payload write unverified", {
      institutionId: INSTITUTION,
      evidencePackageId: PACKAGE,
      segmentHash: hashOf(payload("a")),
    });
  });

  it.each([
    ["RequestTimeTooSkewed", "storage_clock_skew"],
    ["SignatureDoesNotMatch", "storage_signature_rejected"],
    ["InvalidAccessKeyId", "storage_signature_rejected"],
  ])(
    "S3: an echoed write whose read-back is refused with %s is unverified and logs the cause",
    async (code, cause) => {
      const s3 = fakeS3((call) =>
        call.method === "PUT"
          ? Promise.resolve(
              new Response(null, {
                status: 200,
                headers: { "x-amz-checksum-sha256": checksumOf("a") },
              }),
            )
          : s3Error(403, code),
      );
      const { store, warn } = storeWith(s3.fetch);

      // The caller sees the plan's outcome (6106170317); the cause stays in
      // the server log only.
      await expect(put(store, "a")).resolves.toEqual({
        status: "unavailable",
        reason: "storage_write_unverified",
      });
      expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "GET"]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith("evidence payload write unverified", {
        institutionId: INSTITUTION,
        evidencePackageId: PACKAGE,
        segmentHash: hashOf(payload("a")),
        cause,
      });
    },
  );

  it("S4: an echoed write that reads back other bytes is a conflict", async () => {
    const s3: ReturnType<typeof fakeS3> = fakeS3((call) =>
      call.method === "PUT"
        ? writtenWith(s3, call, { "x-amz-checksum-sha256": checksumOf("a") }, "b")
        : null,
    );
    const { store, warn } = storeWith(s3.fetch);

    await expect(put(store, "a")).resolves.toEqual({ status: "conflict" });
    expect(warn).toHaveBeenCalledWith("evidence payload conflict", {
      institutionId: INSTITUTION,
      evidencePackageId: PACKAGE,
      segmentHash: hashOf(payload("a")),
    });
  });

  const confirmed = capabilityOf("http://127.0.0.1:9100");
  it.each<[string, unknown]>([
    ["missing", undefined],
    ["an unconfirmed conditional write", { ...confirmed, conditionalWrite: "assumed" }],
    ["no checksum echo confirmation", { ...confirmed, checksumEcho: undefined }],
    ["another endpoint", { ...confirmed, endpoint: "http://localhost:9100" }],
    ["an impossible month", { ...confirmed, verifiedOn: "2026-13-01" }],
    ["a day that rolls over", { ...confirmed, verifiedOn: "2026-02-30" }],
    ["a future date", { ...confirmed, verifiedOn: "9999-01-01" }],
    ["no provider", { ...confirmed, provider: "" }],
    ["no contract test", { ...confirmed, contractTest: "" }],
  ])(
    "S5: storage that ignores the condition never runs without its capability confirmation (%s)",
    async (_, capability) => {
      // Overwrites whatever is there and answers as a correct store would:
      // no answer within one request tells it apart, so only the lock does.
      const objects = new Map<string, Uint8Array>();
      objects.set("x", new TextEncoder().encode(payload("prvi")));
      const overwriting = vi.fn(async (url: URL | string | Request, init?: RequestInit) => {
        const body = init?.body as Uint8Array;
        objects.set(new URL(String(url)).pathname, body.slice());
        return new Response(null, {
          status: 200,
          headers: {
            "x-amz-checksum-sha256": createHash("sha256").update(body).digest("base64"),
          },
        });
      });

      expect(() =>
        storeWith(overwriting, {
          capability: capability as S3EvidencePayloadStoreConfig["capability"],
        }),
      ).toThrow(TypeError);
      expect(overwriting).not.toHaveBeenCalled();
      expect(objects.size).toBe(1);
    },
  );

  it("S5: the confirmation error names no configured value", () => {
    const secretish = "kanarinac-konfiguracija";
    let message = "";
    try {
      storeWith(fakeS3().fetch, {
        capability: { ...confirmed, provider: `${secretish} `, contractTest: secretish },
      });
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toBe("");
    expect(message).not.toContain(secretish);
  });

  it.each<[string, (signal: AbortSignal) => Promise<Response>]>([
    ["rejects on abort", hang],
    ["ignores the abort", () => new Promise<Response>(() => {})],
  ])(
    "S6: a deadline after a confirmed echo is an unverified write, logged once (read-back %s)",
    async (_, readBack) => {
      const s3: ReturnType<typeof fakeS3> = fakeS3((call, signal) =>
        call.method === "PUT"
          ? writtenWith(s3, call, { "x-amz-checksum-sha256": checksumOf("a") })
          : readBack(signal),
      );
      const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 30 });

      await expect(put(store, "a")).resolves.toEqual({
        status: "unavailable",
        reason: "storage_write_unverified",
      });
      // Let a read-back that rejects on abort finish behind the answer.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "GET"]);
      expect(warn.mock.calls).toEqual([
        [
          "evidence payload write unverified",
          {
            institutionId: INSTITUTION,
            evidencePackageId: PACKAGE,
            segmentHash: hashOf(payload("a")),
          },
        ],
      ]);
    },
  );

  it("S6: a deadline before the echo is confirmed stays storage_timeout", async () => {
    // The PUT ignores the abort and echoes correctly only after the deadline.
    const s3: ReturnType<typeof fakeS3> = fakeS3((call) =>
      call.method === "PUT"
        ? new Promise<Response>((resolve) =>
            setTimeout(
              () => resolve(writtenWith(s3, call, { "x-amz-checksum-sha256": checksumOf("a") })),
              60,
            ),
          )
        : null,
    );
    const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 30 });

    await expect(put(store, "a")).resolves.toEqual({
      status: "unavailable",
      reason: "storage_timeout",
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(s3.calls.map((c) => c.method)).toEqual(["PUT"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("verifies every write: a stored answer always follows a read-back", async () => {
    const s3 = fakeS3();
    const { store } = storeWith(s3.fetch);

    await expect(put(store, "a")).resolves.toMatchObject({ status: "stored" });
    expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "GET"]);
  });
});

describe("one monotonic deadline (QA qa233d)", () => {
  const timeout = { status: "unavailable", reason: "storage_timeout" };
  const unverified = { status: "unavailable", reason: "storage_write_unverified" };
  /** Holds the event loop, so a timer set before it can only fire late. */
  const block = (ms: number) => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      // busy on purpose
    }
  };
  /** A 200 whose body hands over `bytes`, then blocks before it closes. */
  const closingLate = (bytes: Uint8Array) => {
    let pulls = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulls++ === 0) {
            controller.enqueue(bytes.slice());
            return;
          }
          block(60);
          controller.close();
        },
      }),
      { status: 200 },
    );
  };
  const idsOfA = {
    institutionId: INSTITUTION,
    evidencePackageId: PACKAGE,
    segmentHash: hashOf(payload("a")),
  };

  it.each<[string, (s3: ReturnType<typeof fakeS3>, call: Call) => Promise<Response> | null]>([
    ["answers late", () => (block(60), null)],
    [
      "closes its body late",
      (s3, call) => Promise.resolve(closingLate(s3.objects.get(call.path)!)),
    ],
  ])(
    "a read-back that %s past the deadline is unverified, logged once, never stored",
    async (_, readBack) => {
      const s3: ReturnType<typeof fakeS3> = fakeS3((call) =>
        call.method === "GET" ? readBack(s3, call) : null,
      );
      const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 20 });

      await expect(put(store, "a")).resolves.toEqual(unverified);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(warn.mock.calls).toEqual([["evidence payload write unverified", idsOfA]]);
    },
  );

  it("a PUT echo that arrives past the deadline confirms nothing and starts no read-back", async () => {
    const s3: ReturnType<typeof fakeS3> = fakeS3((call) =>
      call.method === "PUT" ? (block(60), null) : null,
    );
    const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 20 });

    await expect(put(store, "a")).resolves.toEqual(timeout);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(s3.calls.map((c) => c.method)).toEqual(["PUT"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a comparison read that answers past the deadline is not existing", async () => {
    const s3: ReturnType<typeof fakeS3> = fakeS3((call) =>
      call.method === "GET" ? (block(60), null) : null,
    );
    s3.objects.set(keyOf(PACKAGE, hashOf(payload("a"))), new TextEncoder().encode(payload("a")));
    const { store } = storeWith(s3.fetch, { requestTimeoutMs: 20 });

    await expect(put(store, "a")).resolves.toEqual(timeout);
    expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "GET"]);
  });

  it("answers stored only within the deadline, even when no timer is late", async () => {
    const text = "a".repeat(2_097_000);
    const s3 = fakeS3();
    const { store } = storeWith(s3.fetch, { requestTimeoutMs: 1 });

    const started = performance.now();
    const result = await put(store, text);
    const elapsed = performance.now() - started;

    // Hashing, signing and comparing 2 MB takes far longer than 1 ms.
    expect(elapsed).toBeGreaterThan(1);
    expect(result).toMatchObject({ status: "unavailable" });
  });
});
