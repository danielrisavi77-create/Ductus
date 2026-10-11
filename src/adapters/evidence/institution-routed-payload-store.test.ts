import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { EvidenceStorageConfigError } from "./evidence-storage-config";
import {
  InstitutionRoutedPayloadStore,
  type DomainPayloadStore,
} from "./institution-routed-payload-store";
import { STORAGE_IDENTITY_KEY } from "./s3-evidence-payload-store";

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
  };
  return store;
}

const verified = () => Promise.resolve<Identity>({ status: "verified" });

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
    const { router } = routerWith({ [FAK_A]: a });

    await expect(router.putImmutable(input(FAK_C))).resolves.toEqual({
      status: "unavailable",
      reason: "storage_domain_not_configured",
    });
    expect(a.verifyIdentity).not.toHaveBeenCalled();
    expect(a.putImmutable).not.toHaveBeenCalled();
  });

  it("answers unavailable with no domains at all (P2)", async () => {
    const { router } = routerWith({});

    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual({
      status: "unavailable",
      reason: "storage_domain_not_configured",
    });
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
    const mismatch = {
      status: "unavailable",
      reason: "storage_domain_identity_mismatch",
    };

    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual(mismatch);
    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual(mismatch);

    expect(a.verifyIdentity).toHaveBeenCalledTimes(1);
    expect(a.putImmutable).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "evidence storage identity label does not match",
      { storageDomain: "fak-0", institutionId: FAK_A },
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
    const { router } = routerWith({ [FAK_A]: a });

    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual({
      status: "unavailable",
      reason: "storage_get_status_503",
    });
    expect(a.putImmutable).not.toHaveBeenCalled();
    await expect(router.putImmutable(input(FAK_A))).resolves.toMatchObject({
      status: "stored",
    });
    expect(a.verifyIdentity).toHaveBeenCalledTimes(2);
  });

  it("answers a read that throws as unavailable", async () => {
    const a = fakeDomain(() => Promise.reject(new Error("boom")));
    const { router } = routerWith({ [FAK_A]: a });

    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual({
      status: "unavailable",
      reason: "storage_request_failed",
    });
    expect(a.putImmutable).not.toHaveBeenCalled();
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

    const unavailable = { status: "unavailable", reason: "storage_timeout" };
    await expect(first).resolves.toEqual(unavailable);
    await expect(second).resolves.toEqual(unavailable);
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
    objects.set(path, (init!.body as Uint8Array).slice());
    return new Response(null, { status: 200 });
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
) => ({
  label,
  institutionId,
  endpoint: "https://s3.example.eu",
  region: "eu-central-1",
  bucket,
  credentials: { accessKeyId: `id-${label}`, secretAccessKey: `secret-${label}` },
  ...overrides,
});

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

    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual({
      status: "unavailable",
      reason: "storage_signature_rejected",
    });
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

    await expect(router.putImmutable(input(FAK_A))).resolves.toEqual({
      status: "unavailable",
      reason: "storage_domain_identity_mismatch",
    });
    expect(s3.calls.map((c) => c.method)).toEqual(["GET"]);
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
