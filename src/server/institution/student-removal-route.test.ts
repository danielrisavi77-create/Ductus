import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";
import { withActor as appWithActor } from "@/server/db";
import { POST } from "../../../app/api/institution/courses/[courseId]/students/[studentId]/removal/route";
import { handleStudentRemovalRequest, MAX_STUDENT_REMOVAL_BODY_BYTES } from "./student-removal-route";

vi.mock("@/server/db", () => ({ withActor: vi.fn() }));
const ORIGIN = "https://ductus.example";
const COURSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STUDENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN = "A".repeat(43);
const ROUTE_URL = `${ORIGIN}/api/institution/courses/${COURSE}/students/${STUDENT}/removal`;
const request = (body: BodyInit = "{}", headers: Record<string, string> = {}) =>
  new Request(ROUTE_URL, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...headers }, body });
function port(removed: unknown = true) {
  const query = vi.fn().mockResolvedValue({ rows: [{ removed }], rowCount: 1 });
  const withActor = vi.fn(async (_token: unknown, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as ActorTransaction)) as unknown as WithActor;
  const deps = { withActor, expectedOrigin: ORIGIN, sessionToken: TOKEN };
  return {
    query, withActor, deps,
    run: (req = request(), course: unknown = COURSE, student: unknown = STUDENT) => handleStudentRemovalRequest(req, course, student, deps),
  };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("teacher student removal HTTP boundary", () => {
  it("passes only the session, course and student to the RPC and returns its boolean uncached, without logging", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    for (const removed of [true, false]) {
      const { run, query, withActor } = port(removed);
      const response = await run();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ removed });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
      expect(query).toHaveBeenCalledExactlyOnceWith("SELECT institution.remove_student($1, $2) AS removed", [COURSE, STUDENT]);
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
    expect((await handleStudentRemovalRequest(req, COURSE, STUDENT, { ...deps, expectedOrigin: "null" })).status).toBe(503);
    expect(req.bodyUsed).toBe(false);
    expect(withActor).not.toHaveBeenCalled();
  });

  it("rejects a missing session first, then a malformed course or student, without DB or body reads", async () => {
    const { deps, withActor } = port();
    for (const sessionToken of [undefined, "", "bad", "!".repeat(43)]) {
      const req = request();
      const response = await handleStudentRemovalRequest(req, COURSE, "bad", { ...deps, sessionToken });
      expect(response.status).toBe(401);
      expect(req.bodyUsed).toBe(false);
    }
    for (const [course, student] of [[COURSE, undefined], [COURSE, ""], [COURSE, "bad"], [COURSE, `${STUDENT}'`],
      [undefined, STUDENT], ["bad", STUDENT], [COURSE, [STUDENT]], [COURSE, `${STUDENT}\n`]]) {
      const req = request();
      const response = await handleStudentRemovalRequest(req, course, student, deps);
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_input" });
      expect(req.bodyUsed).toBe(false);
    }
    expect(withActor).not.toHaveBeenCalled();
  });

  it("holds the body at exactly 64 bytes and refuses content type, JSON, BOM, length and stream failures", async () => {
    expect(MAX_STUDENT_REMOVAL_BODY_BYTES).toBe(64);
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

  it("accepts only an empty object: no other student, course, institution or role can ride in the body", async () => {
    const { run, withActor } = port();
    for (const body of ["null", "[]", "0", "\"\"", JSON.stringify({ studentId: STUDENT }), JSON.stringify({ courseId: COURSE }),
      JSON.stringify({ userId: STUDENT }), JSON.stringify({ institutionId: COURSE }), JSON.stringify({ role: "student" }),
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
      query.mockRejectedValue({ code, message: `SQL private ${STUDENT}`, detail: COURSE });
      const response = await run();
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    for (const rows of [[], [{ removed: null }], [{ removed: "true" }], [{ removed: 1 }], [{ removed: true }, { removed: true }]]) {
      const { run, query } = port();
      query.mockResolvedValue({ rows, rowCount: rows.length });
      const response = await run();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "unavailable" });
    }
  });

  it("wires the real POST adapter to both path parameters, the cookie and the configured origin", async () => {
    const { withActor, query } = port();
    vi.mocked(appWithActor).mockImplementation(withActor);
    const context = { params: Promise.resolve({ courseId: COURSE, studentId: STUDENT }) };
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
    expect(query).toHaveBeenCalledWith(expect.any(String), [COURSE, STUDENT]);
    const forged = req();
    forged.headers.set("origin", "https://evil.example");
    expect((await POST(forged, context)).status).toBe(403);
    expect(forged.bodyUsed).toBe(false);
    expect(withActor).toHaveBeenCalledTimes(1);
  });

  // DAN-302 L3: the route expects only an origin login would redirect to.
  it("answers 503 in production for a callback that login refuses, whose origin the request matches", async () => {
    const { withActor } = port();
    vi.mocked(appWithActor).mockImplementation(withActor);
    vi.stubEnv("NODE_ENV", "production");
    const local = "http://localhost:3000";
    vi.stubEnv("OIDC_REDIRECT_URI", `${local}/api/auth/callback`);
    const req = new NextRequest(new Request(`${local}/api/institution/courses/${COURSE}/students/${STUDENT}/removal`, {
      method: "POST",
      headers: { origin: local, "content-type": "application/json", cookie: `__Host-ductus_session=${TOKEN}` },
      body: "{}",
    }));
    const response = await POST(req, { params: Promise.resolve({ courseId: COURSE, studentId: STUDENT }) });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(withActor).not.toHaveBeenCalled();
  });
});
