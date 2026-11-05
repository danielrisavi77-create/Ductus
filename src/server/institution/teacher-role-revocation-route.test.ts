import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";
import { withActor as appWithActor } from "@/server/db";
import { POST } from "../../../app/api/institution/teachers/[teacherId]/role-revocation/route";
import { handleTeacherRoleRevocationRequest, MAX_TEACHER_ROLE_REVOCATION_BODY_BYTES } from "./teacher-role-revocation-route";

vi.mock("@/server/db", () => ({ withActor: vi.fn() }));
const ORIGIN = "https://ductus.example";
const TEACHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TOKEN = "A".repeat(43);
const ROUTE_URL = `${ORIGIN}/api/institution/teachers/${TEACHER}/role-revocation`;
const request = (body: BodyInit = "{}", headers: Record<string, string> = {}) =>
  new Request(ROUTE_URL, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...headers }, body });
function port(revoked: unknown = true) {
  const query = vi.fn().mockResolvedValue({ rows: [{ revoked }], rowCount: 1 });
  const withActor = vi.fn(async (_token: unknown, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as ActorTransaction)) as unknown as WithActor;
  const deps = { withActor, expectedOrigin: ORIGIN, sessionToken: TOKEN };
  return {
    query, withActor, deps,
    run: (req = request(), teacher: unknown = TEACHER) => handleTeacherRoleRevocationRequest(req, teacher, deps),
  };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("teacher role revocation HTTP boundary", () => {
  it("passes only the session and the person to the RPC and returns its boolean uncached, without logging", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    for (const revoked of [true, false]) {
      const { run, query, withActor } = port(revoked);
      const response = await run();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ revoked });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
      expect(query).toHaveBeenCalledExactlyOnceWith("SELECT institution.revoke_teacher_role($1) AS revoked", [TEACHER]);
    }
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("checks method, Origin, fetch site and trusted configuration before body or database", async () => {
    const cases: Record<string, string>[] = [
      { origin: "" }, { origin: "null" }, { origin: "https://evil.example" }, { origin: `${ORIGIN}/` },
      { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "none" },
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
      expect((await run(new Request(ROUTE_URL, { method, headers: { origin: ORIGIN } }))).status).toBe(405);
    }
    const req = request();
    expect((await handleTeacherRoleRevocationRequest(req, TEACHER, { ...deps, expectedOrigin: "null" })).status).toBe(503);
    expect(req.bodyUsed).toBe(false);
    expect(withActor).not.toHaveBeenCalled();
  });

  it("rejects a missing session first, then a malformed person, without DB or body reads", async () => {
    const { deps, withActor } = port();
    for (const sessionToken of [undefined, "", "bad", "!".repeat(43)]) {
      const req = request();
      const response = await handleTeacherRoleRevocationRequest(req, "bad", { ...deps, sessionToken });
      expect(response.status).toBe(401);
      expect(req.bodyUsed).toBe(false);
    }
    for (const teacher of [undefined, "", "bad", `${TEACHER}'`, [TEACHER], `${TEACHER}\n`, `${TEACHER},${OTHER}`]) {
      const req = request();
      const response = await handleTeacherRoleRevocationRequest(req, teacher, deps);
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_input" });
      expect(req.bodyUsed).toBe(false);
    }
    expect(withActor).not.toHaveBeenCalled();
  });

  it("holds the body at exactly 64 bytes and refuses content type, JSON, BOM, length and stream failures", async () => {
    expect(MAX_TEACHER_ROLE_REVOCATION_BODY_BYTES).toBe(64);
    const { run, withActor } = port();
    for (const [req, status, error] of [
      [request("{}", { "content-type": "text/plain" }), 415, "unsupported_media_type"],
      [request(""), 400, "invalid_json"], [request("{bad"), 400, "invalid_json"],
      [request(new Uint8Array([0x7b, 0xc3, 0x28, 0x7d])), 400, "invalid_json"],
      [request(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), 400, "invalid_json"],
      [request("{}" + " ".repeat(63)), 413, "body_too_large"],
      [request("{}", { "content-length": "65" }), 413, "body_too_large"],
      [request("{}", { "content-length": "bad" }), 400, "content_length_invalid"],
      [request("{}", { "content-length": "1" }), 400, "content_length_mismatch"],
    ] as const) {
      const response = await run(req);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
    }
    const broken = request();
    vi.spyOn(broken.body!, "getReader").mockReturnValue({
      read: vi.fn().mockRejectedValue(new Error("private stream details")), releaseLock: vi.fn(),
    } as unknown as ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>);
    expect((await run(broken)).status).toBe(400);
    expect(withActor).not.toHaveBeenCalled();
    expect((await run(request("{}" + " ".repeat(62)))).status).toBe(200);
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

  it("accepts only an empty object: no other person, institution or role can ride in the body", async () => {
    const { run, withActor } = port();
    for (const body of ["null", "[]", "0", "\"\"", JSON.stringify({ teacherId: OTHER }), JSON.stringify({ userId: OTHER }),
      JSON.stringify({ institutionId: OTHER }), JSON.stringify({ role: "admin" }), JSON.stringify({ role: "teacher" }),
      "{\"__proto__\":{}}"]) {
      const response = await run(request(body));
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_input" });
    }
    expect(withActor).not.toHaveBeenCalled();
  });

  it("maps DB errors neutrally and refuses a malformed RPC result", async () => {
    for (const [code, status, error] of [["ZD401", 401, "unauthorized"], ["ZD403", 403, "forbidden"],
      ["ZD422", 503, "unavailable"], ["XX000", 503, "unavailable"], [undefined, 503, "unavailable"]] as const) {
      const { run, query } = port();
      query.mockRejectedValue({ code, message: `SQL private ${TEACHER}`, detail: OTHER });
      const response = await run();
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body).toEqual({ error });
      expect(JSON.stringify(body)).not.toContain(TEACHER);
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

  it("wires the real POST adapter to the path parameter, the cookie and the configured origin", async () => {
    const { withActor, query } = port();
    vi.mocked(appWithActor).mockImplementation(withActor);
    const context = { params: Promise.resolve({ teacherId: TEACHER }) };
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
    expect(query).toHaveBeenCalledWith(expect.any(String), [TEACHER]);
    const forged = req();
    forged.headers.set("origin", "https://evil.example");
    expect((await POST(forged, context)).status).toBe(403);
    expect(forged.bodyUsed).toBe(false);
    expect(withActor).toHaveBeenCalledTimes(1);
  });

  it("answers 503 in production for a callback that login refuses, whose origin the request matches", async () => {
    const { withActor } = port();
    vi.mocked(appWithActor).mockImplementation(withActor);
    vi.stubEnv("NODE_ENV", "production");
    const local = "http://localhost:3000";
    vi.stubEnv("OIDC_REDIRECT_URI", `${local}/api/auth/callback`);
    const req = new NextRequest(new Request(`${local}/api/institution/teachers/${TEACHER}/role-revocation`, {
      method: "POST",
      headers: { origin: local, "content-type": "application/json", cookie: `__Host-ductus_session=${TOKEN}` },
      body: "{}",
    }));
    const response = await POST(req, { params: Promise.resolve({ teacherId: TEACHER }) });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(withActor).not.toHaveBeenCalled();
  });
});
