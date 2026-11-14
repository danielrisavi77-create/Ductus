import { afterEach, describe, expect, it, vi } from "vitest";

// DAN-184, orchestrator note 1 (#1836, c.6821821693): the alarm channel sees
// each readiness report and never changes its answer, status or timing.
// tests/unit/ready-route.test.ts stays as it is and runs the real channel.
const withActor = vi.fn();
vi.mock("@/server/db", () => ({ withActor: (...args: unknown[]) => withActor(...args) }));

const { NOT_CONFIGURED, deps } = vi.hoisted(() => ({
  NOT_CONFIGURED: Object.freeze({ marker: "storage-not-configured" }),
  deps: vi.fn(),
}));
vi.mock("@/server/evidence/payload-reader", () => ({ STORAGE_NOT_CONFIGURED: NOT_CONFIGURED }));
vi.mock("@/server/evidence/ingest-deps", () => ({ evidenceIngestDeps: () => deps() }));

const shutdownState = vi.hoisted(() => ({ value: "running" as "running" | "draining" | "stopped" }));
vi.mock("@/server/shutdown", () => ({ processShutdown: () => ({ state: () => shutdownState.value }) }));

const observe = vi.hoisted(() => vi.fn<(capabilities: unknown) => Promise<void>>(() => Promise.resolve()));
vi.mock("@/server/alarms/readiness-store", () => ({ readinessAlarms: { observe } }));

import { GET } from "../../app/api/ready/route";

const SECRET = "postgres://user:pw@db.internal.example/ductus";
type Query = (sql: string) => Promise<{ rows: unknown[] }>;
const answers = (queue: string): Query => async (sql) => ({ rows: sql.includes("pg_stat_activity") ? [{ queue }] : [{}] });

async function answer() {
  const response = await GET();
  return { status: response.status, cache: response.headers.get("Cache-Control"), body: await response.json() };
}

afterEach(() => {
  shutdownState.value = "running";
  withActor.mockReset();
  deps.mockReset();
  observe.mockReset();
  observe.mockImplementation(() => Promise.resolve());
  vi.restoreAllMocks();
});

describe("GET /api/ready and the alarm channel", () => {
  it.each([
    ["hangs", () => new Promise<void>(() => {})],
    ["rejects", () => Promise.reject(new Error(SECRET))],
    [
      "throws",
      () => {
        throw new Error(SECRET);
      },
    ],
  ])("answers the same when the channel %s", async (_name, channel) => {
    deps.mockReturnValue({ signer: { publicVerificationKey: () => Promise.reject(new Error("x")) }, payloads: NOT_CONFIGURED });
    withActor.mockImplementation(async (_token, fn) => fn({ query: answers("ok") }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const baseline = await answer();
    observe.mockImplementation(channel as () => Promise<void>);
    const before = withActor.mock.calls.length;
    const got = await answer();
    expect(got).toEqual(baseline);
    expect(observe).toHaveBeenCalledWith(got.body.capabilities);
    // The channel borrows nothing of the answer's own: the same probes ran.
    expect(withActor.mock.calls.length - before).toBe(before);
    expect(JSON.stringify(got)).not.toMatch(/postgres|pw|internal|example/);
  });

  it("hands over only the closed capability words, never the log codes", async () => {
    deps.mockReturnValue({ signer: { publicVerificationKey: () => Promise.reject(new Error("x")) }, payloads: {} });
    withActor.mockImplementation(async (_token, fn) => fn({ query: answers("ok") }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await GET();
    expect(observe).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(observe.mock.calls)).not.toMatch(/STORAGE|codes/);
  });

  it("raises no alarm while draining", async () => {
    shutdownState.value = "draining";
    await GET();
    expect(observe).not.toHaveBeenCalled();
  });
});
