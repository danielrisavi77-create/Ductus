import { afterEach, describe, expect, it, vi } from "vitest";

const withActor = vi.fn();
vi.mock("@/server/db", () => ({ withActor: (...args: unknown[]) => withActor(...args) }));

import { GET, dynamic, runtime } from "../../app/api/ready/route";

afterEach(() => {
  withActor.mockReset();
  vi.restoreAllMocks();
});

// DAN-299: /api/ready does not return 200 without an available database.
describe("GET /api/ready", () => {
  it("answers 200 and never caches when the database answers", async () => {
    withActor.mockImplementation(async (_token, fn) => fn({ query: async () => ({ rows: [{}], rowCount: 1 }) }));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ready" });
    expect(withActor.mock.calls[0][0]).toBeNull();
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
  });

  it("answers 503 with a fixed body and logs only a code when the database fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    withActor.mockRejectedValue(Object.assign(new Error("postgres://user:pw@host/db"), { code: "ECONNREFUSED" }));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/postgres|pw|host/);
  });
});
