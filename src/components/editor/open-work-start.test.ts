import { describe, expect, it, vi } from "vitest";

import type { OpenOutcome } from "@/client/evidence-ingest";

import { startWorkAttempt } from "./open-work-start";

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
