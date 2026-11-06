import { describe, expect, it, vi } from "vitest";

const withActor = vi.fn();
vi.mock("@/server/db", () => ({ withActor: (...args: unknown[]) => withActor(...args) }));

import { GET, dynamic, runtime } from "../../app/api/health/route";

// DAN-299: liveness says only that the process answers.
describe("GET /api/health", () => {
  it("answers 200 with a fixed body that is never cached", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
  });

  it("is the same with no environment at all: it reads nothing", async () => {
    const saved = process.env;
    process.env = {} as NodeJS.ProcessEnv;
    try {
      expect(await GET().json()).toEqual({ status: "ok" });
    } finally {
      process.env = saved;
    }
  });

  // DAN-585: health stays free of external calls; dependencies are ready's job.
  it("calls neither the database nor the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      expect(await GET().json()).toEqual({ status: "ok" });
      expect(withActor).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
