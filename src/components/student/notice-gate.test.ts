import { describe, expect, it, vi } from "vitest";

import { acknowledgeNotice, initialNotice, mayRecord, noticeStep } from "./notice-gate";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AT = "2026-11-02T09:14:00.000Z";

describe("F-7 notice gate", () => {
  it("sends nothing before the box is ticked and confirmed", () => {
    const start = initialNotice(null);
    expect(noticeStep(start, { type: "confirm" })).toEqual({ state: start, send: false });
    const ticked = noticeStep(start, { type: "toggle" });
    expect(ticked.send).toBe(false);
    expect(noticeStep(ticked.state, { type: "confirm" })).toEqual({ state: { phase: "sending" }, send: true });
    expect(mayRecord(start)).toBe(false);
    expect(mayRecord(ticked.state)).toBe(false);
  });

  it("records only after the server time, and keeps the box ticked after a failure", () => {
    const sending = { phase: "sending" } as const;
    expect(mayRecord(sending)).toBe(false);
    const done = noticeStep(sending, { type: "settled", result: { kind: "acknowledged", at: AT } }).state;
    expect(done).toEqual({ phase: "acknowledged", at: AT });
    expect(mayRecord(done)).toBe(true);
    expect(noticeStep(sending, { type: "settled", result: { kind: "stale" } }).state)
      .toEqual({ phase: "reading", checked: true, error: "stale" });
  });

  it("starts acknowledged when the server already holds this version's acknowledgment", () => {
    expect(initialNotice(AT)).toEqual({ phase: "acknowledged", at: AT });
  });
});

describe("F-7 acknowledgment transport contract (#314 proposal)", () => {
  it("posts only the version number to the assignment's acknowledgment route", async () => {
    const send = vi.fn(async () => Response.json({ acknowledgedAt: AT }));
    expect(await acknowledgeNotice(ID, 3, send as unknown as typeof fetch)).toEqual({ kind: "acknowledged", at: AT });
    const [path, options] = send.mock.calls[0]! as unknown as [string, RequestInit];
    expect(path).toBe(`/api/institution/assignments/${ID}/acknowledgment`);
    expect(options).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(options.body as string)).toEqual({ versionNo: 3 });
  });

  it("calls nothing with a malformed id or version", async () => {
    const send = vi.fn();
    for (const [id, version] of [["x", 1], [ID, 0], [ID, 1.5], [ID, Number.NaN]] as const) {
      expect(await acknowledgeNotice(id, version, send as unknown as typeof fetch)).toEqual({ kind: "invalid" });
    }
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "unavailable"],
    [409, "stale"],
    [400, "invalid"],
    [422, "invalid"],
    [201, "unavailable"],
    [503, "unavailable"],
  ] as const)("keeps HTTP %i as the local %s state", async (status, kind) => {
    const send = vi.fn(async () => Response.json({ acknowledgedAt: AT, error: "raw diagnostics" }, { status }));
    expect(await acknowledgeNotice(ID, 1, send as unknown as typeof fetch)).toEqual({ kind });
  });

  it.each([[{}], [{ acknowledgedAt: "jučer" }], [{ acknowledgedAt: 1 }], [[AT]], [null]])(
    "never claims an acknowledgment on a malformed reply %o",
    async (body) => {
      const send = vi.fn(async () => Response.json(body));
      expect(await acknowledgeNotice(ID, 1, send as unknown as typeof fetch)).toEqual({ kind: "unavailable" });
    },
  );

  it("treats a transport failure as unavailable", async () => {
    const offline = vi.fn(async () => { throw new Error("offline"); });
    expect(await acknowledgeNotice(ID, 1, offline as unknown as typeof fetch)).toEqual({ kind: "unavailable" });
  });
});
