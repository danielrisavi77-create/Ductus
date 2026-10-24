import { createHash } from "node:crypto";
import { inspect } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { bindPayloadReader } from "@/application/ports/evidence-reconstruction";

import { EvidenceStorageConfigError } from "./evidence-storage-config";
import {
  InstitutionRoutedPayloadStore,
  STORAGE_UNAVAILABLE,
  type DomainPayloadStore,
} from "./institution-routed-payload-store";
import { STORAGE_IDENTITY_KEY } from "./s3-evidence-payload-store";
import { S3SecretCredentials } from "./s3-signature";

// Invented institutions and credentials; nothing here is real.
const FAK_A = "00000000-0000-4000-8000-00000000000a";
const FAK_B = "00000000-0000-4000-8000-00000000000b";
const FAK_C = "00000000-0000-4000-8000-00000000000c";
const PACKAGE = "paket-izmisljeni-1";
const PAYLOAD = JSON.stringify({ text: "izmisljeni odlomak" });
const HASH = createHash("sha256").update(PAYLOAD).digest("hex");

const input = (institutionId: string) => ({
  institutionId,
  evidencePackageId: PACKAGE,
  segmentHash: HASH,
  canonicalPayload: PAYLOAD,
});

type Identity = Awaited<ReturnType<DomainPayloadStore["verifyIdentity"]>>;

function fakeDomain(identity: () => Promise<Identity>) {
  const store = {
    verifyIdentity: vi.fn(identity),
    putImmutable: vi.fn(async () => ({
      status: "stored" as const,
      storageRef: "fake:ref",
    })),
    readImmutable: vi.fn<DomainPayloadStore["readImmutable"]>(async () => ({
      status: "found",
      bytes: new TextEncoder().encode(PAYLOAD),
    })),
  };
  return store;
}

const verified = () => Promise.resolve<Identity>({ status: "verified" });

/** The only unavailable answer that leaves the router. */
const UNAVAILABLE = { status: "unavailable", reason: STORAGE_UNAVAILABLE };

/** The router logs in a later macrotask; this lets it run. */
const logged = () => new Promise((resolve) => setImmediate(resolve));

function routerWith(domains: Record<string, ReturnType<typeof fakeDomain>>) {
  const warn = vi.fn();
  const router = new InstitutionRoutedPayloadStore(
    Object.entries(domains).map(([institutionId, store], i) => ({
      label: `fak-${i}`,
      institutionId,
      store,
    })),
    warn,
  );
  return { router, warn };
}

describe("InstitutionRoutedPayloadStore", () => {
  it("writes through the domain of the package's institution", async () => {
    const a = fakeDomain(verified);
    const b = fakeDomain(verified);
    const { router } = routerWith({ [FAK_A]: a, [FAK_B]: b });

    await expect(router.putImmutable(input(FAK_B))).resolves.toEqual({
      status: "stored",
      storageRef: "fake:ref",
    });
    expect(b.verifyIdentity).toHaveBeenCalledWith({ institutionId: FAK_B });
    expect(b.putImmutable).toHaveBeenCalledWith(input(FAK_B));
    expect(a.verifyIdentity).not.toHaveBeenCalled();
    expect(a.putImmutable).not.toHaveBeenCalled();
  });

  it("answers unavailable for an institution without a domain, never another bucket (P2)", async () => {
    const a = fakeDomain(verified);
    const { router, warn } = routerWith({ [FAK_A]: a });

    await expect(router.putImmutable(input(FAK_C))).resolves.toEqual(UNAVAILABLE);
    expect(a.verifyIdentity).not.toHaveBeenCalled();
    expect(a.putImmutable).not.toHaveBeenCalled();
    await logged();
    expect(warn).toHaveBeenCalledWith("evidence storage domain is not configured", {
      institutionId: FAK_C,
      reason: "storage_domain_not_configured",
    });
  });

  it("answers unavailable with no domains at all (P2)", async () => {
    const { router } = routerWith({});

    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual(UNAVAILABLE);
  });

  it.each(["", "not-a-uuid", FAK_A.toUpperCase()])(
    "refuses institution id %j as invalid",
    async (institutionId) => {
      const a = fakeDomain(verified);
      const { router } = routerWith({ [FAK_A]: a });

      await expect(router.putImmutable(input(institutionId))).resolves.toEqual({
        status: "invalid",
      });
      expect(a.verifyIdentity).not.toHaveBeenCalled();
    },
  );

  it("names a stored object by its own domain's label and key, with no request to any store", async () => {
    const a = fakeDomain(verified);
    const b = fakeDomain(verified);
    // A fresh router: no label is verified yet, as just after a restart, and
    // the reference still comes from the configured label alone (review468a 2).
    const { router } = routerWith({ [FAK_A]: a, [FAK_B]: b });
    const key = { institutionId: FAK_B, evidencePackageId: PACKAGE, segmentHash: HASH };

    await expect(router.storageRefFor(key)).resolves.toEqual({
      status: "ok",
      storageRef: `fak-1:v2/${FAK_B}/${PACKAGE}/${HASH}.json`,
    });
    for (const store of [a, b]) {
      expect(store.verifyIdentity).not.toHaveBeenCalled();
      expect(store.putImmutable).not.toHaveBeenCalled();
      expect(store.readImmutable).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["an institution without a domain (P2)", FAK_C, "verified"],
    ["a domain disabled by its label (P3)", FAK_A, "mismatch"],
    ["an institution id of another form", FAK_A.toUpperCase(), "verified"],
  ] as const)("gives no reference for %s", async (_, institutionId, identity) => {
    const a = fakeDomain(() => Promise.resolve({ status: identity }));
    const { router } = routerWith({ [FAK_A]: a });
    // A mismatched label disables the domain on its first use.
    if (identity === "mismatch") await router.putImmutable(input(FAK_A));
    const key = { institutionId, evidencePackageId: PACKAGE, segmentHash: HASH };

    await expect(router.storageRefFor(key)).resolves.toEqual(UNAVAILABLE);
  });

  it("reads the identity label once and then only writes", async () => {
    const a = fakeDomain(verified);
    const { router } = routerWith({ [FAK_A]: a });

    await router.putImmutable(input(FAK_A));
    await router.putImmutable(input(FAK_A));

    expect(a.verifyIdentity).toHaveBeenCalledTimes(1);
    expect(a.putImmutable).toHaveBeenCalledTimes(2);
  });

  it("disables a domain whose label does not match, with no write (P3)", async () => {
    const a = fakeDomain(() => Promise.resolve({ status: "mismatch" }));
    const { router, warn } = routerWith({ [FAK_A]: a });

    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual(UNAVAILABLE);
    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual(UNAVAILABLE);

    expect(a.verifyIdentity).toHaveBeenCalledTimes(1);
    expect(a.putImmutable).not.toHaveBeenCalled();
    await logged();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "evidence storage identity label does not match",
      {
        storageDomain: "fak-0",
        institutionId: FAK_A,
        reason: "storage_domain_identity_mismatch",
      },
    );
  });

  it("keeps the other domains working when one is disabled (P3)", async () => {
    const a = fakeDomain(() => Promise.resolve({ status: "mismatch" }));
    const b = fakeDomain(verified);
    const { router } = routerWith({ [FAK_A]: a, [FAK_B]: b });

    await router.putImmutable(input(FAK_A));
    await expect(router.putImmutable(input(FAK_B))).resolves.toMatchObject({
      status: "stored",
    });
  });

  it("tries the read again after it was unavailable", async () => {
    const a = fakeDomain(verified);
    a.verifyIdentity.mockResolvedValueOnce({
      status: "unavailable",
      reason: "storage_get_status_503",
    });
    const { router, warn } = routerWith({ [FAK_A]: a });

    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual(UNAVAILABLE);
    expect(a.putImmutable).not.toHaveBeenCalled();
    await logged();
    expect(warn).toHaveBeenCalledWith(
      "evidence storage identity label could not be read",
      { storageDomain: "fak-0", reason: "storage_get_status_503" },
    );
    await expect(router.putImmutable(input(FAK_A))).resolves.toMatchObject({
      status: "stored",
    });
    expect(a.verifyIdentity).toHaveBeenCalledTimes(2);
  });

  it("answers a read that throws as unavailable", async () => {
    const a = fakeDomain(() => Promise.reject(new Error("boom")));
    const { router } = routerWith({ [FAK_A]: a });

    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual(UNAVAILABLE);
    expect(a.putImmutable).not.toHaveBeenCalled();
  });

  it.each([{}, { status: "unavailable" }, {
    status: "unavailable",
    get reason() {
      throw new Error("identity reason getter failed");
    },
  }, Object.defineProperty({}, "status", {
    get() {
      throw new Error("identity status getter failed");
    },
  })])("normalizes an invalid identity result to an unavailable reason", async (answer) => {
    const a = fakeDomain(async () => answer as never);
    const { router, warn } = routerWith({ [FAK_A]: a });

    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual(UNAVAILABLE);
    expect(a.putImmutable).not.toHaveBeenCalled();
    await logged();
    expect(warn).toHaveBeenCalledWith("evidence storage identity label could not be read", {
      storageDomain: "fak-0",
      reason: "storage_request_failed",
    });
  });

  it.each([
    "storage_get_encoded",
    "storage_get_status_503",
    "storage_signature_rejected",
    "storage_timeout",
  ])("answers a write that is unavailable with %s by the one public reason", async (reason) => {
    const a = fakeDomain(verified);
    a.putImmutable.mockResolvedValueOnce({ status: "unavailable", reason } as never);
    const { router, warn } = routerWith({ [FAK_A]: a });

    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual(UNAVAILABLE);
    await logged();
    expect(warn).toHaveBeenCalledWith("evidence storage domain is unavailable", {
      storageDomain: "fak-0",
      reason,
    });
  });

  it("answers a write that throws as unavailable", async () => {
    const a = fakeDomain(verified);
    a.putImmutable.mockRejectedValueOnce(new Error("boom"));
    const { router } = routerWith({ [FAK_A]: a });

    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual(UNAVAILABLE);
  });

  it("answers a store that resolves to no result as unavailable, with no write", async () => {
    const a = fakeDomain(() => Promise.resolve(undefined as never));
    const { router } = routerWith({ [FAK_A]: a });

    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual(UNAVAILABLE);
    expect(a.putImmutable).not.toHaveBeenCalled();

    const b = fakeDomain(verified);
    b.putImmutable.mockResolvedValueOnce(undefined as never);
    const { router: other } = routerWith({ [FAK_B]: b });
    await expect(other.putImmutable(input(FAK_B))).resolves.toEqual(UNAVAILABLE);
  });

  it.each([
    ["an empty object", {}],
    ["stored without a reference", { status: "stored" }],
    ["existing with an empty reference", { status: "existing", storageRef: "" }],
    ["an unknown status", { status: "saved", storageRef: "fake:ref" }],
    ["unavailable without a reason", { status: "unavailable" }],
  ])("answers a write that resolves to %s as unavailable, never as stored", async (_, answer) => {
    const a = fakeDomain(verified);
    a.putImmutable.mockResolvedValueOnce(answer as never);
    const { router, warn } = routerWith({ [FAK_A]: a });

    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual(UNAVAILABLE);
    await logged();
    expect(warn).toHaveBeenCalledWith("evidence storage domain is unavailable", {
      storageDomain: "fak-0",
      reason: "storage_request_failed",
    });
  });

  it("answers a write whose result getter throws as unavailable", async () => {
    const a = fakeDomain(verified);
    a.putImmutable.mockResolvedValueOnce({
      status: "stored",
      get storageRef() {
        throw new Error("storage result getter failed");
      },
    } as never);
    const { router, warn } = routerWith({ [FAK_A]: a });

    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual(UNAVAILABLE);
    await logged();
    expect(warn).toHaveBeenCalledWith("evidence storage domain is unavailable", {
      storageDomain: "fak-0",
      reason: "storage_request_failed",
    });
  });

  it.each(["institutionId", "evidencePackageId", "segmentHash", "canonicalPayload"] as const)(
    "answers an input whose %s getter throws as unavailable",
    async (field) => {
      const a = fakeDomain(verified);
      const given = input(FAK_A);
      Object.defineProperty(given, field, {
        get() {
          throw new Error("storage input getter failed");
        },
      });
      const { router, warn } = routerWith({ [FAK_A]: a });

      await expect(router.putImmutable(given)).resolves.toEqual(UNAVAILABLE);
      expect(a.verifyIdentity).not.toHaveBeenCalled();
      expect(a.putImmutable).not.toHaveBeenCalled();
      await logged();
      expect(warn).toHaveBeenCalledWith("evidence storage request could not be read", {
        reason: "storage_request_failed",
      });
    },
  );

  it("reads the input once, so a getter cannot move the write to another institution", async () => {
    const a = fakeDomain(verified);
    const b = fakeDomain(verified);
    const { router } = routerWith({ [FAK_A]: a, [FAK_B]: b });
    let reads = 0;
    const given = {
      ...input(FAK_A),
      get institutionId() {
        reads += 1;
        return reads === 1 ? FAK_A : FAK_B;
      },
    };

    await expect(router.putImmutable(given)).resolves.toMatchObject({ status: "stored" });
    expect(reads).toBe(1);
    expect(a.putImmutable).toHaveBeenCalledWith(input(FAK_A));
    expect(b.putImmutable).not.toHaveBeenCalled();
  });

  it("keeps the outcome when the logger throws or rejects", async () => {
    const throwing = new InstitutionRoutedPayloadStore([], () => {
      throw new Error("logger down");
    });
    await expect(throwing.putImmutable(input(FAK_A))).resolves.toEqual(UNAVAILABLE);
    const rejecting = new InstitutionRoutedPayloadStore(
      [],
      (() => Promise.reject(new Error("logger down"))) as never,
    );
    await expect(rejecting.putImmutable(input(FAK_A))).resolves.toEqual(UNAVAILABLE);
    await logged();
  });

  it("shares one identity read between concurrent writes", async () => {
    let answer!: (identity: Identity) => void;
    const a = fakeDomain(
      () => new Promise<Identity>((resolve) => (answer = resolve)),
    );
    const { router } = routerWith({ [FAK_A]: a });

    const first = router.putImmutable(input(FAK_A));
    const second = router.putImmutable(input(FAK_A));
    await Promise.resolve();
    answer({ status: "unavailable", reason: "storage_timeout" });

    await expect(first).resolves.toEqual(UNAVAILABLE);
    await expect(second).resolves.toEqual(UNAVAILABLE);
    expect(a.verifyIdentity).toHaveBeenCalledTimes(1);
  });

  it("reports the state of every domain from verifyAll", async () => {
    const { router } = routerWith({
      [FAK_A]: fakeDomain(verified),
      [FAK_B]: fakeDomain(() => Promise.resolve({ status: "mismatch" })),
      [FAK_C]: fakeDomain(() =>
        Promise.resolve({ status: "unavailable", reason: "storage_timeout" }),
      ),
    });

    await expect(router.verifyAll()).resolves.toEqual({
      "fak-0": "verified",
      "fak-1": "disabled",
      "fak-2": "unverified",
    });
  });

  it("refuses two domains for one institution", () => {
    expect(
      () =>
        new InstitutionRoutedPayloadStore([
          { label: "fak-a", institutionId: FAK_A, store: fakeDomain(verified) },
          { label: "fak-a-2", institutionId: FAK_A, store: fakeDomain(verified) },
        ]),
    ).toThrow(EvidenceStorageConfigError);
  });
});

/**
 * S3 stand-in with one map of objects per bucket. It answers a request
 * signed for another region than the bucket's the way S3 does.
 */
function fakeS3(regionOf: Record<string, string>) {
  const objects = new Map<string, Uint8Array>();
  const calls: { method: string; path: string }[] = [];
  const fetch = vi.fn(async (url: URL | string | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = new URL(String(url)).pathname;
    calls.push({ method, path });
    const bucket = path.split("/")[1]!;
    const scope = new Headers(init?.headers).get("authorization") ?? "";
    if (!scope.includes(`/${regionOf[bucket]}/s3/aws4_request`)) {
      return new Response(
        "<Error><Code>AuthorizationHeaderMalformed</Code></Error>",
        { status: 400 },
      );
    }
    if (method === "GET") {
      const found = objects.get(path);
      return found
        ? new Response(found.slice(), { status: 200 })
        : new Response(null, { status: 404 });
    }
    if (objects.has(path)) return new Response(null, { status: 412 });
    const body = (init!.body as Uint8Array).slice();
    objects.set(path, body);
    return new Response(null, {
      status: 200,
      headers: {
        "x-amz-checksum-sha256": createHash("sha256").update(body).digest("base64"),
      },
    });
  });
  const label = (bucket: string, institutionId: string) =>
    objects.set(
      `/${bucket}/${STORAGE_IDENTITY_KEY}`,
      new TextEncoder().encode(
        JSON.stringify({ institutionId, region: regionOf[bucket] }),
      ),
    );
  return { fetch, calls, label, objects };
}

const s3Domain = (
  label: string,
  institutionId: string,
  bucket: string,
  overrides: Record<string, string> = {},
) => {
  const domain = {
    label,
    institutionId,
    endpoint: "https://s3.example.eu",
    region: "eu-central-1",
    bucket,
    ...overrides,
  };
  return {
    ...domain,
    credentials: new S3SecretCredentials({
      accessKeyId: `id-${label}`,
      secretAccessKey: `secret-${label}`,
    }),
    capability: {
      provider: "fake-s3",
      endpoint: domain.endpoint,
      conditionalWrite: "verified" as const,
      checksumEcho: "verified" as const,
      verifiedOn: "2026-10-01",
      contractTest: "unit/fake-s3",
    },
  };
};

describe("InstitutionRoutedPayloadStore.fromConfig", () => {
  it("stores one hash in two institutions as two new objects (P5)", async () => {
    const s3 = fakeS3({ "ductus-fak-a": "eu-central-1", "ductus-fak-b": "eu-central-1" });
    s3.label("ductus-fak-a", FAK_A);
    s3.label("ductus-fak-b", FAK_B);
    const router = InstitutionRoutedPayloadStore.fromConfig(
      {
        requestTimeoutMs: 1_000,
        domains: [
          s3Domain("fak-a-eu-1", FAK_A, "ductus-fak-a"),
          s3Domain("fak-b-eu-1", FAK_B, "ductus-fak-b"),
        ],
      },
      { fetch: s3.fetch, warn: vi.fn() },
    );

    const a = await router.putImmutable(input(FAK_A));
    const b = await router.putImmutable(input(FAK_B));

    expect(a).toEqual({
      status: "stored",
      storageRef: `fak-a-eu-1:v2/${FAK_A}/${PACKAGE}/${HASH}.json`,
    });
    expect(b).toEqual({
      status: "stored",
      storageRef: `fak-b-eu-1:v2/${FAK_B}/${PACKAGE}/${HASH}.json`,
    });
    expect([...s3.objects.keys()].filter((k) => k.endsWith(`${HASH}.json`))).toEqual([
      `/ductus-fak-a/v2/${FAK_A}/${PACKAGE}/${HASH}.json`,
      `/ductus-fak-b/v2/${FAK_B}/${PACKAGE}/${HASH}.json`,
    ]);
  });

  it("answers a wrong region as unavailable, never conflict, and writes nothing (P7)", async () => {
    const s3 = fakeS3({ "ductus-fak-a": "eu-west-3" });
    const router = InstitutionRoutedPayloadStore.fromConfig(
      { requestTimeoutMs: 1_000, domains: [s3Domain("fak-a-eu-1", FAK_A, "ductus-fak-a")] },
      { fetch: s3.fetch, warn: vi.fn() },
    );

    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual(UNAVAILABLE);
    expect(s3.calls).toEqual([
      { method: "GET", path: `/ductus-fak-a/${STORAGE_IDENTITY_KEY}` },
    ]);
  });

  it("disables a bucket labelled for another institution (P3)", async () => {
    const s3 = fakeS3({ "ductus-fak-a": "eu-central-1" });
    s3.label("ductus-fak-a", FAK_B);
    const router = InstitutionRoutedPayloadStore.fromConfig(
      { requestTimeoutMs: 1_000, domains: [s3Domain("fak-a-eu-1", FAK_A, "ductus-fak-a")] },
      { fetch: s3.fetch, warn: vi.fn() },
    );

    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual(UNAVAILABLE);
    expect(s3.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("keeps the secret out of every view of the router", async () => {
    const s3 = fakeS3({ "ductus-fak-a": "eu-central-1" });
    s3.label("ductus-fak-a", FAK_A);
    const router = InstitutionRoutedPayloadStore.fromConfig(
      { requestTimeoutMs: 1_000, domains: [s3Domain("fak-a-eu-1", FAK_A, "ductus-fak-a")] },
      // Not the mock itself: it keeps every signed request, the router does not.
      { fetch: (url, init) => s3.fetch(url, init), warn: () => undefined },
    );
    await expect(router.putImmutable(input(FAK_A))).resolves.toMatchObject({
      status: "stored",
    });

    const deep = { depth: Infinity, showHidden: true, getters: true };
    const views = [
      JSON.stringify(router),
      String(router),
      inspect(router, deep),
      inspect(router, { ...deep, customInspect: false }),
      JSON.stringify(Object.entries(router)),
    ].join("\n");
    expect(views).not.toContain("secret-fak-a-eu-1");
    expect(views).not.toContain("id-fak-a-eu-1");
  });

  it("refuses a domain without a confirmed capability, naming only the domain", () => {
    const domain = s3Domain("fak-a-eu-1", FAK_A, "ductus-fak-a");
    expect(() =>
      InstitutionRoutedPayloadStore.fromConfig({
        requestTimeoutMs: 1_000,
        domains: [
          {
            ...domain,
            capability: { ...domain.capability, endpoint: "https://other.example.eu" },
          },
        ],
      }),
    ).toThrow(/^storage domain fak-a-eu-1: S3 storage capability/);
  });

  it("refuses a loopback http endpoint unless the caller allows it", () => {
    const domain = s3Domain("local-a", FAK_A, "ductus-fak-a", {
      endpoint: "http://127.0.0.1:9100",
    });
    const config = { requestTimeoutMs: 1_000, domains: [domain] };
    expect(() => InstitutionRoutedPayloadStore.fromConfig(config)).toThrow(
      EvidenceStorageConfigError,
    );
    expect(() =>
      InstitutionRoutedPayloadStore.fromConfig(config, {
        allowPlainHttpOnLoopback: true,
      }),
    ).not.toThrow();
  });

  it.each<[string, Record<string, string>]>([
    ["an endpoint with a path", { endpoint: "https://s3.example.eu/evidence" }],
    ["plain http off loopback", { endpoint: "http://s3.example.eu" }],
    ["an invalid bucket", { bucket: "Ductus_Fak_A" }],
    ["an invalid region", { region: "" }],
  ])("stops startup on %s, naming only the domain", (_, overrides) => {
    let error: unknown;
    try {
      InstitutionRoutedPayloadStore.fromConfig({
        requestTimeoutMs: 1_000,
        domains: [s3Domain("fak-a-eu-1", FAK_A, "ductus-fak-a", overrides)],
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EvidenceStorageConfigError);
    expect((error as Error).message).toMatch(/^storage domain fak-a-eu-1: /);
    expect((error as Error).message).not.toContain("secret-fak-a-eu-1");
  });
});

describe("InstitutionRoutedPayloadStore.readImmutable (B2)", () => {
  const BYTES = new TextEncoder().encode(PAYLOAD);
  const ids = (institutionId: string) => ({ institutionId, evidencePackageId: PACKAGE, segmentHash: HASH });
  const reasons = (warn: ReturnType<typeof vi.fn>) => warn.mock.calls.map(([, fields]) => fields.reason);

  it("reads from the institution's own domain only, after its label is verified", async () => {
    const a = fakeDomain(verified);
    const b = fakeDomain(verified);
    const { router } = routerWith({ [FAK_A]: a, [FAK_B]: b });

    await expect(router.readImmutable(ids(FAK_B))).resolves.toEqual({ status: "found", bytes: BYTES });
    expect(b.verifyIdentity).toHaveBeenCalledWith({ institutionId: FAK_B });
    expect(b.readImmutable).toHaveBeenCalledWith(ids(FAK_B));
    expect(a.verifyIdentity).not.toHaveBeenCalled();
    expect(a.readImmutable).not.toHaveBeenCalled();
  });

  it("binds one institution, so a reader for it never reaches another domain", async () => {
    const a = fakeDomain(verified);
    const b = fakeDomain(verified);
    a.readImmutable.mockResolvedValueOnce({ status: "not_found" });
    const { router } = routerWith({ [FAK_A]: a, [FAK_B]: b });
    const reader = bindPayloadReader(router, FAK_A);

    await expect(reader.readImmutable({ evidencePackageId: PACKAGE, segmentHash: HASH })).resolves.toEqual({
      status: "not_found",
    });
    expect(a.readImmutable).toHaveBeenCalledWith(ids(FAK_A));
    expect(b.verifyIdentity).not.toHaveBeenCalled();
    expect(b.readImmutable).not.toHaveBeenCalled();
  });

  it("answers an institution without a domain as unavailable, never not_found (P2)", async () => {
    const a = fakeDomain(verified);
    const { router, warn } = routerWith({ [FAK_A]: a });
    await expect(router.readImmutable(ids(FAK_C))).resolves.toEqual(UNAVAILABLE);
    await logged();
    expect(reasons(warn)).toEqual(["storage_domain_not_configured"]);
    expect(a.readImmutable).not.toHaveBeenCalled();
  });

  it("reads nothing from a domain whose label does not match, and retries one that could not be read (P3)", async () => {
    const wrong = fakeDomain(() => Promise.resolve<Identity>({ status: "mismatch" }));
    let identity: Identity = { status: "unavailable", reason: "storage_timeout" };
    const later = fakeDomain(() => Promise.resolve(identity));
    const { router } = routerWith({ [FAK_A]: wrong, [FAK_B]: later });

    await expect(router.readImmutable(ids(FAK_A))).resolves.toEqual(UNAVAILABLE);
    await expect(router.readImmutable(ids(FAK_A))).resolves.toEqual(UNAVAILABLE);
    expect(wrong.verifyIdentity).toHaveBeenCalledTimes(1);
    expect(wrong.readImmutable).not.toHaveBeenCalled();

    await expect(router.readImmutable(ids(FAK_B))).resolves.toEqual(UNAVAILABLE);
    expect(later.readImmutable).not.toHaveBeenCalled();
    identity = { status: "verified" };
    await expect(router.readImmutable(ids(FAK_B))).resolves.toMatchObject({ status: "found" });
  });

  it("answers an institution id that cannot be one as unavailable, asking no domain", async () => {
    const a = fakeDomain(verified);
    const { router, warn } = routerWith({ [FAK_A]: a });
    await expect(router.readImmutable(ids(FAK_A.toUpperCase()))).resolves.toEqual(UNAVAILABLE);
    await logged();
    expect(reasons(warn)).toEqual(["storage_request_invalid"]);
    expect(a.verifyIdentity).not.toHaveBeenCalled();
  });

  it("passes not_found on, and keeps a domain's own reason in the log only", async () => {
    const a = fakeDomain(verified);
    const { router, warn } = routerWith({ [FAK_A]: a });
    a.readImmutable.mockResolvedValueOnce({ status: "not_found" });
    await expect(router.readImmutable(ids(FAK_A))).resolves.toEqual({ status: "not_found" });

    a.readImmutable.mockResolvedValueOnce({ status: "unavailable", reason: "storage_get_status_503" });
    await expect(router.readImmutable(ids(FAK_A))).resolves.toEqual(UNAVAILABLE);
    await logged();
    expect(reasons(warn)).toEqual(["storage_get_status_503"]);
  });

  it.each<[string, unknown]>([
    ["other bytes", { status: "found", bytes: new TextEncoder().encode("{}") }],
    ["bytes that are not a byte array", { status: "found", bytes: PAYLOAD }],
    ["an unknown status", { status: "stored", storageRef: "x" }],
    ["a reason that is not text", { status: "unavailable", reason: 7 }],
    ["nothing", undefined],
  ])("never answers found for %s from a domain", async (_, answer) => {
    const a = fakeDomain(verified);
    a.readImmutable.mockResolvedValueOnce(answer as never);
    const { router } = routerWith({ [FAK_A]: a });
    await expect(router.readImmutable(ids(FAK_A))).resolves.toEqual(UNAVAILABLE);
  });

  it("answers a domain that throws, or whose answer throws when read, as unavailable", async () => {
    const a = fakeDomain(verified);
    const { router } = routerWith({ [FAK_A]: a });
    a.readImmutable.mockRejectedValueOnce(new Error("bucket fak-a secret-like detail"));
    await expect(router.readImmutable(ids(FAK_A))).resolves.toEqual(UNAVAILABLE);
    a.readImmutable.mockResolvedValueOnce({
      get status(): never {
        throw new Error("getter");
      },
    } as never);
    await expect(router.readImmutable(ids(FAK_A))).resolves.toEqual(UNAVAILABLE);
  });

  it("returns its own copy, so the domain cannot change the bytes afterwards", async () => {
    const a = fakeDomain(verified);
    const shared = new TextEncoder().encode(PAYLOAD);
    a.readImmutable.mockResolvedValueOnce({ status: "found", bytes: shared });
    const { router } = routerWith({ [FAK_A]: a });
    const outcome = await router.readImmutable(ids(FAK_A));
    shared.fill(0);
    expect(outcome).toEqual({ status: "found", bytes: BYTES });
  });
});
