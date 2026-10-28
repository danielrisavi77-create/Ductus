import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../../app/api/notifications/read/route";
import { withActor as appWithActor } from "@/server/db";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";
import { handleMarkNotificationReadRequest, markNotificationRead, readNotification } from "./notifications";

vi.mock("@/server/db", () => ({ withActor: vi.fn() }));
const ORIGIN = "https://ductus.example";
const TOKEN = "A".repeat(43);
const NOTICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CANARY = "privatni-testni-podatak";
const URL = `${ORIGIN}/api/notifications/read`;

const validRow = () => ({
  notification_id: NOTICE, kind: "assignment_version", target_id: TARGET,
  created_window: new Date("2026-10-28T09:15:00.000Z"), is_read: false,
});
function port(rows: unknown[] = [{ marked: true }]) {
  const query = vi.fn().mockResolvedValue({ rows, rowCount: rows.length });
  const withActor = vi.fn(async (_token: unknown, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
  return { query, withActor, deps: { withActor, expectedOrigin: ORIGIN, sessionToken: TOKEN } };
}
function request(body: BodyInit = JSON.stringify({ notificationId: NOTICE }), headers: Record<string, string> = {}) {
  return new Request(URL, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...headers }, body });
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("one notification read", () => {
  it("uses the cookie-backed actor and returns only validated, coarse metadata", async () => {
    const { query, withActor } = port([validRow()]);
    expect(await readNotification(TOKEN, NOTICE, withActor)).toEqual({ kind: "ok", item: {
      id: NOTICE, eventKind: "assignment_version", targetId: TARGET,
      createdWindow: "2026-10-28T09:15:00.000Z", isRead: false,
    } });
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("FROM institution.read_notification($1::uuid)"), [NOTICE]);
  });

  it("gives missing and inaccessible items one answer and avoids DB access for invalid input", async () => {
    const empty = port([]);
    expect(await readNotification(TOKEN, NOTICE, empty.withActor)).toEqual({ kind: "not_found" });
    const untouched = port();
    expect(await readNotification(undefined, NOTICE, untouched.withActor)).toEqual({ kind: "unauthorized" });
    expect(await readNotification("bad", NOTICE, untouched.withActor)).toEqual({ kind: "unauthorized" });
    expect(await readNotification(TOKEN, "not-an-id", untouched.withActor)).toEqual({ kind: "not_found" });
    expect(untouched.withActor).not.toHaveBeenCalled();
  });

  it("fails closed on any malformed or duplicate database row", async () => {
    for (const rows of [
      [validRow(), validRow()], [{ ...validRow(), notification_id: TARGET }], [{ ...validRow(), target_id: "invalid" }],
      [{ ...validRow(), kind: "comment_posted" }], [{ ...validRow(), is_read: "false" }],
      [{ ...validRow(), unexpected: CANARY }],
      [{ ...validRow(), created_window: "2026-10-28T09:15:00Z" }],
      [{ ...validRow(), created_window: new Date("2026-10-28T09:15:01Z") }],
      [{ ...validRow(), created_window: new Date(NaN) }],
    ]) {
      expect(await readNotification(TOKEN, NOTICE, port(rows).withActor)).toEqual({ kind: "unavailable" });
    }
  });

  it("does not expose database error details", async () => {
    const p = port();
    p.query.mockRejectedValueOnce({ code: "ZD401", message: CANARY });
    expect(await readNotification(TOKEN, NOTICE, p.withActor)).toEqual({ kind: "unauthorized" });
    p.query.mockRejectedValueOnce({ code: "XX000", message: CANARY });
    expect(await readNotification(TOKEN, NOTICE, p.withActor)).toEqual({ kind: "unavailable" });
  });
});

describe("mark notification HTTP boundary", () => {
  it("passes only the notification id and returns an uncached success", async () => {
    const p = port();
    const response = await handleMarkNotificationReadRequest(request(), p.deps);
    expect([response.status, await response.json()]).toEqual([200, { marked: true }]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(p.withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(p.query).toHaveBeenCalledExactlyOnceWith("SELECT institution.mark_notification_read($1::uuid) AS marked", [NOTICE]);
  });

  it("answers inaccessible or nonexistent items identically, without returning a database error", async () => {
    const p = port([{ marked: false }]);
    const response = await handleMarkNotificationReadRequest(request(), p.deps);
    expect([response.status, await response.json()]).toEqual([404, { error: "not_found" }]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects cross-origin requests and missing session before reading the body or calling the database", async () => {
    const badHeaders: Record<string, string>[] = [
      { origin: "https://evil.example" }, { origin: "null" }, { "sec-fetch-site": "same-site" },
      { "sec-fetch-site": "cross-site" },
    ];
    for (const headers of badHeaders) {
      const p = port(); const req = request(undefined, headers);
      expect((await handleMarkNotificationReadRequest(req, p.deps)).status).toBe(403);
      expect(req.bodyUsed).toBe(false);
      expect(p.withActor).not.toHaveBeenCalled();
    }
    const p = port(); const req = request();
    expect((await handleMarkNotificationReadRequest(req, { ...p.deps, sessionToken: "bad" })).status).toBe(401);
    expect(req.bodyUsed).toBe(false);
    expect(p.withActor).not.toHaveBeenCalled();
    const newline = request();
    expect((await handleMarkNotificationReadRequest(newline, { ...p.deps, sessionToken: `${TOKEN}\n` })).status).toBe(401);
    expect(newline.bodyUsed).toBe(false);
    const missingOrigin = request(); missingOrigin.headers.delete("origin");
    expect((await handleMarkNotificationReadRequest(missingOrigin, p.deps)).status).toBe(403);
    expect(missingOrigin.bodyUsed).toBe(false);
    expect((await handleMarkNotificationReadRequest(new Request(URL, { method: "GET", headers: { origin: ORIGIN } }), p.deps)).status).toBe(405);
  });

  it("refuses extra identity fields, bad ids, malformed JSON and oversized bodies", async () => {
    const p = port();
    for (const body of ["null", "[]", "{}", JSON.stringify({ notificationId: "bad" }), JSON.stringify({ notificationId: `${NOTICE}\n` }),
      JSON.stringify({ notificationId: NOTICE, userId: TARGET }), JSON.stringify({ notificationId: NOTICE, institutionId: TARGET })]) {
      const response = await handleMarkNotificationReadRequest(request(body), p.deps);
      expect([response.status, await response.json()]).toEqual([422, { error: "invalid_input" }]);
    }
    expect((await handleMarkNotificationReadRequest(request("{bad"), p.deps)).status).toBe(400);
    expect((await handleMarkNotificationReadRequest(request(new Uint8Array([0x7b, 0xc3, 0x28, 0x7d])), p.deps)).status).toBe(400);
    expect((await handleMarkNotificationReadRequest(request(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), p.deps)).status).toBe(400);
    expect((await handleMarkNotificationReadRequest(request("{}", { "content-type": "text/plain" }), p.deps)).status).toBe(415);
    expect((await handleMarkNotificationReadRequest(request("x".repeat(257)), p.deps)).status).toBe(413);
    expect((await handleMarkNotificationReadRequest(request("{}", { "content-length": "257" }), p.deps)).status).toBe(413);
    expect((await handleMarkNotificationReadRequest(request("{}", { "content-length": "1" }), p.deps)).status).toBe(400);
    expect(p.withActor).not.toHaveBeenCalled();
  });

  it("stops a stalled body within the shared time limit", async () => {
    vi.useFakeTimers();
    const p = port(); const req = request();
    vi.spyOn(req.body!, "getReader").mockReturnValue({
      read: () => new Promise(() => {}), cancel: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn(),
    } as unknown as ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>);
    const pending = handleMarkNotificationReadRequest(req, p.deps);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await pending).status).toBe(408);
    expect(p.withActor).not.toHaveBeenCalled();
  });

  it("returns 401 for an expired session and 503 for bad database results without leaking details", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const p = port();
    p.query.mockRejectedValueOnce({ code: "ZD401", message: CANARY });
    let response = await handleMarkNotificationReadRequest(request(), p.deps);
    expect([response.status, await response.json()]).toEqual([401, { error: "unauthorized" }]);
    p.query.mockRejectedValueOnce({ code: "XX000", message: CANARY });
    response = await handleMarkNotificationReadRequest(request(), p.deps);
    expect([response.status, await response.json()]).toEqual([503, { error: "unavailable" }]);
    for (const rows of [[], [{ marked: "true" }], [{ marked: null }], [{ marked: true, extra: CANARY }],
      [{ marked: true }, { marked: true }]]) {
      const bad = port(rows);
      response = await handleMarkNotificationReadRequest(request(), bad.deps);
      expect([response.status, await response.json()]).toEqual([503, { error: "unavailable" }]);
    }
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("repeats a successful RPC call without substituting a user id", async () => {
    const p = port();
    expect(await markNotificationRead(TOKEN, NOTICE, p.withActor)).toEqual({ kind: "ok" });
    expect(await markNotificationRead(TOKEN, NOTICE, p.withActor)).toEqual({ kind: "ok" });
    expect(p.query).toHaveBeenCalledTimes(2);
    for (const [, params] of p.query.mock.calls) expect(params).toEqual([NOTICE]);
    const untouched = port();
    expect(await markNotificationRead(undefined, NOTICE, untouched.withActor)).toEqual({ kind: "unauthorized" });
    expect(await markNotificationRead(`${TOKEN}\n`, NOTICE, untouched.withActor)).toEqual({ kind: "unauthorized" });
    expect(await markNotificationRead(TOKEN, `${NOTICE}\n`, untouched.withActor)).toEqual({ kind: "not_found" });
    expect(untouched.withActor).not.toHaveBeenCalled();
  });

  it("wires the real POST adapter to the configured origin, cookie and database", async () => {
    const p = port(); vi.mocked(appWithActor).mockImplementation(p.withActor);
    const next = () => new NextRequest(request(undefined, { cookie: `__Host-ductus_session=${TOKEN}`, host: "evil.example" }));
    for (const callback of ["", "invalid", "file:///tmp/callback", "ftp://ductus.example/callback"]) {
      vi.stubEnv("OIDC_REDIRECT_URI", callback);
      expect((await POST(next())).status).toBe(503);
    }
    expect(p.withActor).not.toHaveBeenCalled();
    vi.stubEnv("OIDC_REDIRECT_URI", `${ORIGIN}/api/auth/callback`);
    expect((await POST(next())).status).toBe(200);
    expect(p.withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    const forged = next(); forged.headers.set("origin", "https://evil.example");
    expect((await POST(forged)).status).toBe(403);
    expect(forged.bodyUsed).toBe(false);
    expect(p.withActor).toHaveBeenCalledTimes(1);
  });
});
