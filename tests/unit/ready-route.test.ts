import { afterEach, describe, expect, it, vi } from "vitest";

import { DevelopmentSigningKeyError } from "@/adapters/crypto/persistent-development-ed25519-signer";

const withActor = vi.fn();
vi.mock("@/server/db", () => ({ withActor: (...args: unknown[]) => withActor(...args) }));

const deps = vi.fn();
vi.mock("@/server/evidence/ingest-deps", () => ({ evidenceIngestDeps: () => deps() }));

import { STORAGE_NOT_CONFIGURED } from "@/server/evidence/payload-reader";

import { GET, dynamic, runtime } from "../../app/api/ready/route";

const refusing = (code: "signing_key_production" | "signing_key_missing") => {
  const refuse = () => Promise.reject(new DevelopmentSigningKeyError(code));
  return { sign: refuse, verify: refuse, publicVerificationKey: refuse };
};

const databaseAnswers = () =>
  withActor.mockImplementation(async (_token, fn) => fn({ query: async () => ({ rows: [{}], rowCount: 1 }) }));

afterEach(() => {
  withActor.mockReset();
  deps.mockReset();
  vi.restoreAllMocks();
});

// DAN-299: /api/ready does not return 200 without an available database.
// DAN-585: the body names each capability with a closed state.
describe("GET /api/ready", () => {
  it("answers 200 and never caches when the database answers and nothing else is configured", async () => {
    databaseAnswers();
    deps.mockReturnValue({ signer: refusing("signing_key_production"), payloads: STORAGE_NOT_CONFIGURED });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ready",
      capabilities: { database: "ready", storage: "not_configured", signing: "not_configured", worker_queue: "not_configured" },
    });
    expect(withActor.mock.calls[0][0]).toBeNull();
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
  });

  it("answers 503 with a fixed body and logs only a code when the database fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    withActor.mockRejectedValue(Object.assign(new Error("postgres://user:pw@host/db"), { code: "ECONNREFUSED" }));
    deps.mockReturnValue({ signer: refusing("signing_key_production"), payloads: STORAGE_NOT_CONFIGURED });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "unavailable",
      capabilities: { database: "unavailable", storage: "not_configured", signing: "not_configured", worker_queue: "not_configured" },
    });
    expect(log.mock.calls).toEqual([["not ready", "database", "ECONNREFUSED"]]);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/postgres|pw|host/);
  });

  it("answers 503 when a configured capability fails, naming only the capability", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    databaseAnswers();
    const payloads = { ...STORAGE_NOT_CONFIGURED, verifyAll: async () => ({ "fak-a": "disabled" }) };
    deps.mockReturnValue({ signer: refusing("signing_key_missing"), payloads });
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.capabilities).toEqual({ database: "ready", storage: "unavailable", signing: "unavailable", worker_queue: "not_configured" });
    expect(JSON.stringify(body)).not.toMatch(/fak-a|disabled|signing_key/);
    expect(log.mock.calls).toEqual([
      ["not ready", "storage", "storage_domain_disabled"],
      ["not ready", "signing", "signing_key_missing"],
    ]);
  });

  it("answers 503, not a failed route, when building the dependencies throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    databaseAnswers();
    deps.mockImplementation(() => {
      throw new Error("EVIDENCE_STORAGE_DOMAINS secret");
    });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toMatch(/secret|EVIDENCE/);
  });
});
