import { describe, expect, it, vi } from "vitest";

import type { OpenOutcome } from "@/client/evidence-ingest";

import { startWorkAttempt, whenOnline } from "./open-work-start";

// DAN-330. The assignment id is invented.
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPENED = { status: "opened" } as unknown as OpenOutcome;

describe("startWorkAttempt", () => {
  it("sends the open request while the page's session is current", async () => {
    const open = vi.fn(async () => OPENED);
    expect(await startWorkAttempt(ID, { sessionEnded: () => false, open })).toBe(OPENED);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(ID);
  });

  it("sends nothing once the page's session has ended", async () => {
    const open = vi.fn(async () => OPENED);
    expect(await startWorkAttempt(ID, { sessionEnded: () => true, open })).toEqual({ status: "sessionEnded" });
    expect(open).not.toHaveBeenCalled();
  });

  it("asks about the session right before the request, not earlier", async () => {
    const order: string[] = [];
    const open = vi.fn(async () => { order.push("open"); return OPENED; });
    await startWorkAttempt(ID, { sessionEnded: () => { order.push("ended?"); return false; }, open });
    expect(order).toEqual(["ended?", "open"]);
  });
});

describe("whenOnline", () => {
  it("goes on when the network came back before the listener was in place", () => {
    const target = new EventTarget();
    const go = vi.fn();
    whenOnline(target, () => true, go);
    expect(go).toHaveBeenCalledTimes(1);
    target.dispatchEvent(new Event("online"));
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("waits offline and goes on once on the online event", () => {
    const target = new EventTarget();
    const go = vi.fn();
    whenOnline(target, () => false, go);
    expect(go).not.toHaveBeenCalled();
    target.dispatchEvent(new Event("online"));
    target.dispatchEvent(new Event("online"));
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("does nothing after the cleanup", () => {
    const target = new EventTarget();
    const go = vi.fn();
    whenOnline(target, () => false, go)();
    target.dispatchEvent(new Event("online"));
    expect(go).not.toHaveBeenCalled();
  });
});
