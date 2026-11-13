import { describe, expect, it, vi } from "vitest";

import { onWake, REQUEST_TIMEOUT_MS, statusLoader } from "./status-loader";

const body = { checkedAt: "2026-11-12T10:25:00.000Z", components: { writing: "radi", submission: "radi", mentorView: "radi" } };

function events() {
  return { ok: vi.fn(), fail: vi.fn(), settled: vi.fn() };
}

/** A request that waits until the test answers it, or rejects when its signal aborts, as fetch does. */
function pending() {
  let answer: (r: Response) => void = () => {};
  const request = vi.fn(
    (signal: AbortSignal) =>
      new Promise<Response>((resolve, reject) => {
        answer = resolve;
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  );
  return { request, answer: (r: Response) => answer(r) };
}

// DAN-429, pre-review of #1975: the board on a remount (StrictMode in dev, Fast Refresh).
describe("statusLoader", () => {
  it("lets a remount ask at once and keeps the aborted request of the first mount silent", async () => {
    const first = new AbortController();
    const firstEvents = events();
    const firstReq = pending();
    const firstLoad = statusLoader(first.signal, firstEvents, firstReq.request);
    const firstRun = firstLoad();

    first.abort();
    const second = new AbortController();
    const secondEvents = events();
    const secondReq = pending();
    const secondRun = statusLoader(second.signal, secondEvents, secondReq.request)();

    await firstRun;
    expect(firstEvents.fail).not.toHaveBeenCalled();
    expect(firstEvents.settled).not.toHaveBeenCalled();
    expect(secondReq.request).toHaveBeenCalledTimes(1);

    secondReq.answer(Response.json(body));
    await secondRun;
    expect(secondEvents.ok).toHaveBeenCalledWith(body);
    expect(secondEvents.fail).not.toHaveBeenCalled();
  });

  it("runs one request at a time and asks again once it settled", async () => {
    const e = events();
    const req = pending();
    const load = statusLoader(new AbortController().signal, e, req.request);
    const run = load();
    await load();
    expect(req.request).toHaveBeenCalledTimes(1);
    req.answer(Response.json(body));
    await run;
    void load();
    expect(req.request).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a 503", () => Promise.resolve(new Response(null, { status: 503 }))],
    ["a body outside the closed shape", () => Promise.resolve(Response.json({ ...body, host: "db" }))],
    ["a network failure", () => Promise.reject(new TypeError("failed"))],
  ])("reports %s as a failure", async (_, request) => {
    const e = events();
    await statusLoader(new AbortController().signal, e, request)();
    expect(e.fail).toHaveBeenCalledTimes(1);
    expect(e.ok).not.toHaveBeenCalled();
    expect(e.settled).toHaveBeenCalledTimes(1);
  });

  it("asks nothing once its mount is gone", async () => {
    const c = new AbortController();
    c.abort();
    const request = vi.fn();
    await statusLoader(c.signal, events(), request)();
    expect(request).not.toHaveBeenCalled();
  });

  // Pre-QA of #1975: a request that never answers must not freeze polling and retry.
  it("gives up on a request that hangs, reports a failure and asks again", async () => {
    vi.useFakeTimers();
    try {
      const e = events();
      const req = pending();
      const load = statusLoader(new AbortController().signal, e, req.request);
      const run = load();
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      await run;
      expect(e.fail).toHaveBeenCalledTimes(1);
      expect(e.settled).toHaveBeenCalledTimes(1);
      void load();
      expect(req.request).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Pre-QA of #1979: after sleep the poll timer was paused, so the board must ask on waking.
describe("onWake", () => {
  const setup = () => {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "hidden" });
    const wake = vi.fn();
    const stop = onWake(win, doc, wake);
    return { win, doc, wake, stop };
  };

  it("wakes on pageshow, online and becoming visible, not on becoming hidden", () => {
    const { win, doc, wake } = setup();
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(wake).not.toHaveBeenCalled();
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("pageshow"));
    win.dispatchEvent(new Event("online"));
    expect(wake).toHaveBeenCalledTimes(3);
  });

  it("stops listening once stopped", () => {
    const { win, doc, wake, stop } = setup();
    stop();
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("pageshow"));
    win.dispatchEvent(new Event("online"));
    expect(wake).not.toHaveBeenCalled();
  });
});
