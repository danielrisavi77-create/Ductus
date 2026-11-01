import { describe, expect, it, vi } from "vitest";

import { handleCreateCourse, type CreateCourseDeps } from "./create-course";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

const ORIGIN = "http://localhost:3000";
const URL = `${ORIGIN}/api/institution/courses`;
const TOKEN = "A".repeat(43);
const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VALID = {
  name: "Politologija i demokracija",
  academicYear: "2026/2027",
  aiPolicy: "partially_allowed",
};

function request(
  body: string | Uint8Array = JSON.stringify(VALID),
  headers: Record<string, string> = {},
): Request {
  return new Request(URL, {
    method: "POST",
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : new Uint8Array(body).buffer,
  });
}

function port({ code, id }: { code?: string; id?: string } = {}) {
  const query = vi.fn(async () => {
    if (code) throw Object.assign(new Error("do not leak raw SQL values"), { code });
    return { rows: [{ id: id ?? UUID }], rowCount: 1 };
  });
  const withActor = vi.fn(async (
    _token: string | null | undefined,
    fn: (tx: ActorTransaction) => Promise<unknown>,
  ) => fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
  const deps: CreateCourseDeps = { withActor, expectedOrigin: ORIGIN, sessionToken: TOKEN };
  return { deps, withActor, query };
}

describe("F-6a / DAN-35 course API contract", () => {
  it("creates a course via one parameterized SECURITY DEFINER RPC using the cookie principal", async () => {
    const { deps, withActor, query } = port();
    const response = await handleCreateCourse(request(), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: UUID });
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenCalledWith(
      "SELECT institution.create_course($1, $2, $3) AS id",
      [VALID.name, VALID.academicYear, VALID.aiPolicy],
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects absent, opaque and cross-site Origin before reading body or calling the database", async () => {
    const cases: Record<string, string>[] = [
      { origin: "" },
      { origin: "null" },
      { origin: "https://evil.example" },
      { origin: ORIGIN, "sec-fetch-site": "same-site" },
    ];
    for (const headers of cases) {
      const { deps, query } = port();
      const input = request(JSON.stringify(VALID), headers);
      const response = await handleCreateCourse(input, deps);
      expect(response.status).toBe(403);
      expect(input.bodyUsed).toBe(false);
      expect(query).not.toHaveBeenCalled();
    }
  });

  it("rejects absent/malformed session without accessing the database", async () => {
    for (const sessionToken of [undefined, "", "not-a-token", "!".repeat(43)]) {
      const { deps, withActor } = port();
      expect((await handleCreateCourse(request(), { ...deps, sessionToken })).status).toBe(401);
      expect(withActor).not.toHaveBeenCalled();
    }
  });

  it("refuses a body over 2048 bytes and never calls the RPC", async () => {
    const { deps, withActor } = port();
    const response = await handleCreateCourse(request("x".repeat(2049)), deps);
    expect(response.status).toBe(413);
    expect(withActor).not.toHaveBeenCalled();
  });

  it("rejects malformed UTF-8 and invalid JSON", async () => {
    const { deps, withActor } = port();
    expect((await handleCreateCourse(request(new Uint8Array([0xc3, 0x28])), deps)).status).toBe(400);
    expect((await handleCreateCourse(request("{oops"), deps)).status).toBe(400);
    expect(withActor).not.toHaveBeenCalled();
  });

  it("rejects text/plain, JSON arrays and extra fields (including forged userId)", async () => {
    const { deps, withActor } = port();
    expect((await handleCreateCourse(request("{}", { "content-type": "text/plain" }), deps)).status).toBe(415);
    for (const body of ["[]", JSON.stringify({ ...VALID, userId: "forged" }), JSON.stringify({ ...VALID, institutionId: "forged" })]) {
      expect((await handleCreateCourse(request(body), deps)).status).toBe(422);
    }
    expect(withActor).not.toHaveBeenCalled();
  });

  it("rejects policy widening, invalid year and unbounded labels before DB", async () => {
    const { deps, withActor } = port();
    const invalid = [
      { ...VALID, aiPolicy: "allow_everything" },
      { ...VALID, academicYear: "2026-2027" },
      { ...VALID, academicYear: "2027/2026" },
      { ...VALID, name: "x".repeat(170) },
      { ...VALID, name: "" },
    ];
    for (const value of invalid) {
      expect((await handleCreateCourse(request(JSON.stringify(value)), deps)).status).toBe(422);
    }
    expect(withActor).not.toHaveBeenCalled();
  });

  it.each([
    ["ZD401", 401],
    ["ZD403", 403],
    ["ZD409", 409],
    ["ZD422", 422],
  ])("maps database refusal %s to safe HTTP %s", async (code, status) => {
    const { deps } = port({ code });
    const res = await handleCreateCourse(request(), deps);
    expect(res.status).toBe(status);
    expect(await res.text()).not.toContain("do not leak raw SQL values");
  });

  it("fails closed for unexpected DB failures and malformed RPC success", async () => {
    for (const settings of [{ code: "XX000" }, { id: "not-a-uuid" }]) {
      const { deps } = port(settings);
      const res = await handleCreateCourse(request(), deps);
      expect(res.status).toBe(503);
      expect(await res.text()).not.toContain("do not leak raw SQL values");
    }
  });

  // DAN-302 L1: a client that never finishes the body cannot hold the route open.
  it("times out a body that never ends after 5 s, without a transaction", async () => {
    vi.useFakeTimers();
    try {
      const { deps, withActor } = port();
      const state = { cancelled: false };
      const slow = new ReadableStream<Uint8Array>({
        pull: () => new Promise<void>(() => {}),
        cancel: () => { state.cancelled = true; },
      });
      const pending = handleCreateCourse(new Request(URL, {
        method: "POST",
        headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" },
        body: slow,
        duplex: "half",
      } as RequestInit), deps);
      await vi.advanceTimersByTimeAsync(4_999);
      let settled = false;
      void pending.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const res = await pending;
      expect(res.status).toBe(408);
      expect(await res.json()).toEqual({ error: "body_timeout" });
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(state.cancelled).toBe(true);
      expect(withActor).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
