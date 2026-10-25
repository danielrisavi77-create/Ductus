import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";
import { withActor as appWithActor } from "@/server/db";
import { POST } from "../../../app/api/institution/courses/[courseId]/enrollment-code/revocation/route";
import { handleEnrollmentCodeRevocationRequest, MAX_REVOCATION_BODY_BYTES } from "./enrollment-code-revocation-route";

vi.mock("@/server/db", () => ({ withActor: vi.fn() }));
const ORIGIN = "https://ductus.example";
const COURSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "A".repeat(43);
const ROUTE_URL = `${ORIGIN}/api/institution/courses/${COURSE}/enrollment-code/revocation`;
const request = (body: BodyInit = "{}", headers: Record<string, string> = {}) =>
  new Request(ROUTE_URL, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...headers }, body });
function port(revoked: unknown = true) {
  const query = vi.fn().mockResolvedValue({ rows: [{ revoked }], rowCount: 1 });
  const withActor = vi.fn(async (_token: unknown, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as ActorTransaction)) as unknown as WithActor;
  const deps = { withActor, expectedOrigin: ORIGIN, sessionToken: TOKEN };
  return { query, withActor, deps, run: (req = request(), id: unknown = COURSE) => handleEnrollmentCodeRevocationRequest(req, id, deps) };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("teacher enrollment code revocation HTTP boundary", () => {
  it("passes only the session and course to the RPC and returns its boolean uncached, without logging", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    for (const revoked of [true, false]) {
      const { run, query, withActor } = port(revoked);
      const response = await run();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ revoked });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
      expect(query).toHaveBeenCalledExactlyOnceWith("SELECT institution.revoke_enrollment_code($1) AS revoked", [COURSE]);
    }
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
      const response = await run(req);
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(req.bodyUsed).toBe(false);
      expect(withActor).not.toHaveBeenCalled();
    }
    const { run, deps, withActor } = port();
    for (const method of ["GET", "DELETE", "PUT"]) {
      const response = await run(new Request(ROUTE_URL, { method, headers: { origin: ORIGIN } }));
      expect(response.status).toBe(405);
      expect(await response.json()).toEqual({ error: "method_not_allowed" });
    }
    const req = request();
    expect((await handleEnrollmentCodeRevocationRequest(req, COURSE, { ...deps, expectedOrigin: "null" })).status).toBe(503);
    expect(req.bodyUsed).toBe(false);
    expect(withActor).not.toHaveBeenCalled();
  });

  it("rejects missing or malformed session and course identifiers without DB or body reads", async () => {
    const { deps, withActor } = port();
    for (const sessionToken of [undefined, "", "bad", "!".repeat(43)]) {
      const req = request();
      const response = await handleEnrollmentCodeRevocationRequest(req, COURSE, { ...deps, sessionToken });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(req.bodyUsed).toBe(false);
    }
    for (const id of [undefined, null, 1, "", "bad", `${COURSE}'`, `${COURSE} `]) {
      const req = request();
      expect((await handleEnrollmentCodeRevocationRequest(req, id, deps)).status).toBe(422);
      expect(req.bodyUsed).toBe(false);
    }
    expect(withActor).not.toHaveBeenCalled();
  });

  it("bounds bytes before parsing, rejects content type, JSON, UTF-8, length and stream failures", async () => {
    const { run, withActor } = port();
    for (const [req, status, error] of [
      [request("{}", { "content-type": "text/plain" }), 415, "unsupported_media_type"],
      [request("{}", { "content-type": "application/x-www-form-urlencoded" }), 415, "unsupported_media_type"],
      [request(""), 400, "invalid_json"], [request("{bad"), 400, "invalid_json"],
      [request(new Uint8Array([0x7b, 0xc3, 0x28, 0x7d])), 400, "invalid_json"],
      [request(" ".repeat(MAX_REVOCATION_BODY_BYTES) + "{}"), 413, "body_too_large"],
      [request("{}", { "content-length": String(MAX_REVOCATION_BODY_BYTES + 1) }), 413, "body_too_large"],
      [request("{}", { "content-length": "bad" }), 400, "content_length_invalid"],
      [request("{}", { "content-length": "1" }), 400, "content_length_mismatch"],
    ] as const) {
      const response = await run(req);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    const broken = request();
    vi.spyOn(broken.body!, "getReader").mockReturnValue({
      read: vi.fn().mockRejectedValue(new Error("private stream details")), releaseLock: vi.fn(),
    } as unknown as ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>);
    expect((await run(broken)).status).toBe(400);
    expect(withActor).not.toHaveBeenCalled();
  });

  it("holds the body limit at exactly 64 bytes and refuses a byte order mark", async () => {
    expect(MAX_REVOCATION_BODY_BYTES).toBe(64);
    const { run, withActor } = port();
    const at = await run(request("{}" + " ".repeat(62)));
    expect(at.status).toBe(200);
    const over = await run(request("{}" + " ".repeat(63)));
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual({ error: "body_too_large" });
    const marked = await run(request(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])));
    expect(marked.status).toBe(400);
    expect(await marked.json()).toEqual({ error: "invalid_json" });
    expect(withActor).toHaveBeenCalledTimes(1);
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

  it("accepts only an empty object: no course, user, institution or role can ride in the body", async () => {
    const { run, withActor } = port();
    for (const body of ["null", "[]", "0", "\"\"", "true", JSON.stringify({ courseId: COURSE }),
      JSON.stringify({ userId: COURSE }), JSON.stringify({ institutionId: COURSE }), JSON.stringify({ role: "teacher" }),
      "{\"__proto__\":{}}"]) {
      const response = await run(request(body));
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_input" });
    }
    expect(withActor).not.toHaveBeenCalled();
    for (const body of ["{}", " { } ", "{}\n"]) expect((await run(request(body))).status).toBe(200);
  });

  it("maps DB errors neutrally and refuses a malformed RPC result", async () => {
    for (const [code, status, error] of [["ZD401", 401, "unauthorized"], ["ZD403", 403, "forbidden"],
      ["ZD422", 503, "unavailable"], ["XX000", 503, "unavailable"], [undefined, 503, "unavailable"]] as const) {
      const { run, query } = port();
      query.mockRejectedValue({ code, message: `SQL private ${COURSE}`, detail: COURSE });
      const response = await run();
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    for (const rows of [[], [{ revoked: null }], [{ revoked: "true" }], [{ revoked: 1 }], [{ revoked: true }, { revoked: true }]]) {
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
      const response = await POST(req(), context);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
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
