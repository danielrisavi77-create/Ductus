import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";
import { withActor as appWithActor } from "@/server/db";
import { POST } from "../../../app/api/institution/courses/[courseId]/enrollment-code/route";
import { handleEnrollmentCodeRequest, MAX_ENROLLMENT_CODE_BODY_BYTES } from "./enrollment-code-route";

vi.mock("@/server/db", () => ({ withActor: vi.fn() }));
const ORIGIN = "https://ductus.example";
const COURSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "A".repeat(43);
const CODE = "0123-4567-89AB-CDEF";
const INPUT = { validUntil: "2026-11-02T10:00:00.123456+01:00" };
const URL = `${ORIGIN}/api/institution/courses/${COURSE}/enrollment-code`;
const request = (body: BodyInit = JSON.stringify(INPUT), headers: Record<string, string> = {}) =>
  new Request(URL, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...headers }, body });
function port() {
  const query = vi.fn().mockResolvedValue({ rows: [{ code: CODE }], rowCount: 1 });
  const withActor = vi.fn(async (_token: unknown, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as ActorTransaction)) as unknown as WithActor;
  const deps = { withActor, expectedOrigin: ORIGIN, sessionToken: TOKEN };
  return { query, withActor, deps, run: (req = request(), id: unknown = COURSE) => handleEnrollmentCodeRequest(req, id, deps) };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("teacher enrollment code HTTP boundary", () => {
  it("passes only the session and exact explicit timestamp, returning only an uncached code without logging", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    const { run, query, withActor } = port();
    const response = await run();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: CODE });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenCalledExactlyOnceWith(
      "SELECT institution.create_enrollment_code($1, $2::timestamptz) AS code", [COURSE, INPUT.validUntil],
    );
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("checks method, Origin, fetch site and trusted configuration before body or database", async () => {
    const cases: Record<string, string>[] = [
      { origin: "" }, { origin: "null" }, { origin: "https://evil.example" },
      { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "none" },
      { origin: "https://evil.example", host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
    ];
    for (const headers of cases) {
      const { run, withActor } = port();
      const req = request(undefined, headers);
      if (headers.origin === "") req.headers.delete("origin");
      expect((await run(req)).status).toBe(403);
      expect(req.bodyUsed).toBe(false);
      expect(withActor).not.toHaveBeenCalled();
    }
    const { run, deps, withActor } = port();
    expect((await run(new Request(URL, { method: "GET" }))).status).toBe(405);
    const req = request();
    expect((await handleEnrollmentCodeRequest(req, COURSE, { ...deps, expectedOrigin: "null" })).status).toBe(503);
    expect(req.bodyUsed).toBe(false);
    expect(withActor).not.toHaveBeenCalled();
  });

  it("rejects missing or malformed session and course identifiers without DB or body reads", async () => {
    const { deps, withActor } = port();
    for (const sessionToken of [undefined, "", "bad", "!".repeat(43)]) {
      const req = request();
      expect((await handleEnrollmentCodeRequest(req, COURSE, { ...deps, sessionToken })).status).toBe(401);
      expect(req.bodyUsed).toBe(false);
    }
    for (const id of [undefined, null, 1, "", "bad", `${COURSE}'`]) {
      expect((await handleEnrollmentCodeRequest(request(), id, deps)).status).toBe(422);
    }
    expect(withActor).not.toHaveBeenCalled();
  });

  it("bounds bytes before parsing, rejects JSON/UTF-8/content-length/stream failures", async () => {
    const { run, withActor } = port();
    for (const [req, status] of [
      [request("{}", { "content-type": "text/plain" }), 415],
      [request("{bad"), 400], [request(new Uint8Array([0xc3, 0x28])), 400],
      [request("é".repeat(MAX_ENROLLMENT_CODE_BODY_BYTES)), 413],
      [request("{}", { "content-length": "1025" }), 413],
      [request("{}", { "content-length": "bad" }), 400],
      [request("{}", { "content-length": "1" }), 400],
    ] as const) expect((await run(req)).status).toBe(status);
    const broken = request();
    vi.spyOn(broken.body!, "getReader").mockReturnValue({
      read: vi.fn().mockRejectedValue(new Error("private stream details")), releaseLock: vi.fn(),
    } as unknown as ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>);
    expect((await run(broken)).status).toBe(400);
    expect(withActor).not.toHaveBeenCalled();
  });

  it("ends stalled body reading within five seconds", async () => {
    vi.useFakeTimers();
    const { run, withActor } = port();
    const req = request();
    vi.spyOn(req.body!, "getReader").mockReturnValue({
      read: () => new Promise(() => {}), cancel: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn(),
    } as unknown as ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>);
    const response = run(req);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await response).status).toBe(408);
    expect(withActor).not.toHaveBeenCalled();
  });

  it("requires a closed shape and a real calendar timestamp with a timezone", async () => {
    const { run, withActor } = port();
    for (const value of [null, [], {}, { ...INPUT, userId: COURSE }, { ...INPUT, institutionId: COURSE }, { ...INPUT, role: "teacher" }]) {
      expect((await run(request(JSON.stringify(value)))).status).toBe(422);
    }
    for (const validUntil of [null, 3, "", "infinity", "2026-11-02", "2026-11-02T10:00:00", "2026-02-29T10:00:00Z",
      "2026-04-31T10:00:00Z", "0000-01-01T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T00:60:00Z",
      "2026-01-01T00:00:60Z", "2026-01-01T00:00:00+16:00", "2026-01-01T00:00:00+01:60", "2026-01-01T00:00:00.1234567Z"]) {
      expect((await run(request(JSON.stringify({ validUntil })))).status).toBe(422);
    }
    expect(withActor).not.toHaveBeenCalled();
    for (const validUntil of ["2028-02-29T10:00:00Z", "2026-11-02T10:00:00-05:30", INPUT.validUntil]) {
      expect((await run(request(JSON.stringify({ validUntil })))).status).toBe(200);
    }
  });

  it("maps DB errors neutrally without SQL, parameters or raw codes", async () => {
    for (const [code, status, error] of [["ZD401", 401, "unauthorized"], ["ZD403", 403, "forbidden"],
      ["ZD422", 422, "invalid_input"], ["XX000", 503, "unavailable"], [undefined, 503, "unavailable"]] as const) {
      const { run, query } = port();
      query.mockRejectedValue({ code, message: `SQL private ${CODE}`, detail: INPUT });
      const response = await run();
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    for (const rows of [[], [{ code: null }], [{ code: "private" }], [{ code: CODE }, { code: CODE }]]) {
      const { run, query } = port();
      query.mockResolvedValue({ rows, rowCount: rows.length });
      const response = await run();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "unavailable" });
    }
  });

  it("wires the real POST adapter to its path, cookie and configured origin", async () => {
    const { withActor } = port();
    vi.mocked(appWithActor).mockImplementation(withActor);
    const context = { params: Promise.resolve({ courseId: COURSE }) };
    const req = () => new NextRequest(request(undefined, {
      cookie: `__Host-ductus_session=${TOKEN}`, host: "evil.example", "x-forwarded-host": "evil.example",
    }));
    for (const callback of ["", "invalid", "file:///tmp/callback"]) {
      vi.stubEnv("OIDC_REDIRECT_URI", callback);
      expect((await POST(req(), context)).status).toBe(503);
    }
    expect(withActor).not.toHaveBeenCalled();
    vi.stubEnv("OIDC_REDIRECT_URI", `${ORIGIN}/api/auth/callback`);
    expect((await POST(req(), context)).status).toBe(200);
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    const forged = req();
    forged.headers.set("origin", "https://evil.example");
    expect((await POST(forged, context)).status).toBe(403);
    expect(forged.bodyUsed).toBe(false);
    expect(withActor).toHaveBeenCalledTimes(1);
  });
});
