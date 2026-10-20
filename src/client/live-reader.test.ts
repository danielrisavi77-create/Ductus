import { describe, expect, it, vi } from "vitest";

import { REVISION_ZERO_JCS, REVISION_ZERO_SHA256 } from "@/domain/document/revision-zero";
import { canonicalizeJcs } from "@/domain/forensics/jcs";

import {
  LIVE_READ_INTERVAL_MS, LIVE_RETRY_MAX_MS, readLiveState, startLiveReader,
  type LiveView, type VisibilitySource,
} from "./live-reader";

const DOC = "izmisljeni-rad-1";

/** Revision zero with one invented sentence in its paragraph, as exact JCS. */
const withText = (text: string): string => {
  const doc = JSON.parse(REVISION_ZERO_JCS) as { nodes: { children: unknown[] }[] };
  doc.nodes[0]!.children = [{ type: "text", text, marks: [] }];
  return canonicalizeJcs(doc);
};
const sha256 = async (text: string) => [...new Uint8Array(
  await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
)].map((b) => b.toString(16).padStart(2, "0")).join("");

const reply = (status: number, body: string | null = null, etag?: string) =>
  new Response(body, { status, headers: etag === undefined ? {} : { etag: `"${etag}"` } });

describe("readLiveState", () => {
  it("asks the live route without a cookie of its own making and accepts exact JCS whose hash is the ETag", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => reply(200, REVISION_ZERO_JCS, REVISION_ZERO_SHA256));
    const read = await readLiveState("rad/1?x", null, fetcher);
    expect(read).toMatchObject({ kind: "state", hash: REVISION_ZERO_SHA256 });
    expect(read.kind === "state" && read.document.schemaVersion).toBe(1);
    expect(fetcher).toHaveBeenCalledWith("/api/live/rad%2F1%3Fx", {
      method: "GET", headers: { "ductus-protocol": "1" }, credentials: "same-origin", cache: "no-store",
    });
  });

  it("names the document it already holds and reads 304 for that document as unchanged", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => reply(304, null, REVISION_ZERO_SHA256));
    expect(await readLiveState(DOC, REVISION_ZERO_SHA256, fetcher)).toEqual({ kind: "unchanged" });
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      headers: { "ductus-protocol": "1", "if-none-match": `"${REVISION_ZERO_SHA256}"` },
    });
  });

  it("never shows a body that is not the exact document the ETag names", async () => {
    const other = withText("Izmišljena rečenica.");
    const cases: Response[] = [
      reply(200, other, REVISION_ZERO_SHA256),
      reply(200, REVISION_ZERO_JCS),
      reply(200, REVISION_ZERO_JCS, "ABC"),
      reply(200, JSON.stringify(JSON.parse(REVISION_ZERO_JCS), null, 1), REVISION_ZERO_SHA256),
      reply(200, '{"nodes":[],"schemaVersion":2}', await sha256('{"nodes":[],"schemaVersion":2}')),
      reply(200, "", await sha256("")),
    ];
    for (const response of cases) {
      expect(await readLiveState(DOC, null, async () => response)).toEqual({ kind: "unavailable" });
    }
  });

  it("does not take a 304 as unchanged unless it names the document held", async () => {
    expect(await readLiveState(DOC, null, async () => reply(304, null, REVISION_ZERO_SHA256)))
      .toEqual({ kind: "unavailable" });
    expect(await readLiveState(DOC, "a".repeat(64), async () => reply(304, null, REVISION_ZERO_SHA256)))
      .toEqual({ kind: "unavailable" });
  });

  it.each([
    [204, { kind: "empty" }],
    [401, { kind: "signedOut" }],
    [404, { kind: "notFound" }],
    [403, { kind: "unavailable" }],
    [503, { kind: "unavailable" }],
    [500, { kind: "unavailable" }],
  ])("maps %i", async (status, expected) => {
    expect(await readLiveState(DOC, null, async () => reply(status))).toEqual(expected);
  });

  it("reads a failed request as unavailable", async () => {
    expect(await readLiveState(DOC, null, async () => { throw new TypeError("offline"); }))
      .toEqual({ kind: "unavailable" });
  });
});

/** A clock the test advances by hand, and a page whose visibility it sets. */
function harness(responses: (() => Response | Promise<Response>)[]) {
  const timers: { at: number; run: () => void; id: number }[] = [];
  let now = 0;
  let nextId = 0;
  let visible = true;
  let onVisibility: () => void = () => {};
  const views: LiveView[] = [];
  const fetcher = vi.fn<typeof fetch>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next();
  });
  const visibility: VisibilitySource = {
    isVisible: () => visible,
    subscribe: (cb) => { onVisibility = cb; return () => { onVisibility = () => {}; }; },
  };
  const options = {
    documentId: DOC,
    onChange: (view: LiveView) => views.push(view),
    fetcher,
    visibility,
    timers: {
      set: (run: () => void, ms: number) => { const id = ++nextId; timers.push({ at: now + ms, run, id }); return id; },
      clear: (id: unknown) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    },
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    options, views, fetcher, timers,
    /** The delay of the one pending timer, if any. */
    pending: () => (timers.length === 1 ? timers[0]!.at - now : timers.length === 0 ? null : NaN),
    async advance() {
      const t = timers.shift();
      if (!t) throw new Error("no timer");
      now = t.at;
      t.run();
      for (let i = 0; i < 5; i += 1) await flush();
    },
    async setVisible(value: boolean) { visible = value; onVisibility(); for (let i = 0; i < 5; i += 1) await flush(); },
    settle: async () => { for (let i = 0; i < 5; i += 1) await flush(); },
  };
}

describe("startLiveReader", () => {
  it("reads every second, keeps the shown document on 304 and takes each new one", async () => {
    const second = withText("Izmišljena rečenica.");
    const secondHash = await sha256(second);
    const h = harness([
      () => reply(200, REVISION_ZERO_JCS, REVISION_ZERO_SHA256),
      () => reply(304, null, REVISION_ZERO_SHA256),
      () => reply(200, second, secondHash),
    ]);
    const stop = startLiveReader(h.options);
    await h.settle();
    expect(h.views.at(-1)).toMatchObject({ hash: REVISION_ZERO_SHA256, connection: "live", empty: false });
    expect(h.pending()).toBe(LIVE_READ_INTERVAL_MS);
    await h.advance();
    expect(h.views).toHaveLength(1);
    expect(h.fetcher.mock.calls[1]![1]).toMatchObject({ headers: { "if-none-match": `"${REVISION_ZERO_SHA256}"` } });
    await h.advance();
    expect(h.views.at(-1)).toMatchObject({ hash: secondHash, connection: "live" });
    stop();
    expect(h.timers).toHaveLength(0);
  });

  it("keeps the last document through failures and backs off from 2 s doubling to 30 s", async () => {
    const h = harness([
      () => reply(200, REVISION_ZERO_JCS, REVISION_ZERO_SHA256),
      ...Array.from({ length: 6 }, () => () => { throw new TypeError("offline"); }),
      () => reply(304, null, REVISION_ZERO_SHA256),
    ]);
    startLiveReader(h.options);
    await h.settle();
    const delays: (number | null)[] = [];
    for (let i = 0; i < 6; i += 1) {
      await h.advance();
      expect(h.views.at(-1)).toMatchObject({ hash: REVISION_ZERO_SHA256, connection: "retrying" });
      delays.push(h.pending());
    }
    expect(delays).toEqual([2000, 4000, 8000, 16000, LIVE_RETRY_MAX_MS, LIVE_RETRY_MAX_MS]);
    await h.advance();
    expect(h.views.at(-1)).toMatchObject({ hash: REVISION_ZERO_SHA256, connection: "live" });
    expect(h.pending()).toBe(LIVE_READ_INTERVAL_MS);
  });

  it("says when nothing is published yet", async () => {
    const h = harness([() => reply(204)]);
    startLiveReader(h.options);
    await h.settle();
    expect(h.views.at(-1)).toEqual({ document: null, hash: null, empty: true, connection: "live" });
  });

  it.each([
    [401, "signedOut"],
    [404, "notFound"],
  ])("stops for good on %i", async (status, connection) => {
    const h = harness([() => reply(status)]);
    startLiveReader(h.options);
    await h.settle();
    expect(h.views.at(-1)!.connection).toBe(connection);
    expect(h.timers).toHaveLength(0);
    await h.setVisible(false);
    await h.setVisible(true);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });

  it("sends nothing once the sign-in in this browser has ended", async () => {
    const h = harness([]);
    startLiveReader({ ...h.options, current: () => false });
    await h.settle();
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.views.at(-1)!.connection).toBe("signedOut");
  });

  it("pauses while the page is hidden and reads at once when it is shown again", async () => {
    const h = harness([
      () => reply(200, REVISION_ZERO_JCS, REVISION_ZERO_SHA256),
      () => reply(304, null, REVISION_ZERO_SHA256),
    ]);
    startLiveReader(h.options);
    await h.settle();
    await h.setVisible(false);
    await h.advance();
    expect(h.views.at(-1)!.connection).toBe("paused");
    expect(h.timers).toHaveLength(0);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    await h.setVisible(true);
    expect(h.pending()).toBe(0);
    await h.advance();
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.views.at(-1)!.connection).toBe("live");
  });

  it("has one request in flight and ignores an answer that arrives after stop", async () => {
    let release: (r: Response) => void = () => {};
    const h = harness([() => new Promise<Response>((resolve) => { release = resolve; })]);
    const stop = startLiveReader(h.options);
    await h.setVisible(false);
    await h.setVisible(true);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    stop();
    release(reply(200, REVISION_ZERO_JCS, REVISION_ZERO_SHA256));
    await h.settle();
    expect(h.views).toEqual([]);
    expect(h.timers).toHaveLength(0);
  });
});
