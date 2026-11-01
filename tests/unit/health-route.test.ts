import { describe, expect, it } from "vitest";

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
});
