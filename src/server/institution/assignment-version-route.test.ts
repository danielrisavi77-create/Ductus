import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";
import { withActor as appWithActor } from "@/server/db";
import { POST } from "../../../app/api/institution/assignments/[assignmentId]/versions/route";
import { handleAssignmentVersionRequest, MAX_ASSIGNMENT_VERSION_BODY_BYTES } from "./assignment-version-route";

vi.mock("@/server/db", () => ({ withActor: vi.fn() }));
const ORIGIN = "https://ductus.example";
const ASSIGNMENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TOKEN = "A".repeat(43);
const URL_ = `${ORIGIN}/api/institution/assignments/${ASSIGNMENT}/versions`;
const CONTENT = {
  title: "Izmišljeni esej", instructions: "Upute za izmišljeni zadatak.", workType: "essay",
  opensAt: "2026-11-01T08:00:00Z", dueAt: "2026-11-30T22:00:00Z", aiPolicy: "partially_allowed",
  aiPurposes: ["proofreading"], evidenceProfile: "basic", importAllowed: false, wordMin: null, wordMax: 3000,
};
const BODY = { expectedVersion: 1, ...CONTENT };
const request = (body: unknown = BODY, headers: Record<string, string> = {}) => new Request(URL_, {
  method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
function port(versionNo: unknown = 2) {
  const query = vi.fn().mockResolvedValue({ rows: [{ version_no: versionNo }], rowCount: 1 });
  const withActor = vi.fn(async (_token: unknown, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as ActorTransaction)) as unknown as WithActor;
  const deps = { withActor, expectedOrigin: ORIGIN, sessionToken: TOKEN };
  return { query, withActor, deps, run: (req = request(), id: unknown = ASSIGNMENT) => handleAssignmentVersionRequest(req, id, deps) };
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("new assignment version HTTP boundary (DAN-292)", () => {
  it("passes the session, the path's assignment and the body's fields to the RPC and answers 201 uncached", async () => {
    const { run, query, withActor } = port(4);
    const response = await run(request({ ...BODY, expectedVersion: 3 }), ASSIGNMENT.toUpperCase());
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ assignmentId: ASSIGNMENT, versionNo: 4 });
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("institution.publish_assignment_version("), [
      ASSIGNMENT.toUpperCase(), 3, CONTENT.title, CONTENT.instructions, "essay", CONTENT.opensAt, CONTENT.dueAt,
      "partially_allowed", ["proofreading"], "basic", false, null, 3000,
    ]);
  });

  it("runs the shared guards before the body and the database", async () => {
    const { run, deps, withActor } = port();
    const foreign = request(BODY, { origin: "https://evil.example" });
    expect((await run(foreign)).status).toBe(403);
    expect(foreign.bodyUsed).toBe(false);
    const anonymous = request();
    expect((await handleAssignmentVersionRequest(anonymous, ASSIGNMENT, { ...deps, sessionToken: undefined })).status).toBe(401);
    expect(anonymous.bodyUsed).toBe(false);
    expect((await run(request(), "not-an-id")).status).toBe(422);
    expect((await run(request(BODY, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await run(request("{bad"))).status).toBe(400);
    expect(MAX_ASSIGNMENT_VERSION_BODY_BYTES).toBe(90_000);
    expect((await run(request({ ...BODY, instructions: "x".repeat(90_000) }))).status).toBe(413);
    expect(withActor).not.toHaveBeenCalled();
  });

  it("accepts only the closed body: both word bounds named and a whole expectedVersion", async () => {
    const { run, withActor } = port();
    const without = (key: string) => Object.fromEntries(Object.entries(BODY).filter(([name]) => name !== key));
    for (const body of [
      without("wordMin"), without("wordMax"), without("expectedVersion"), "null", "[]",
      { ...BODY, expectedVersion: 0 }, { ...BODY, expectedVersion: -1 }, { ...BODY, expectedVersion: 1.5 },
      { ...BODY, expectedVersion: 2 ** 31 }, { ...BODY, expectedVersion: "1" }, { ...BODY, expectedVersion: null },
      { ...BODY, assignmentId: ASSIGNMENT }, { ...BODY, courseId: ASSIGNMENT }, { ...BODY, role: "teacher" },
      { ...BODY, title: "" }, { ...BODY, aiPolicy: "prohibited" }, { ...BODY, wordMin: 10, wordMax: 5 },
      `{"__proto__":{"isAdmin":true},${JSON.stringify(BODY).slice(1)}`,
    ]) {
      const response = await run(request(body));
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_input" });
    }
    expect(withActor).not.toHaveBeenCalled();
    expect((await port().run(request({ ...BODY, expectedVersion: 2 ** 31 - 1 }))).status).toBe(503);
  });

  it("maps the RPC's codes neutrally and refuses a result that is not the next version", async () => {
    for (const [code, status, error] of [["ZD401", 401, "unauthorized"], ["ZD403", 403, "forbidden"],
      ["ZD409", 409, "version_conflict"], ["ZD422", 422, "invalid_input"], ["XX000", 503, "unavailable"],
      [undefined, 503, "unavailable"]] as const) {
      const { run, query } = port();
      query.mockRejectedValue({ code, message: `SQL private ${ASSIGNMENT}` });
      const response = await run();
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    for (const rows of [[], [{ version_no: 3 }], [{ version_no: 1 }], [{ version_no: "2" }], [{ version_no: null }],
      [{ version_no: 2 }, { version_no: 2 }]]) {
      const { run, query } = port();
      query.mockResolvedValue({ rows, rowCount: rows.length });
      expect((await run()).status).toBe(503);
    }
  });

  it("wires the real POST adapter to the path parameter, the cookie and the configured origin", async () => {
    const { withActor, query } = port();
    vi.mocked(appWithActor).mockImplementation(withActor);
    const context = { params: Promise.resolve({ assignmentId: ASSIGNMENT }) };
    const req = () => new NextRequest(request(BODY, { cookie: `__Host-ductus_session=${TOKEN}`, host: "evil.example" }));
    vi.stubEnv("OIDC_REDIRECT_URI", "");
    expect((await POST(req(), context)).status).toBe(503);
    expect(withActor).not.toHaveBeenCalled();
    vi.stubEnv("OIDC_REDIRECT_URI", `${ORIGIN}/api/auth/callback`);
    expect((await POST(req(), context)).status).toBe(201);
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query.mock.calls[0]![1]![0]).toBe(ASSIGNMENT);
  });
});
