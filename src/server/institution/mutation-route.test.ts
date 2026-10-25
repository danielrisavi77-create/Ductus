import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";
import { handleEnrollmentCodeRequest } from "./enrollment-code-route";
import { applicationOrigin, readEmptyMutation, readJsonMutation, respond, rpcErrorResponse } from "./mutation-route";

const ORIGIN = "https://ductus.example";
const COURSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "A".repeat(43);
const ROUTE_URL = `${ORIGIN}/api/institution/courses/${COURSE}/example`;
const BOM = [0xef, 0xbb, 0xbf];
const bytes = (text: string, prefix: number[] = []) => new Uint8Array([...prefix, ...new TextEncoder().encode(text)]);
const request = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request(ROUTE_URL, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...headers }, body });
const deps = { expectedOrigin: ORIGIN, sessionToken: TOKEN };
afterEach(() => { vi.unstubAllEnvs(); });

describe("shared institution mutation guards", () => {
  it("refuses a leading byte order mark instead of reading it away (#795 QA finding)", async () => {
    for (const read of [readJsonMutation, readEmptyMutation]) {
      const marked = await read(request(bytes("{}", BOM)), [COURSE], deps, 64);
      expect(marked.ok).toBe(false);
      if (!marked.ok) {
        expect(marked.response.status).toBe(400);
        expect(await marked.response.json()).toEqual({ error: "invalid_json" });
      }
      const plain = await read(request(bytes("{}")), [COURSE], deps, 64);
      expect(plain).toEqual({ ok: true, sessionToken: TOKEN, value: {} });
    }
  });

  it("refuses the byte order mark on the existing enrollment code route too", async () => {
    const query = vi.fn();
    const withActor = vi.fn(async (_token: unknown, fn: (tx: ActorTransaction) => Promise<unknown>) =>
      fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
    const body = bytes(JSON.stringify({ validUntil: "2026-11-02T10:00:00Z" }), BOM);
    const response = await handleEnrollmentCodeRequest(request(body), COURSE, { ...deps, withActor });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_json" });
    expect(withActor).not.toHaveBeenCalled();
  });

  it("checks every path identifier, in order after the session", async () => {
    for (const ids of [[COURSE, "bad"], ["bad", COURSE], [COURSE, undefined], [COURSE, `${COURSE}\n`]]) {
      const req = request("{}");
      const input = await readEmptyMutation(req, ids, deps, 64);
      expect(input.ok ? 200 : input.response.status).toBe(422);
      expect(req.bodyUsed).toBe(false);
    }
    const input = await readEmptyMutation(request("{}"), [COURSE, "bad"], { ...deps, sessionToken: "bad" }, 64);
    expect(input.ok ? 200 : input.response.status).toBe(401);
  });

  it("names only ZD401 and ZD403, and ZD422 only where the RPC judges input", async () => {
    for (const [error, invalidInput, status] of [
      [{ code: "ZD401" }, false, 401], [{ code: "ZD403" }, false, 403], [{ code: "ZD422" }, false, 503],
      [{ code: "ZD422" }, true, 422], [{ code: "ZD409" }, true, 503], [new Error("x"), true, 503], [null, false, 503],
    ] as const) {
      const response = rpcErrorResponse(error, invalidInput);
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("closes the reply shapes at the type level (#800 review finding)", async () => {
    // @ts-expect-error a success field of the wrong type
    respond(200, { removed: "yes" });
    // @ts-expect-error a field no route sends
    respond(200, { studentId: COURSE });
    const response = respond(200, { removed: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ removed: true });
  });

  it("takes the application origin only from a usable OIDC callback", () => {
    for (const callback of ["", "invalid", "file:///tmp/callback"]) {
      vi.stubEnv("OIDC_REDIRECT_URI", callback);
      expect(applicationOrigin()).toBeUndefined();
    }
    vi.stubEnv("OIDC_REDIRECT_URI", `${ORIGIN}/api/auth/callback`);
    expect(applicationOrigin()).toBe(ORIGIN);
  });
});
