// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { watchSessionEnd, type SessionEndEnv, type SessionWatch } from "./session-end";
import { ENDED_KEY, type MarkStore } from "./session-marks";
import { submitWork } from "./submission";
import { readDocumentHold, sendGuard, submitWhenClear, type DocumentHoldRead } from "./submission-hold";

/**
 * DAN-699 (#1876, contract #1836 c.6786016677): the submission is not sent
 * while this device holds text of the work the server does not have, and a
 * read that fails or does not end in time never lets it through. Invented
 * ids only.
 */

const SCOPE = "a".repeat(64);
const DOC = "dokument-izmisljeni";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("readDocumentHold", () => {
  it("reads held and clear from the journal of the scope and the document", async () => {
    vi.stubGlobal("indexedDB", {});
    const asked: [string, string][] = [];
    const peek = async (scope: string, id: string) => { asked.push([scope, id]); return id === DOC; };
    expect(await readDocumentHold(SCOPE, DOC, { peek })).toBe("held");
    expect(await readDocumentHold(SCOPE, "drugi", { peek })).toBe("clear");
    expect(asked).toEqual([[SCOPE, DOC], [SCOPE, "drugi"]]);
  });

  it("without a scope, or with a read that fails, the state is unknown", async () => {
    vi.stubGlobal("indexedDB", {});
    const peek = vi.fn(async () => false);
    expect(await readDocumentHold(null, DOC, { peek })).toBe("unknown");
    expect(peek).not.toHaveBeenCalled();
    expect(await readDocumentHold(SCOPE, DOC, { peek: async () => { throw new Error("blocked"); } })).toBe("unknown");
    expect(await readDocumentHold(SCOPE, DOC, { peek: () => { throw new Error("sync"); } })).toBe("unknown");
  });

  it("a read that does not end in time is unknown", async () => {
    vi.stubGlobal("indexedDB", {});
    vi.useFakeTimers();
    const read = readDocumentHold(SCOPE, DOC, { timeoutMs: 2_000, peek: () => new Promise<boolean>(() => {}) });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await read).toBe("unknown");
  });

  it("a browser without IndexedDB keeps no journal: clear", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const peek = vi.fn(async () => true);
    expect(await readDocumentHold(SCOPE, DOC, { peek })).toBe("clear");
    expect(peek).not.toHaveBeenCalled();
  });
});

describe("submitWhenClear: the negative test of #1876", () => {
  it.each<DocumentHoldRead>(["held", "unknown"])("a device read as %s sends no submission request", async (device) => {
    const send = vi.fn(async () => "poslano");
    expect(await submitWhenClear(async () => device, send, () => true)).toEqual({ kind: "held", device });
    expect(send).not.toHaveBeenCalled();
  });

  it("a read that fails is unknown and sends nothing", async () => {
    vi.stubGlobal("indexedDB", {});
    const send = vi.fn(async () => "poslano");
    const gated = await submitWhenClear(() => readDocumentHold(SCOPE, DOC, { peek: async () => { throw new Error("x"); } }), send, () => true);
    expect(gated).toEqual({ kind: "held", device: "unknown" });
    expect(send).not.toHaveBeenCalled();
  });

  it("a clear device sends once, after the read", async () => {
    const order: string[] = [];
    const send = vi.fn(async () => { order.push("send"); return "poslano"; });
    const gated = await submitWhenClear(async () => { order.push("read"); return "clear" as const; }, send, () => true);
    expect(gated).toEqual({ kind: "sent", outcome: "poslano" });
    expect(order).toEqual(["read", "send"]);
  });

  it("clear when the page loaded, held at the click: no request (text saved after the load)", async () => {
    vi.stubGlobal("indexedDB", {});
    let saved = false;
    const peek = async () => saved;
    expect(await readDocumentHold(SCOPE, DOC, { peek })).toBe("clear");
    saved = true;
    const send = vi.fn(async () => "poslano");
    expect(await submitWhenClear(() => readDocumentHold(SCOPE, DOC, { peek }), send, () => true)).toEqual({ kind: "held", device: "held" });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("Submission.tsx sends the submission only through the device check", () => {
  const source = readFileSync(join(process.cwd(), "src/components/student/Submission.tsx"), "utf8");

  it("calls submitWork once, as the send of submitWhenClear, after reading the device of its document", () => {
    expect(source.match(/submitWork\(/g)).toHaveLength(1);
    expect(source).toMatch(
      /submitWhenClear\(\s*\(\) => readDocumentHold\(scope, work\.documentId\),\s*\(\) => submitWork\(/,
    );
  });

  it("takes one guard at the click and gives the same guard to submitWhenClear and submitWork (review c.6788770331)", () => {
    expect(source).toMatch(/const live = sendGuard\(watchRef, generation\);/);
    expect(source).toMatch(
      /submitWhenClear\(\s*\(\) => readDocumentHold\(scope, work\.documentId\),\s*\(\) => submitWork\(\{ documentId: work\.documentId, revision: work\.currentRevision \}, live\),\s*live,\s*\)/,
    );
  });

  it("starts in checking and reads the device after every load", () => {
    expect(source).toMatch(/device: "checking"/);
    expect(source).toMatch(/void checkDevice\(opened\.work\.documentId, mine\)/);
  });
});

/**
 * Review FAIL c.6788770331 on #1904: the journal read is asynchronous, and in
 * the meantime the page can leave (navigation) and the session can end in
 * another tab. The guard taken at the click lets the request out only while
 * the component that clicked is mounted, its load is the same and its
 * session has not ended. Contract #1836 c.6793797053 (from c.6788890445).
 */
describe("sendGuard: nothing is sent after the component left or the session ended", () => {
  const MARK = { tag: "oznaka-izmisljena", at: 1_000 };
  const INPUT = { documentId: DOC, revision: 3 };

  function memoryStore(): MarkStore {
    const data = new Map<string, string>();
    return {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    };
  }

  /** One mounted Submission as the component holds it: the watcher in a ref, cleared on cleanup. */
  function mounted() {
    const store = memoryStore();
    const env: SessionEndEnv = { store, target: null, openChannel: null };
    const watchRef: { current: SessionWatch | null } = { current: null };
    const generation = { current: 1 };
    const watch = watchSessionEnd(MARK, () => {}, env);
    watchRef.current = watch;
    return {
      watchRef,
      generation,
      // The cleanup of the useLayoutEffect in Submission.tsx.
      unmount: () => {
        watch.close();
        if (watchRef.current === watch) watchRef.current = null;
      },
      endSession: () => store.setItem(ENDED_KEY, JSON.stringify([MARK.tag])),
    };
  }

  function deferredRead() {
    let resolve: (device: DocumentHoldRead) => void = () => {};
    const promise = new Promise<DocumentHoldRead>((r) => { resolve = r; });
    return { read: () => promise, resolve };
  }

  function okFetch() {
    return vi.fn<typeof fetch>(async () => new Response(JSON.stringify({}), { status: 500 }));
  }

  type Row = { component: "mounted" | "removed"; session: "valid" | "ended"; generation: "same" | "changed"; device: DocumentHoldRead };
  const rows: Row[] = [];
  for (const component of ["mounted", "removed"] as const)
    for (const session of ["valid", "ended"] as const)
      for (const generation of ["same", "changed"] as const)
        for (const device of ["clear", "held", "unknown"] as const) rows.push({ component, session, generation, device });

  it("covers all 24 classes", () => {
    expect(rows).toHaveLength(24);
    expect(new Set(rows.map((r) => JSON.stringify(r))).size).toBe(24);
  });

  it.each(rows)("component $component, session $session, generation $generation, device $device", async (row) => {
    const page = mounted();
    const fetcher = okFetch();
    const live = sendGuard(page.watchRef, page.generation);
    const { read, resolve } = deferredRead();
    const gated = submitWhenClear(read, () => submitWork(INPUT, live, fetcher), live);
    // The state changes while the journal is being read.
    if (row.component === "removed") page.unmount();
    if (row.session === "ended") page.endSession();
    if (row.generation === "changed") page.generation.current += 1;
    resolve(row.device);
    const result = await gated;
    const sends = row.component === "mounted" && row.session === "valid" && row.generation === "same" && row.device === "clear";
    expect(fetcher).toHaveBeenCalledTimes(sends ? 1 : 0);
    if (row.device !== "clear") expect(result).toEqual({ kind: "held", device: row.device });
    else expect(result.kind).toBe(sends ? "sent" : "stopped");
  });

  it("a watcher missing at the click never sends", async () => {
    const fetcher = okFetch();
    const live = sendGuard({ current: null }, { current: 1 });
    expect(live()).toBe(false);
    expect(await submitWhenClear(async () => "clear", () => submitWork(INPUT, live, fetcher), live)).toEqual({ kind: "stopped" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("a watcher replaced by a new mount does not send for the old click", async () => {
    const page = mounted();
    const fetcher = okFetch();
    const live = sendGuard(page.watchRef, page.generation);
    page.unmount();
    page.watchRef.current = watchSessionEnd(MARK, () => {}, { store: memoryStore(), target: null, openChannel: null });
    expect(await submitWhenClear(async () => "clear", () => submitWork(INPUT, live, fetcher), live)).toEqual({ kind: "stopped" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("concurrency: delayed read, unmount, session end, then clear: no POST", async () => {
    const page = mounted();
    const fetcher = okFetch();
    const live = sendGuard(page.watchRef, page.generation);
    const { read, resolve } = deferredRead();
    const gated = submitWhenClear(read, () => submitWork(INPUT, live, fetcher), live);
    page.unmount();
    page.endSession();
    // The guard the component used before this fix: true once the ref is null.
    const before = () => !(page.watchRef.current?.ended() ?? false);
    expect(before()).toBe(true);
    resolve("clear");
    expect(await gated).toEqual({ kind: "stopped" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("concurrency: delayed read, unmount alone (session still valid), then clear: no POST", async () => {
    const page = mounted();
    const fetcher = okFetch();
    const live = sendGuard(page.watchRef, page.generation);
    const { read, resolve } = deferredRead();
    const gated = submitWhenClear(read, () => submitWork(INPUT, live, fetcher), live);
    page.unmount();
    resolve("clear");
    expect(await gated).toEqual({ kind: "stopped" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("mounted, valid session, delayed clear: exactly one POST to the submission route", async () => {
    const page = mounted();
    const fetcher = okFetch();
    const live = sendGuard(page.watchRef, page.generation);
    const { read, resolve } = deferredRead();
    const gated = submitWhenClear(read, () => submitWork(INPUT, live, fetcher), live);
    resolve("clear");
    expect((await gated).kind).toBe("sent");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/submission");
  });
});
