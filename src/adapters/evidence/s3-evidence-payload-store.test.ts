import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { inspect } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";

import {
  S3EvidencePayloadStore,
  STORAGE_IDENTITY_KEY,
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

/** Taken before any test fakes the timers, so waiting for it never stalls. */
const realSetImmediate = setImmediate;

/** Lets the macrotask the store writes its log line in run. */
const logged = () => new Promise<void>((resolve) => realSetImmediate(resolve));

/** Answers the outcome once the line it logs, if any, is written. */
const put = async (
  store: S3EvidencePayloadStore,
  text: string,
  pkg = PACKAGE,
  institutionId = INSTITUTION,
) => {
  const outcome = await store.putImmutable({
    institutionId,
    evidencePackageId: pkg,
    segmentHash: hashOf(payload(text)),
    canonicalPayload: payload(text),
  });
  await logged();
  return outcome;
};

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
    // A store that waited on the cancel would end at the deadline instead, so
    // the deadline only has to be far beyond the real work: under CPU load a
    // 50 ms deadline answered storage_timeout here (#651).
    await expect(
      put(storeWith(stored.fetch, { requestTimeoutMs: 5_000 }).store, "a"),
    ).resolves.toEqual({ status: "stored", storageRef: expect.any(String) });

    const tooLarge = fakeS3((call) =>
      Promise.resolve(
        call.method === "PUT"
          ? new Response(null, { status: 412 })
          : stuck(200, MAX_EVIDENCE_SEGMENT_BYTES + 1),
      ),
    );
    await expect(
      put(storeWith(tooLarge.fetch, { requestTimeoutMs: 5_000 }).store, "a"),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "storage_object_too_large",
    });
  });

  it("lets the client retry after a timeout, written or not", async () => {
    // The timer ends the hanging calls; the retries must not race a real
    // 20 ms deadline, which under CPU load they lost (#651).
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let mode: "write-then-hang" | "hang" | "normal" = "write-then-hang";
      const s3 = fakeS3((call, signal) => {
        if (mode === "normal") return null;
        if (mode === "write-then-hang") {
          s3.objects.set(call.path, new TextEncoder().encode(payload("a")));
        }
        return hang(signal);
      });
      const { store } = storeWith(s3.fetch, { requestTimeoutMs: 20_000 });
      const timedOut = async (text: string) => {
        const pending = put(store, text);
        await vi.advanceTimersByTimeAsync(20_000);
        return pending;
      };

      await expect(timedOut("a")).resolves.toMatchObject({
        status: "unavailable",
      });
      mode = "normal";
      await expect(put(store, "a")).resolves.toMatchObject({
        status: "existing",
      });

      mode = "hang";
      await expect(timedOut("b")).resolves.toMatchObject({
        status: "unavailable",
      });
      mode = "normal";
      await expect(put(store, "b")).resolves.toMatchObject({ status: "stored" });
      expect(s3.objects.size).toBe(2);
    } finally {
      vi.useRealTimers();
    }
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
      await logged();
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
      await logged();
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
        // A real socket runs on the real clock: under load this round trip
        // took up to 360 ms (40-60 ms idle) and once passed the shared 1 s
        // deadline, which rightly answers storage_timeout instead (#645).
        // Deadlines are tested with fake timers above; here the deadline only
        // has to be out of the way. 20 s still fails a hung server before the
        // 30 s test timeout and stays under MAX_S3_REQUEST_TIMEOUT_MS.
        requestTimeoutMs: 20_000,
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
      // The confirmed echo must not race a real 30 ms deadline, which under
      // CPU load it lost to storage_timeout (#651); the timer ends the read-back.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const s3: ReturnType<typeof fakeS3> = fakeS3((call, signal) =>
          call.method === "PUT"
            ? writtenWith(s3, call, { "x-amz-checksum-sha256": checksumOf("a") })
            : readBack(signal),
        );
        const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 20_000 });

        const pending = put(store, "a");
        await vi.advanceTimersByTimeAsync(20_000);
        await expect(pending).resolves.toEqual({
          status: "unavailable",
          reason: "storage_write_unverified",
        });
        // Let a read-back that rejects on abort finish behind the answer.
        await vi.advanceTimersByTimeAsync(10);
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
      } finally {
        vi.useRealTimers();
      }
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

  /**
   * A monotonic clock that passes the deadline right after the PUT answer is
   * checked: reads 0 (deadline) and 1 (check after the PUT) are on time,
   * every later read is past it. No timer fires within the test.
   */
  // Readings: the call's start, the check before the PUT and the check
  // after its answer are on time; every later one is past the deadline.
  const passDeadlineAfterPutCheck = () => {
    const start = performance.now();
    let reads = 0;
    return vi
      .spyOn(performance, "now")
      .mockImplementation(() => (reads++ < 3 ? start : start + 1_000_000));
  };

  it.each<[string, boolean, object]>([
    ["an echoed write", false, unverified],
    ["a write the key already holds", true, timeout],
  ])("%s starts no read-back once the deadline has passed", async (_, keyHeld, expected) => {
    const s3 = fakeS3();
    if (keyHeld) {
      s3.objects.set(keyOf(PACKAGE, hashOf(payload("a"))), new TextEncoder().encode(payload("a")));
    }
    const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 60_000 });
    const clock = passDeadlineAfterPutCheck();
    try {
      await expect(put(store, "a")).resolves.toEqual(expected);
    } finally {
      clock.mockRestore();
    }
    expect(s3.calls.map((c) => c.method)).toEqual(["PUT"]);
    expect(warn.mock.calls).toEqual(
      expected === unverified ? [["evidence payload write unverified", idsOfA]] : [],
    );
  });

  it("a comparison read of other bytes past the deadline is a timeout, not a conflict", async () => {
    const s3: ReturnType<typeof fakeS3> = fakeS3((call) =>
      call.method === "GET" ? (block(60), null) : null,
    );
    s3.objects.set(keyOf(PACKAGE, hashOf(payload("a"))), new TextEncoder().encode(payload("b")));
    const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 20 });

    await expect(put(store, "a")).resolves.toEqual(timeout);
    expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "GET"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs no conflict for other bytes that arrive after the deadline answered", async () => {
    const other = new TextEncoder().encode(payload("b"));
    const s3: ReturnType<typeof fakeS3> = fakeS3((call) =>
      call.method === "GET"
        ? new Promise((resolve) =>
            setTimeout(() => resolve(new Response(other.slice(), { status: 200 })), 40),
          )
        : null,
    );
    s3.objects.set(keyOf(PACKAGE, hashOf(payload("a"))), other);
    const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 20 });

    await expect(put(store, "a")).resolves.toEqual(timeout);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "GET"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([404, 500])(
    "a comparison read that fails with %i past the deadline is a timeout",
    async (status) => {
      const s3: ReturnType<typeof fakeS3> = fakeS3((call) =>
        call.method === "GET" ? (block(60), Promise.resolve(new Response(null, { status }))) : null,
      );
      s3.objects.set(keyOf(PACKAGE, hashOf(payload("a"))), new TextEncoder().encode(payload("a")));
      const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 20 });

      await expect(put(store, "a")).resolves.toEqual(timeout);
      expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "GET"]);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it.each<[string, string]>([
    ["existing", "a"],
    ["conflict", "b"],
  ])(
    "a deadline that passes while comparing the bytes at the key is a timeout, not %s",
    async (_, held) => {
      // Comparing the read-back byte by byte is the first comparison after
      // the GET; it spends the whole deadline on this clock.
      let now = performance.now();
      let afterGet = false;
      let spent = 0;
      const s3 = fakeS3((call) => {
        if (call.method === "GET") afterGet = true;
        return null;
      });
      s3.objects.set(keyOf(PACKAGE, hashOf(payload("a"))), new TextEncoder().encode(payload(held)));
      const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 60_000 });
      const realEvery = Uint8Array.prototype.every;
      const every = vi
        .spyOn(Uint8Array.prototype, "every")
        .mockImplementation(function (
          this: Uint8Array,
          ...args: Parameters<Uint8Array["every"]>
        ) {
          if (afterGet) {
            now += 1_000_000;
            spent += 1;
          }
          return realEvery.apply(this, args);
        });
      const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
      try {
        await expect(put(store, "a")).resolves.toEqual(timeout);
      } finally {
        clock.mockRestore();
        every.mockRestore();
      }
      expect(spent).toBe(1);
      expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "GET"]);
      expect(warn).not.toHaveBeenCalled();
    },
  );

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

  it("counts the deadline from the call, so checking the input cannot start a late PUT", async () => {
    const s3 = fakeS3();
    const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 60_000 });
    const input = {
      institutionId: INSTITUTION,
      evidencePackageId: PACKAGE,
      segmentHash: hashOf(payload("a")),
      canonicalPayload: payload("a"),
    };
    // Encoding the input spends the whole deadline on this clock.
    let now = performance.now();
    let encoded = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const realEncode = TextEncoder.prototype.encode;
    const encode = vi
      .spyOn(TextEncoder.prototype, "encode")
      .mockImplementation(function (this: TextEncoder, text?: string) {
        now += 1_000_000;
        encoded += 1;
        return realEncode.call(this, text);
      });
    try {
      await expect(store.putImmutable(input)).resolves.toEqual(timeout);
    } finally {
      encode.mockRestore();
      clock.mockRestore();
    }
    expect(encoded).toBeGreaterThan(0);
    expect(s3.calls).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each<[string, number, boolean, object, string[]]>([
    ["the PUT", 1, false, timeout, []],
    ["the read-back of an echoed write", 2, false, unverified, ["PUT"]],
    ["the comparison read at a held key", 2, true, timeout, ["PUT"]],
  ])(
    "a deadline that passes while signing %s sends no request",
    async (_, spendOn, keyHeld, expected, sent) => {
      // The signing time is read once per request while it is signed; that
      // read spends the whole deadline on this clock.
      let now = performance.now();
      let signing = 0;
      const s3 = fakeS3();
      if (keyHeld) {
        s3.objects.set(keyOf(PACKAGE, hashOf(payload("a"))), new TextEncoder().encode(payload("a")));
      }
      const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 60_000 });
      const signingTime = vi
        .spyOn(store as unknown as { now: () => Date }, "now")
        .mockImplementation(() => {
          if (++signing === spendOn) now += 1_000_000;
          return new Date();
        });
      const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
      try {
        await expect(put(store, "a")).resolves.toEqual(expected);
      } finally {
        clock.mockRestore();
        signingTime.mockRestore();
      }
      expect(signing).toBe(spendOn);
      expect(s3.calls.map((c) => c.method)).toEqual(sent);
      expect(warn.mock.calls).toEqual(
        expected === unverified ? [["evidence payload write unverified", idsOfA]] : [],
      );
    },
  );

  it("a stored write leaves no timer that later logs it as unverified", async () => {
    // The write must not race a real 20 ms deadline (#651); the fake clock
    // then runs well past the deadline instead of waiting for it.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const s3 = fakeS3();
      const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 20_000 });

      await expect(put(store, "a")).resolves.toMatchObject({ status: "stored" });
      // Past the deadline: a timer still armed would now log the write.
      await vi.advanceTimersByTimeAsync(40_000);
      await logged();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a reading exactly at the deadline is past it: no request is sent", async () => {
    const s3 = fakeS3();
    const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 60_000 });
    const start = performance.now();
    let reads = 0;
    // The call's start, then every later reading at start + requestTimeoutMs.
    const clock = vi
      .spyOn(performance, "now")
      .mockImplementation(() => (reads++ === 0 ? start : start + 60_000));
    try {
      await expect(put(store, "a")).resolves.toEqual(timeout);
    } finally {
      clock.mockRestore();
    }
    expect(reads).toBeGreaterThan(1);
    expect(s3.calls).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a clock that throws at the start rejects the call before any request", async () => {
    const s3 = fakeS3();
    const { store, warn } = storeWith(s3.fetch);
    const broken = new Error("clock unavailable");
    const clock = vi.spyOn(performance, "now").mockImplementation(() => {
      throw broken;
    });
    try {
      await expect(put(store, "a")).rejects.toBe(broken);
    } finally {
      clock.mockRestore();
    }
    await logged();
    expect(s3.calls).toEqual([]);
    expect([...s3.objects.keys()]).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("byte-identical read-back (Codex 4240926024)", () => {
  const unverified = { status: "unavailable", reason: "storage_write_unverified" };
  const encoded = { status: "unavailable", reason: "storage_get_encoded" };
  const idsOfA = {
    institutionId: INSTITUTION,
    evidencePackageId: PACKAGE,
    segmentHash: hashOf(payload("a")),
  };
  /** A GET answered with `bytes` as a decoding fetch hands them over. */
  const withEncoding = (encoding: string) => (call: Call) =>
    call.method === "GET"
      ? Promise.resolve(
          new Response(new TextEncoder().encode(payload("a")), {
            status: 200,
            headers: { "content-encoding": encoding },
          }),
        )
      : null;

  it("asks for the stored bytes as they are, without signing that request", async () => {
    const s3 = fakeS3();
    const { store } = storeWith(s3.fetch);
    await expect(put(store, "a")).resolves.toMatchObject({ status: "stored" });
    const get = s3.calls[1];
    expect(get.method).toBe("GET");
    expect(get.headers.get("accept-encoding")).toBe("identity");
    expect(signedHeadersOf(get)?.split(";")).not.toContain("accept-encoding");
    expect(s3.calls[0].headers.has("accept-encoding")).toBe(false);
  });

  it.each(["gzip", "br", "deflate", "GZIP", "identity, gzip", ""])(
    "never answers existing for a key read back with Content-Encoding %j",
    async (encoding) => {
      const s3 = fakeS3(withEncoding(encoding));
      s3.objects.set(keyOf(PACKAGE, hashOf(payload("a"))), new Uint8Array([1]));
      const { store, warn } = storeWith(s3.fetch);
      await expect(put(store, "a")).resolves.toEqual(encoded);
      expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "GET"]);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it("never answers stored for an echoed write read back encoded", async () => {
    const s3 = fakeS3(withEncoding("gzip"));
    const { store, warn } = storeWith(s3.fetch);
    await expect(put(store, "a")).resolves.toEqual(unverified);
    expect(warn.mock.calls).toEqual([["evidence payload write unverified", idsOfA]]);
  });

  it.each(["identity", " Identity "])(
    "compares a read back with Content-Encoding %j as stored bytes",
    async (encoding) => {
      const s3 = fakeS3(withEncoding(encoding));
      s3.objects.set(keyOf(PACKAGE, hashOf(payload("a"))), new Uint8Array([1]));
      const { store } = storeWith(s3.fetch);
      await expect(put(store, "a")).resolves.toMatchObject({ status: "existing" });
    },
  );
});

describe("no request and no content outcome past the deadline (QA qa233e)", () => {
  const timeout = { status: "unavailable", reason: "storage_timeout" };
  const unverified = { status: "unavailable", reason: "storage_write_unverified" };
  const idsOfA = {
    institutionId: INSTITUTION,
    evidencePackageId: PACKAGE,
    segmentHash: hashOf(payload("a")),
  };
  /** A monotonic clock the test moves; timers stay real and far away. */
  const controlledClock = (start = 100) => {
    const clock = { now: start };
    const spy = vi.spyOn(performance, "now").mockImplementation(() => clock.now);
    return { clock, restore: () => spy.mockRestore() };
  };
  /** S3 that answers the PUT with `status` (or stores it) and reads back other bytes. */
  const otherBytesAfter = (status: number) =>
    fakeS3((call) => {
      if (call.method === "PUT" && status !== 200) {
        return Promise.resolve(new Response(null, { status }));
      }
      if (call.method === "GET") {
        return Promise.resolve(new Response(new TextEncoder().encode(payload("b"))));
      }
      return null;
    });

  it.each<[number, string, () => unknown]>([
    [200, "blocks past the deadline", () => undefined],
    [412, "blocks past the deadline", () => undefined],
    [409, "blocks past the deadline", () => undefined],
    [200, "throws", () => {
      throw new Error("logger down");
    }],
    [412, "hangs", () => new Promise(() => undefined)],
    [409, "rejects", () => Promise.reject(new Error("logger down"))],
  ])(
    "a conflict after PUT %i is decided before a logger that %s runs, logged once",
    async (status, _, behave) => {
      const s3 = otherBytesAfter(status);
      const { clock, restore } = controlledClock();
      let decided = false;
      const seenDecided: boolean[] = [];
      const warn = vi.fn(() => {
        seenDecided.push(decided);
        clock.now += 1_000_000;
        return behave();
      });
      const store = new S3EvidencePayloadStore({
        ...configWith(s3.fetch, { requestTimeoutMs: 60_000 }),
        warn,
      });
      const result = put(store, "a");
      try {
        const settled = await Promise.race([
          result.then((r) => {
            decided = true;
            return r;
          }),
          new Promise((resolve) => setTimeout(() => resolve("hung"), 1_000)),
        ]);
        expect(settled).toEqual({ status: "conflict" });
      } finally {
        restore();
      }
      expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "GET"]);
      // Written exactly once, and only after the outcome was fixed.
      expect(warn.mock.calls).toEqual([["evidence payload conflict", idsOfA]]);
      expect(seenDecided).toEqual([false]);
      expect(clock.now).toBe(100 + 1_000_000);
    },
  );

  it.each<[string, number, boolean, object, string[]]>([
    ["the PUT", 1, false, timeout, []],
    ["the read-back of an echoed write", 2, false, unverified, ["PUT"]],
    ["the comparison read at a held key", 2, true, timeout, ["PUT"]],
  ])(
    "a stall between the last check and sending %s sends nothing",
    async (_, stallOn, keyHeld, expected, sent) => {
      const s3 = fakeS3();
      if (keyHeld) {
        s3.objects.set(keyOf(PACKAGE, hashOf(payload("a"))), new TextEncoder().encode(payload("a")));
      }
      const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 60_000 });
      const inner = store as unknown as { send: (...args: unknown[]) => Promise<unknown> };
      const send = inner.send.bind(store);
      const { clock, restore } = controlledClock();
      let sends = 0;
      const stall = vi.spyOn(inner, "send").mockImplementation((...args) => {
        if (++sends === stallOn) clock.now += 1_000_000;
        return send(...args);
      });
      try {
        await expect(put(store, "a")).resolves.toEqual(expected);
      } finally {
        stall.mockRestore();
        restore();
      }
      expect(sends).toBe(stallOn);
      expect(s3.calls.map((c) => c.method)).toEqual(sent);
      expect(warn.mock.calls).toEqual(
        expected === unverified ? [["evidence payload write unverified", idsOfA]] : [],
      );
    },
  );

  it.each<[string, boolean, (start: number) => number, object]>([
    ["no reading", false, () => Number.NaN, unverified],
    ["no reading", true, () => Number.NaN, timeout],
    ["a reading that runs back", false, (start) => start - 50, unverified],
    ["a reading that runs back", true, (start) => start - 50, timeout],
  ])(
    "a monotonic clock with %s after the read-back (key held: %s) proves no time left",
    async (_, keyHeld, after, expected) => {
      const { clock, restore } = controlledClock(100);
      const s3 = fakeS3((call) => {
        if (call.method === "GET") clock.now = after(100);
        return null;
      });
      if (keyHeld) {
        s3.objects.set(keyOf(PACKAGE, hashOf(payload("a"))), new TextEncoder().encode(payload("a")));
      }
      // The controlled clock decides; the real timer stays far away, or under
      // CPU load it could fire first and answer storage_timeout (#651).
      const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 60_000 });
      try {
        await expect(put(store, "a")).resolves.toEqual(expected);
      } finally {
        restore();
      }
      expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "GET"]);
      expect(warn.mock.calls).toEqual(
        expected === unverified ? [["evidence payload write unverified", idsOfA]] : [],
      );
    },
  );

  const anomalies: [string, number][] = [
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a reading that runs back", 50],
  ];
  // Readings, echoed write: start, send PUT, after PUT, send GET, after the
  // comparison. Held key: the same, then after the GET and after comparing.
  const echoedReadings: [number, object, string[]][] = [
    [1, timeout, []],
    [2, timeout, []],
    [3, timeout, ["PUT"]],
    [4, unverified, ["PUT"]],
    [5, unverified, ["PUT", "GET"]],
  ];
  const heldReadings: [number, object, string[]][] = [
    [1, timeout, []],
    [2, timeout, []],
    [3, timeout, ["PUT"]],
    [4, timeout, ["PUT"]],
    [5, timeout, ["PUT", "GET"]],
    [6, timeout, ["PUT", "GET"]],
  ];
  it.each(
    anomalies.flatMap(([name, value]) =>
      [
        ...echoedReadings.map(
          ([n, expected, sent]) => [name, n, false, value, expected, sent] as const,
        ),
        ...heldReadings.map(
          ([n, expected, sent]) => [name, n, true, value, expected, sent] as const,
        ),
        // The first reading has nothing earlier to run back from.
      ].filter(([, n]) => value !== 50 || n > 1),
    ),
  )(
    "a monotonic clock reading %s at reading %i (key held: %s) fails closed",
    async (_, n, keyHeld, value, expected, sent) => {
      const s3 = fakeS3();
      if (keyHeld) {
        s3.objects.set(keyOf(PACKAGE, hashOf(payload("a"))), new TextEncoder().encode(payload("a")));
      }
      const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 60_000 });
      let readings = 0;
      // Every other reading is 100, so a single bad one must stick.
      const clock = vi
        .spyOn(performance, "now")
        .mockImplementation(() => (++readings === n ? value : 100));
      try {
        await expect(put(store, "a")).resolves.toEqual(expected);
      } finally {
        clock.mockRestore();
      }
      expect(readings).toBeGreaterThanOrEqual(n);
      expect(s3.calls.map((c) => c.method)).toEqual(sent);
      expect(warn.mock.calls).toEqual(
        expected === unverified ? [["evidence payload write unverified", idsOfA]] : [],
      );
    },
  );

  it.each<[string, number, boolean, object, string[]]>([
    ["the PUT", 1, false, { status: "unavailable", reason: "storage_request_failed" }, []],
    ["an echoed write's read-back", 2, false, unverified, ["PUT"]],
    [
      "the comparison read at a held key",
      2,
      true,
      { status: "unavailable", reason: "storage_request_failed" },
      ["PUT"],
    ],
  ])("a signature that cannot be made for %s sends nothing more", async (_, failOn, keyHeld, expected, sent) => {
    const s3 = fakeS3();
    if (keyHeld) {
      s3.objects.set(keyOf(PACKAGE, hashOf(payload("a"))), new TextEncoder().encode(payload("a")));
    }
    const { store, warn } = storeWith(s3.fetch);
    const inner = store as unknown as { sign: (...args: unknown[]) => unknown };
    const sign = inner.sign.bind(store);
    let signs = 0;
    const failing = vi
      .spyOn(inner, "sign")
      .mockImplementation((...args) => (++signs === failOn ? null : sign(...args)));
    try {
      await expect(put(store, "a")).resolves.toEqual(expected);
    } finally {
      failing.mockRestore();
    }
    expect(signs).toBe(failOn);
    expect(s3.calls.map((c) => c.method)).toEqual(sent);
    expect(warn.mock.calls).toEqual(
      expected === unverified ? [["evidence payload write unverified", idsOfA]] : [],
    );
  });

  it("an answer after the timer fired starts no request, even on a clock that stands still", async () => {
    let answered = false;
    const s3 = fakeS3((call) => {
      if (call.method !== "PUT") return null;
      const body = new TextEncoder().encode(payload("a"));
      const echo = createHash("sha256").update(body).digest("base64");
      // Ignores the abort and answers a matching echo after the timer.
      return new Promise((resolve) =>
        setTimeout(() => {
          answered = true;
          resolve(new Response(null, { status: 200, headers: { "x-amz-checksum-sha256": echo } }));
        }, 60),
      );
    });
    const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 20 });
    const { restore } = controlledClock();
    try {
      await expect(put(store, "a")).resolves.toEqual(timeout);
      await vi.waitFor(() => expect(answered).toBe(true));
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      restore();
    }
    expect(s3.calls.map((c) => c.method)).toEqual(["PUT"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "a monotonic clock reading %s at the start sends nothing",
    async (start) => {
      const s3 = fakeS3();
      const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 60_000 });
      const { restore } = controlledClock(start);
      try {
        await expect(put(store, "a")).resolves.toEqual(timeout);
      } finally {
        restore();
      }
      expect(s3.calls).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it("a deadline that passes while comparing an echoed write's read-back is unverified", async () => {
    const { clock, restore } = controlledClock();
    let armed = false;
    const s3 = fakeS3((call) => {
      if (call.method === "GET") armed = true;
      return null;
    });
    const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 60_000 });
    const every = Uint8Array.prototype.every;
    const comparing = vi
      .spyOn(Uint8Array.prototype, "every")
      .mockImplementation(function (this: Uint8Array, ...args) {
        if (armed) clock.now += 1_000_000;
        return every.apply(this, args);
      });
    try {
      await expect(put(store, "a")).resolves.toEqual(unverified);
    } finally {
      comparing.mockRestore();
      restore();
    }
    expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "GET"]);
    expect(warn.mock.calls).toEqual([["evidence payload write unverified", idsOfA]]);
  });

  it.each<[string, (bytes: Uint8Array) => Uint8Array]>([
    ["one byte short", (bytes) => bytes.slice(0, -1)],
    ["one byte long", (bytes) => Uint8Array.from([...bytes, bytes[0]])],
  ])("an echoed write read back %s is a conflict, never stored", async (_, change) => {
    const s3 = fakeS3((call) =>
      call.method === "GET"
        ? Promise.resolve(new Response(change(new TextEncoder().encode(payload("a"))).slice()))
        : null,
    );
    const { store, warn } = storeWith(s3.fetch);
    await expect(put(store, "a")).resolves.toEqual({ status: "conflict" });
    expect(s3.calls.map((c) => c.method)).toEqual(["PUT", "GET"]);
    expect(warn.mock.calls).toEqual([["evidence payload conflict", idsOfA]]);
  });
});

describe("the log line waits until the caller resumes (QA qa233e, macrotask)", () => {
  const unverified = { status: "unavailable", reason: "storage_write_unverified" };
  const idsOfA = {
    institutionId: INSTITUTION,
    evidencePackageId: PACKAGE,
    segmentHash: hashOf(payload("a")),
  };
  const inputOf = (text: string) => ({
    institutionId: INSTITUTION,
    evidencePackageId: PACKAGE,
    segmentHash: hashOf(payload(text)),
    canonicalPayload: payload(text),
  });
  /** S3 that answers the PUT with `status` (or stores it) and reads back other bytes. */
  const otherBytesAfter = (status: number) => () =>
    fakeS3((call) => {
      if (call.method === "PUT" && status !== 200) {
        return Promise.resolve(new Response(null, { status }));
      }
      if (call.method === "GET") {
        return Promise.resolve(new Response(new TextEncoder().encode(payload("b"))));
      }
      return null;
    });
  /** S3 that stores the write, echoes it and fails the read-back. */
  const readBackFails = () =>
    fakeS3((call) =>
      call.method === "GET" ? Promise.resolve(new Response(null, { status: 503 })) : null,
    );

  it.each<[string, () => ReturnType<typeof fakeS3>, object, string]>([
    ["a conflict after PUT 200", otherBytesAfter(200), { status: "conflict" }, "evidence payload conflict"],
    ["a conflict after PUT 412", otherBytesAfter(412), { status: "conflict" }, "evidence payload conflict"],
    ["a conflict after PUT 409", otherBytesAfter(409), { status: "conflict" }, "evidence payload conflict"],
    ["an unverified write", readBackFails, unverified, "evidence payload write unverified"],
  ])(
    "%s: the caller resumes after await putImmutable before the logger runs",
    async (_, s3Of, expected, line) => {
      const s3 = s3Of();
      const order: string[] = [];
      const store = new S3EvidencePayloadStore({
        ...configWith(s3.fetch),
        warn: (message) => void order.push(`log: ${message}`),
      });

      const outcome = await store.putImmutable(inputOf("a"));
      order.push("caller");

      expect(outcome).toEqual(expected);
      await logged();
      expect(order).toEqual(["caller", `log: ${line}`]);
    },
  );

  it("a logger that blocks for 600 ms leaves a 200 ms deadline to the caller, then logs once", async () => {
    // Warm the path up on another store so the measured call is the store's own.
    const warm = new S3EvidencePayloadStore({ ...configWith(otherBytesAfter(412)().fetch), warn: vi.fn() });
    await warm.putImmutable(inputOf("a"));
    await logged();

    // The logger still blocks three times longer than the deadline, so a
    // logger on the caller's path still fails this test; the deadline is ten
    // times the former 20 ms, which the call itself exceeded under CPU load (#651).
    const s3 = otherBytesAfter(412)();
    const warn = vi.fn(() => {
      const until = Date.now() + 600;
      while (Date.now() < until) {
        // Blocks the thread, as a synchronous sink on a stalled disk would.
      }
    });
    const store = new S3EvidencePayloadStore({
      ...configWith(s3.fetch, { requestTimeoutMs: 200 }),
      warn,
    });

    const started = performance.now();
    const outcome = await store.putImmutable(inputOf("a"));
    const took = performance.now() - started;

    expect(outcome).toEqual({ status: "conflict" });
    expect(took).toBeLessThan(200);
    expect(warn).not.toHaveBeenCalled();
    await logged();
    expect(warn.mock.calls).toEqual([["evidence payload conflict", idsOfA]]);
  });

  it.each<[string, () => unknown]>([
    ["throws", () => {
      throw new Error("logger down");
    }],
    ["hangs", () => new Promise(() => undefined)],
    ["rejects", () => Promise.reject(new Error("logger down"))],
  ])("a logger that %s leaves the outcome as it is and raises nothing", async (_, behave) => {
    const escaped: unknown[] = [];
    const keep = (error: unknown) => void escaped.push(error);
    process.on("uncaughtException", keep);
    process.on("unhandledRejection", keep);
    try {
      const s3 = otherBytesAfter(412)();
      const warn = vi.fn(behave);
      const store = new S3EvidencePayloadStore({ ...configWith(s3.fetch), warn });

      await expect(store.putImmutable(inputOf("a"))).resolves.toEqual({ status: "conflict" });
      await logged();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(warn.mock.calls).toEqual([["evidence payload conflict", idsOfA]]);
      expect(escaped).toEqual([]);
    } finally {
      process.off("uncaughtException", keep);
      process.off("unhandledRejection", keep);
    }
  });
});

describe("the input is read once (QA qa233f)", () => {
  const otherAt = (status: number) => {
    const s3 = fakeS3((call) =>
      call.method === "PUT" ? Promise.resolve(new Response(null, { status })) : null,
    );
    s3.objects.set(keyOf(PACKAGE, hashOf(payload("a"))), new TextEncoder().encode(payload("b")));
    return s3;
  };
  const idsOf = (text: string) => ({
    institutionId: INSTITUTION,
    evidencePackageId: PACKAGE,
    segmentHash: hashOf(payload(text)),
  });

  it.each([412, 409])("does not rebind the input hash after PUT %i", async (status) => {
    const s3 = otherAt(status);
    const { store, warn } = storeWith(s3.fetch);
    const input = {
      institutionId: INSTITUTION,
      evidencePackageId: PACKAGE,
      segmentHash: hashOf(payload("a")),
      canonicalPayload: payload("a"),
    };

    const pending = store.putImmutable(input);
    input.segmentHash = hashOf(payload("b"));

    expect(await pending).toEqual({ status: "conflict" });
    await logged();
    expect(warn.mock.calls).toEqual([["evidence payload conflict", idsOf("a")]]);
  });

  it("checks, keys and stores under one reading of a field that changes", async () => {
    const s3 = fakeS3();
    const { store } = storeWith(s3.fetch);
    let reads = 0;
    const input = {
      institutionId: INSTITUTION,
      evidencePackageId: PACKAGE,
      canonicalPayload: payload("a"),
      get segmentHash() {
        reads += 1;
        return hashOf(payload(reads === 1 ? "a" : "b"));
      },
    };

    const outcome = await put(store, "a").then(() => store.putImmutable(input));

    expect(reads).toBe(1);
    expect(outcome).toEqual({ status: "existing", storageRef: expect.any(String) });
    expect(s3.calls.map((call) => call.path)).toEqual(
      Array(s3.calls.length).fill(keyOf(PACKAGE, hashOf(payload("a")))),
    );
    expect([...s3.objects.keys()]).toEqual([keyOf(PACKAGE, hashOf(payload("a")))]);
  });

  it("logs the identifiers it checked, not ones changed during the call", async () => {
    const s3 = fakeS3((call) =>
      call.method === "PUT" ? Promise.resolve(new Response(null, { status: 200 })) : null,
    );
    const { store, warn } = storeWith(s3.fetch);
    const input = {
      institutionId: INSTITUTION,
      evidencePackageId: PACKAGE,
      segmentHash: hashOf(payload("a")),
      canonicalPayload: payload("a"),
    };

    const pending = store.putImmutable(input);
    input.evidencePackageId = "paket-izmisljeni-2";
    input.segmentHash = hashOf(payload("b"));

    expect(await pending).toEqual({ status: "unavailable", reason: "storage_write_unverified" });
    await logged();
    expect(warn.mock.calls).toEqual([["evidence payload write unverified", idsOf("a")]]);
  });

  it("logs the identifiers it checked when the deadline ends the read-back", async () => {
    // The PUT must not race a real 20 ms deadline (#651); the timer ends the read-back.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const s3 = fakeS3((call, signal) => (call.method === "GET" ? hang(signal) : null));
      const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 20_000 });
      const input = {
        institutionId: INSTITUTION,
        evidencePackageId: PACKAGE,
        segmentHash: hashOf(payload("a")),
        canonicalPayload: payload("a"),
      };

      const pending = store.putImmutable(input);
      input.evidencePackageId = "paket-izmisljeni-2";
      input.segmentHash = hashOf(payload("b"));

      await vi.advanceTimersByTimeAsync(20_000);
      expect(await pending).toEqual({ status: "unavailable", reason: "storage_write_unverified" });
      await logged();
      expect(warn.mock.calls).toEqual([["evidence payload write unverified", idsOf("a")]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("spends the call's deadline on a slow getter and sends nothing after it", async () => {
    const s3 = fakeS3();
    const clock = { now: 100 };
    const spy = vi.spyOn(performance, "now").mockImplementation(() => clock.now);
    const { store } = storeWith(s3.fetch, { requestTimeoutMs: 60_000 });
    const input = {
      institutionId: INSTITUTION,
      evidencePackageId: PACKAGE,
      segmentHash: hashOf(payload("a")),
      get canonicalPayload() {
        clock.now += 60_001;
        return payload("a");
      },
    };

    try {
      expect(await store.putImmutable(input)).toEqual({
        status: "unavailable",
        reason: "storage_timeout",
      });
    } finally {
      spy.mockRestore();
    }
    expect(s3.calls).toEqual([]);
  });

  it("gives the timer only what a slow getter left of the deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const clock = { now: 100 };
    const spy = vi.spyOn(performance, "now").mockImplementation(() => clock.now);
    try {
      const s3 = fakeS3(() => new Promise<Response>(() => undefined));
      const { store } = storeWith(s3.fetch, { requestTimeoutMs: 100 });
      const input = {
        institutionId: INSTITUTION,
        evidencePackageId: PACKAGE,
        segmentHash: hashOf(payload("a")),
        get canonicalPayload() {
          clock.now += 70;
          return payload("a");
        },
      };
      let result: unknown;
      void store.putImmutable(input).then((r) => (result = r));

      await vi.advanceTimersByTimeAsync(29);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await logged();
      expect(result).toEqual({ status: "unavailable", reason: "storage_timeout" });
      expect(s3.fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("S3EvidencePayloadStore.verifyIdentity (P3)", () => {
  const LABEL_PATH = `/ductus-evidence/${STORAGE_IDENTITY_KEY}`;
  const label = (value: unknown) =>
    new TextEncoder().encode(
      typeof value === "string" ? value : JSON.stringify(value),
    );
  // S3 answers a missing key with a `NoSuchKey` document.
  const withLabel = (bytes: Uint8Array | null) => {
    const s3 = fakeS3((call) =>
      call.path === LABEL_PATH && !s3.objects.has(LABEL_PATH)
        ? s3Error(404, "NoSuchKey")
        : null,
    );
    if (bytes !== null) s3.objects.set(LABEL_PATH, bytes);
    return s3;
  };
  const verify = (s3: ReturnType<typeof fakeS3>) =>
    storeWith(s3.fetch).store.verifyIdentity({ institutionId: INSTITUTION });

  it("verifies a label of this institution and region with one GET and no write", async () => {
    const s3 = withLabel(label({ institutionId: INSTITUTION, region: "eu-central-1" }));

    await expect(verify(s3)).resolves.toEqual({ status: "verified" });
    expect(s3.calls.map((c) => [c.method, c.path])).toEqual([["GET", LABEL_PATH]]);
  });

  it.each<[string, Uint8Array | null]>([
    ["a missing label", null],
    ["another institution", label({ institutionId: OTHER_INSTITUTION, region: "eu-central-1" })],
    ["another region", label({ institutionId: INSTITUTION, region: "eu-west-1" })],
    ["an upper-case institution", label({ institutionId: INSTITUTION.toUpperCase(), region: "eu-central-1" })],
    ["an extra field", label({ institutionId: INSTITUTION, region: "eu-central-1", bucket: "x" })],
    ["a missing region", label({ institutionId: INSTITUTION })],
    ["a list", label([INSTITUTION, "eu-central-1"])],
    ["text that is not JSON", label("fak-a")],
    ["invalid UTF-8", new Uint8Array([0x7b, 0xff, 0x7d])],
    // Valid JSON with the right values, only padded past the limit.
    [
      "a label over 1 KiB",
      label(JSON.stringify({ institutionId: INSTITUTION, region: "eu-central-1" }) + " ".repeat(1_024)),
    ],
    // Larger than a segment too: still not a label, not an unreadable object.
    [
      "a label over 2 MiB",
      label(JSON.stringify({ institutionId: INSTITUTION, region: "eu-central-1" }) + " ".repeat(3 * 1_024 * 1_024)),
    ],
  ])("answers mismatch for %s", async (_, bytes) => {
    await expect(verify(withLabel(bytes))).resolves.toEqual({ status: "mismatch" });
  });

  it.each<[string, () => Promise<Response>, string]>([
    ["a server error", () => Promise.resolve(new Response(null, { status: 503 })), "storage_get_status_503"],
    ["access denied", () => s3Error(403, "AccessDenied"), "storage_get_status_403"],
    ["a wrong region", () => s3Error(400, "AuthorizationHeaderMalformed"), "storage_signature_rejected"],
    ["a network failure", () => Promise.reject(new TypeError("fetch failed")), "storage_request_failed"],
    ["a missing bucket", () => s3Error(404, "NoSuchBucket"), "storage_get_status_404"],
    [
      "a 404 that is not from S3",
      () => Promise.resolve(new Response("<html>Not Found</html>", { status: 404 })),
      "storage_get_status_404",
    ],
    ["a 404 with no body", () => Promise.resolve(new Response(null, { status: 404 })), "storage_get_status_404"],
  ])("answers unavailable, never mismatch, on %s (P7)", async (_, answer, reason) => {
    const s3 = fakeS3(() => answer());

    await expect(verify(s3)).resolves.toEqual({ status: "unavailable", reason });
  });

  it("bounds the read by the configured timeout", async () => {
    const s3 = fakeS3((_, signal) => hang(signal));
    const { store } = storeWith(s3.fetch, { requestTimeoutMs: 20 });

    await expect(
      store.verifyIdentity({ institutionId: INSTITUTION }),
    ).resolves.toEqual({ status: "unavailable", reason: "storage_timeout" });
  });

  const timeout = { status: "unavailable", reason: "storage_timeout" };

  it("answers a timeout when the fetch ignores the abort signal", async () => {
    const s3 = fakeS3(() => new Promise<Response>(() => undefined));
    const { store } = storeWith(s3.fetch, { requestTimeoutMs: 20 });

    await expect(store.verifyIdentity({ institutionId: INSTITUTION })).resolves.toEqual(timeout);
    expect(s3.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("a deadline that passes while signing the read sends no request", async () => {
    let now = performance.now();
    const s3 = withLabel(label({ institutionId: INSTITUTION, region: "eu-central-1" }));
    const { store } = storeWith(s3.fetch, { requestTimeoutMs: 60_000 });
    const signingTime = vi
      .spyOn(store as unknown as { now: () => Date }, "now")
      .mockImplementation(() => {
        now += 1_000_000;
        return new Date();
      });
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      await expect(store.verifyIdentity({ institutionId: INSTITUTION })).resolves.toEqual(timeout);
    } finally {
      clock.mockRestore();
      signingTime.mockRestore();
    }
    expect(s3.calls).toEqual([]);
  });

  it("a matching label that arrives after the deadline is a timeout, not verified", async () => {
    let now = performance.now();
    const bytes = label({ institutionId: INSTITUTION, region: "eu-central-1" });
    const s3 = fakeS3(() => {
      now += 1_000_000;
      return Promise.resolve(new Response(bytes.slice(), { status: 200 }));
    });
    const { store } = storeWith(s3.fetch, { requestTimeoutMs: 60_000 });
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      await expect(store.verifyIdentity({ institutionId: INSTITUTION })).resolves.toEqual(timeout);
    } finally {
      clock.mockRestore();
    }
    expect(s3.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("a missing label that arrives after the deadline is a timeout, not mismatch", async () => {
    let now = performance.now();
    const s3 = fakeS3(() => {
      now += 1_000_000;
      return s3Error(404, "NoSuchKey");
    });
    const { store } = storeWith(s3.fetch, { requestTimeoutMs: 60_000 });
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      await expect(store.verifyIdentity({ institutionId: INSTITUTION })).resolves.toEqual(timeout);
    } finally {
      clock.mockRestore();
    }
  });

  it("stops reading the label past 1 KiB, without waiting for the rest", async () => {
    const endless = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2_048).fill(0x20));
      },
    });
    const s3 = fakeS3(() => Promise.resolve(new Response(endless, { status: 200 })));
    // Reading on would wait for the rest and end in a timeout instead. The
    // deadline only has to be far beyond the real work (#651).
    const { store } = storeWith(s3.fetch, { requestTimeoutMs: 5_000 });

    await expect(store.verifyIdentity({ institutionId: INSTITUTION })).resolves.toEqual({
      status: "mismatch",
    });
  });

  it("a refused signature that arrives after the deadline is a timeout, with no log", async () => {
    let now = performance.now();
    const s3 = fakeS3(() => {
      now += 1_000_000;
      return s3Error(403, "SignatureDoesNotMatch");
    });
    const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 60_000 });
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      await expect(store.verifyIdentity({ institutionId: INSTITUTION })).resolves.toEqual(timeout);
    } finally {
      clock.mockRestore();
    }
    await logged();
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads the institution once and compares under that reading", async () => {
    const s3 = withLabel(label({ institutionId: INSTITUTION, region: "eu-central-1" }));
    let reads = 0;
    const expected = {
      get institutionId() {
        reads += 1;
        return reads === 1 ? INSTITUTION : OTHER_INSTITUTION;
      },
    };

    await expect(storeWith(s3.fetch).store.verifyIdentity(expected)).resolves.toEqual({
      status: "verified",
    });
    expect(reads).toBe(1);
  });

  it("gives the timer only what a slow getter left of the deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const clock = { now: 100 };
    const spy = vi.spyOn(performance, "now").mockImplementation(() => clock.now);
    try {
      const s3 = fakeS3(() => new Promise<Response>(() => undefined));
      const { store } = storeWith(s3.fetch, { requestTimeoutMs: 100 });
      const expected = {
        get institutionId() {
          clock.now += 70;
          return INSTITUTION;
        },
      };
      let result: unknown;
      void store.verifyIdentity(expected).then((r) => (result = r));

      await vi.advanceTimersByTimeAsync(29);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(result).toEqual(timeout);
      expect(s3.fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("readImmutable: the read side (B-8i, read for reconstruction and B-13)", () => {
  const A = payload("a");
  const HASH_A = hashOf(A);
  const ids = { institutionId: INSTITUTION, evidencePackageId: PACKAGE, segmentHash: HASH_A };
  const read = async (store: S3EvidencePayloadStore, input = ids) => {
    const outcome = await store.readImmutable(input);
    await logged();
    return outcome;
  };
  /** The fake answers a missing key as S3 does: 404 with `NoSuchKey`. */
  const withNoSuchKey = (hook?: (call: Call, signal: AbortSignal) => Promise<Response> | null) => {
    const s3: ReturnType<typeof fakeS3> = fakeS3((call, signal) => {
      const own = hook?.(call, signal);
      if (own) return own;
      return call.method === "GET" && !s3.objects.has(call.path) ? s3Error(404, "NoSuchKey") : null;
    });
    return s3;
  };
  const unavailable = (reason: string) => ({ status: "unavailable", reason });

  it("reads back the exact bytes putImmutable stored, with one signed GET under the same key", async () => {
    const s3 = withNoSuchKey();
    const { store, warn } = storeWith(s3.fetch);
    await put(store, "a");
    s3.calls.length = 0;

    const outcome = await read(store);
    expect(outcome).toEqual({ status: "found", bytes: new TextEncoder().encode(A) });
    expect(s3.calls.map((c) => [c.method, c.path])).toEqual([["GET", keyOf(PACKAGE, HASH_A)]]);
    expect(signedHeadersOf(s3.calls[0])).not.toMatch(/if-none-match|checksum/);
    expect(s3.fetch.mock.calls[0][1]?.redirect).toBe("error");
    expect(warn).not.toHaveBeenCalled();
  });

  it("answers not_found only on NoSuchKey, and never finds another institution's object (B2)", async () => {
    const s3 = withNoSuchKey();
    const { store } = storeWith(s3.fetch);
    await put(store, "a");
    s3.calls.length = 0;

    await expect(read(store, { ...ids, institutionId: OTHER_INSTITUTION })).resolves.toEqual({
      status: "not_found",
    });
    await expect(read(store, { ...ids, segmentHash: hashOf(payload("b")) })).resolves.toEqual({
      status: "not_found",
    });
    expect(s3.calls.map((c) => c.path)).toEqual([
      keyOf(PACKAGE, HASH_A, OTHER_INSTITUTION),
      keyOf(PACKAGE, hashOf(payload("b"))),
    ]);
  });

  it.each<[string, () => Promise<Response>]>([
    ["a 404 without a code", () => Promise.resolve(new Response(null, { status: 404 }))],
    ["a 404 for a missing bucket", () => s3Error(404, "NoSuchBucket")],
    ["a 404 whose body is not S3's", () => Promise.resolve(new Response("<html>not found</html>", { status: 404 }))],
  ])("treats %s as unavailable, never as a missing object", async (_, answer) => {
    const s3 = fakeS3(() => answer());
    await expect(read(storeWith(s3.fetch).store)).resolves.toEqual(unavailable("storage_get_status_404"));
  });

  it.each<[string, Uint8Array]>([
    ["other bytes", new TextEncoder().encode(payload("b"))],
    ["the stored bytes cut short", new TextEncoder().encode(A).slice(0, -1)],
    ["an empty body", new Uint8Array()],
  ])("never passes on %s under the key: unavailable and an incident with ids only", async (_, bytes) => {
    const s3 = withNoSuchKey();
    s3.objects.set(keyOf(PACKAGE, HASH_A), bytes);
    const { store, warn } = storeWith(s3.fetch);

    await expect(read(store)).resolves.toEqual(unavailable("storage_object_corrupt"));
    expect(warn.mock.calls).toEqual([["evidence payload corrupt", ids]]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("text");
  });

  it("treats an object larger than any segment as corrupt, reading no more than the limit", async () => {
    const s3 = fakeS3(() => Promise.resolve(new Response(new Uint8Array(MAX_EVIDENCE_SEGMENT_BYTES + 1), { status: 200 })));
    const { store, warn } = storeWith(s3.fetch);
    await expect(read(store)).resolves.toEqual(unavailable("storage_object_corrupt"));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each<[string, () => Promise<Response>, string]>([
    ["a server error", () => Promise.resolve(new Response(null, { status: 500 })), "storage_get_status_500"],
    ["a busy store", () => Promise.resolve(new Response(null, { status: 503 })), "storage_get_status_503"],
    ["a refused signature", () => s3Error(403, "SignatureDoesNotMatch"), "storage_signature_rejected"],
    ["a skewed clock", () => s3Error(403, "RequestTimeTooSkewed"), "storage_clock_skew"],
    ["an encoded body", () => Promise.resolve(new Response(A, { status: 200, headers: { "content-encoding": "gzip" } })), "storage_get_encoded"],
    ["a failed request", () => Promise.reject(new TypeError("fetch failed")), "storage_request_failed"],
  ])("answers %s as unavailable after one request, with no retry", async (_, answer, reason) => {
    const s3 = fakeS3(() => answer());
    await expect(read(storeWith(s3.fetch).store)).resolves.toEqual(unavailable(reason));
    expect(s3.calls).toHaveLength(1);
  });

  it("ends a read that never answers at the deadline, and a retry then finds the object", async () => {
    // The timer ends the hanging read; the retry must not race a real 20 ms
    // deadline (#651).
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let hanging = true;
      const s3: ReturnType<typeof fakeS3> = fakeS3((_, signal) => (hanging ? hang(signal) : null));
      s3.objects.set(keyOf(PACKAGE, HASH_A), new TextEncoder().encode(A));
      const { store } = storeWith(s3.fetch, { requestTimeoutMs: 20_000 });

      const pending = read(store);
      await vi.advanceTimersByTimeAsync(20_000);
      await expect(pending).resolves.toEqual(unavailable("storage_timeout"));
      expect(s3.fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
      hanging = false;
      await expect(read(store)).resolves.toMatchObject({ status: "found" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers storage_timeout when fetch ignores the abort signal", async () => {
    const s3 = fakeS3(() => new Promise<Response>(() => {}));
    const { store } = storeWith(s3.fetch, { requestTimeoutMs: 20 });
    await expect(read(store)).resolves.toEqual(unavailable("storage_timeout"));
  });

  it("does not count intact bytes that arrive past the deadline as found", async () => {
    const block = (ms: number) => {
      const end = performance.now() + ms;
      while (performance.now() < end) {
        // busy on purpose
      }
    };
    const s3: ReturnType<typeof fakeS3> = fakeS3(() => (block(60), null));
    s3.objects.set(keyOf(PACKAGE, HASH_A), new TextEncoder().encode(A));
    const { store, warn } = storeWith(s3.fetch, { requestTimeoutMs: 20 });

    await expect(read(store)).resolves.toEqual(unavailable("storage_timeout"));
    expect(warn).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<typeof ids>]>([
    ["an institution id in capitals", { institutionId: INSTITUTION.toUpperCase() }],
    ["an institution id that is not a UUID", { institutionId: "fak-a" }],
    ["a package id with a slash", { evidencePackageId: "paket/../drugi" }],
    ["a hash in capitals", { segmentHash: HASH_A.toUpperCase() }],
    ["a hash that is too short", { segmentHash: HASH_A.slice(1) }],
  ])("answers %s as unavailable before any request", async (_, change) => {
    const s3 = fakeS3();
    await expect(read(storeWith(s3.fetch).store, { ...ids, ...change })).resolves.toEqual(
      unavailable("storage_request_invalid"),
    );
    expect(s3.calls).toHaveLength(0);
  });

  it("reads each input field once, so a getter cannot move the read to another key", async () => {
    const s3 = withNoSuchKey();
    const { store } = storeWith(s3.fetch);
    await put(store, "a");
    s3.calls.length = 0;
    let reads = 0;
    const shifting = {
      get institutionId() {
        reads += 1;
        return reads === 1 ? INSTITUTION : OTHER_INSTITUTION;
      },
      evidencePackageId: PACKAGE,
      segmentHash: HASH_A,
    };

    await expect(read(store, shifting)).resolves.toMatchObject({ status: "found" });
    expect(reads).toBe(1);
    expect(s3.calls.map((c) => c.path)).toEqual([keyOf(PACKAGE, HASH_A)]);
  });
});
