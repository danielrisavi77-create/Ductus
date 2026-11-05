import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";
import { withActor as appWithActor } from "@/server/db";
import { POST } from "../../../app/api/institution/teachers/[teacherId]/role-confirmation/route";
import { handleTeacherRoleConfirmationRequest, MAX_TEACHER_ROLE_CONFIRMATION_BODY_BYTES } from "./teacher-role-confirmation-route";

vi.mock("@/server/db", () => ({ withActor: vi.fn() }));
const ORIGIN = "https://ductus.example";
const CANDIDATE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ACTOR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TOKEN = "A".repeat(43);
const ACTOR_SQL = "SELECT a.user_id, institution.actor_has_role('admin') AS admin FROM app.current_actor() a";
const CONFIRM_SQL = "SELECT institution.confirm_teacher_role($1)";
const ROUTE_URL = `${ORIGIN}/api/institution/teachers/${CANDIDATE}/role-confirmation`;
const request = (body: BodyInit = "{}", headers: Record<string, string> = {}) =>
  new Request(ROUTE_URL, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...headers }, body });
type Rows = { rows: unknown[]; rowCount: number };
const rows = (list: unknown[]): Rows => ({ rows: list, rowCount: list.length });
function port(actor: unknown[] = [{ user_id: ACTOR, admin: true }], confirm: () => Promise<Rows> = async () => rows([{ confirm_teacher_role: "" }])) {
  const query = vi.fn(async (sql: string) => (sql === ACTOR_SQL ? rows(actor) : confirm()));
  const withActor = vi.fn(async (_token: unknown, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
  const deps = { withActor, expectedOrigin: ORIGIN, sessionToken: TOKEN };
  return {
    query, withActor, deps,
    run: (req = request(), candidate: unknown = CANDIDATE) => handleTeacherRoleConfirmationRequest(req, candidate, deps),
  };
}
const refusing = (code: unknown) => async (): Promise<Rows> => {
  throw { code, message: `SQL private ${CANDIDATE}`, detail: OTHER };
};
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("teacher role confirmation HTTP boundary", () => {
  it("reads the caller, then passes only the candidate to the RPC, uncached and without logging", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    const { run, query, withActor } = port();
    const response = await run();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ confirmed: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(withActor).toHaveBeenCalledExactlyOnceWith(TOKEN, expect.any(Function));
    expect(query.mock.calls).toEqual([[ACTOR_SQL], [CONFIRM_SQL, [CANDIDATE]]]);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("answers 401 for no actor and 403 for a non-administrator, without calling the RPC", async () => {
    for (const actor of [[], [{ user_id: null, admin: false }], [{ user_id: null, admin: null }]]) {
      const { run, query } = port(actor);
      const response = await run();
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(query).toHaveBeenCalledExactlyOnceWith(ACTOR_SQL);
    }
    const { run, query } = port([{ user_id: ACTOR, admin: false }]);
    const response = await run();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(query).toHaveBeenCalledExactlyOnceWith(ACTOR_SQL);
  });

  it("gives an administrator one byte-identical 404 for every refusal of the RPC", async () => {
    const answers: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const { run } = port(undefined, refusing("ZD403"));
      const response = await run();
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      answers.push(await response.text());
    }
    expect(answers).toEqual([JSON.stringify({ error: "not_found" }), JSON.stringify({ error: "not_found" })]);
  });

  it("maps other DB errors neutrally and refuses a malformed result", async () => {
    for (const [code, status, error] of [["ZD401", 401, "unauthorized"], ["ZD422", 503, "unavailable"],
      ["XX000", 503, "unavailable"], [undefined, 503, "unavailable"]] as const) {
      const { run } = port(undefined, refusing(code));
      const response = await run();
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body).toEqual({ error });
      expect(JSON.stringify(body)).not.toContain(CANDIDATE);
    }
    // A ZD403 before the caller is known to be an administrator is never the 404.
    const { run, withActor } = port();
    vi.mocked(withActor).mockRejectedValueOnce({ code: "ZD403" });
    expect((await run()).status).toBe(403);
    for (const actor of [[{ user_id: ACTOR, admin: "true" }], [{ user_id: ACTOR, admin: null }],
      [{ user_id: ACTOR, admin: true }, { user_id: ACTOR, admin: true }]]) {
      const { run: read, query } = port(actor);
      expect((await read()).status).toBe(503);
      expect(query).toHaveBeenCalledExactlyOnceWith(ACTOR_SQL);
    }
    for (const list of [[], [{}, {}]]) {
      const { run: read } = port(undefined, async () => rows(list));
      const response = await read();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "unavailable" });
    }
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
      expect((await run(req)).status).toBe(403);
      expect(req.bodyUsed).toBe(false);
      expect(withActor).not.toHaveBeenCalled();
    }
    const { run, deps, withActor } = port();
    for (const method of ["GET", "DELETE", "PUT"]) {
      expect((await run(new Request(ROUTE_URL, { method, headers: { origin: ORIGIN } }))).status).toBe(405);
    }
    const req = request();
    expect((await handleTeacherRoleConfirmationRequest(req, CANDIDATE, { ...deps, expectedOrigin: "null" })).status).toBe(503);
    expect(req.bodyUsed).toBe(false);
    expect(withActor).not.toHaveBeenCalled();
  });

  it("rejects a missing session first, then a malformed candidate, without DB or body reads", async () => {
    const { deps, withActor } = port();
    for (const sessionToken of [undefined, "", "bad", "!".repeat(43)]) {
      const req = request();
      expect((await handleTeacherRoleConfirmationRequest(req, "bad", { ...deps, sessionToken })).status).toBe(401);
      expect(req.bodyUsed).toBe(false);
    }
    for (const candidate of [undefined, "", "bad", `${CANDIDATE}'`, [CANDIDATE], `${CANDIDATE}\n`, `${CANDIDATE},${OTHER}`]) {
      const req = request();
      const response = await handleTeacherRoleConfirmationRequest(req, candidate, deps);
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_input" });
      expect(req.bodyUsed).toBe(false);
    }
    expect(withActor).not.toHaveBeenCalled();
  });

  it("holds the body at 64 bytes, refuses BOM and bad JSON, and accepts only an empty object", async () => {
    expect(MAX_TEACHER_ROLE_CONFIRMATION_BODY_BYTES).toBe(64);
    const { run, withActor } = port();
    for (const [req, status, error] of [
      [request("{}", { "content-type": "text/plain" }), 415, "unsupported_media_type"],
      [request(""), 400, "invalid_json"], [request("{bad"), 400, "invalid_json"],
      [request(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), 400, "invalid_json"],
      [request("{}" + " ".repeat(63)), 413, "body_too_large"],
    ] as const) {
      const response = await run(req);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
    }
    for (const body of ["null", "[]", "0", JSON.stringify({ candidateId: OTHER }), JSON.stringify({ teacherId: OTHER }),
      JSON.stringify({ institutionId: OTHER }), JSON.stringify({ role: "admin" }), "{\"__proto__\":{}}"]) {
      const response = await run(request(body));
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_input" });
    }
    expect(withActor).not.toHaveBeenCalled();
    expect((await run(request("{}" + " ".repeat(62)))).status).toBe(200);
  });

  it("wires the real POST adapter to the path parameter only, the cookie and the configured origin", async () => {
    const { withActor, query } = port();
    vi.mocked(appWithActor).mockImplementation(withActor);
    const context = { params: Promise.resolve({ teacherId: CANDIDATE }) };
    const req = () => new NextRequest(new Request(`${ROUTE_URL}?candidateId=${OTHER}&teacherId=${OTHER}`, {
      method: "POST", body: "{}",
      headers: { origin: ORIGIN, "content-type": "application/json", cookie: `__Host-ductus_session=${TOKEN}`, host: "evil.example" },
    }));
    vi.stubEnv("OIDC_REDIRECT_URI", "");
    expect((await POST(req(), context)).status).toBe(503);
    expect(withActor).not.toHaveBeenCalled();
    vi.stubEnv("OIDC_REDIRECT_URI", `${ORIGIN}/api/auth/callback`);
    expect((await POST(req(), context)).status).toBe(200);
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenLastCalledWith(CONFIRM_SQL, [CANDIDATE]);
    const forged = req();
    forged.headers.set("origin", "https://evil.example");
    expect((await POST(forged, context)).status).toBe(403);
    expect(withActor).toHaveBeenCalledTimes(1);
  });
});
