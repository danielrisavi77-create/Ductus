// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { readDocumentHold, submitWhenClear, type DocumentHoldRead } from "./submission-hold";

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
    expect(await submitWhenClear(async () => device, send)).toEqual({ kind: "held", device });
    expect(send).not.toHaveBeenCalled();
  });

  it("a read that fails is unknown and sends nothing", async () => {
    vi.stubGlobal("indexedDB", {});
    const send = vi.fn(async () => "poslano");
    const gated = await submitWhenClear(() => readDocumentHold(SCOPE, DOC, { peek: async () => { throw new Error("x"); } }), send);
    expect(gated).toEqual({ kind: "held", device: "unknown" });
    expect(send).not.toHaveBeenCalled();
  });

  it("a clear device sends once, after the read", async () => {
    const order: string[] = [];
    const send = vi.fn(async () => { order.push("send"); return "poslano"; });
    const gated = await submitWhenClear(async () => { order.push("read"); return "clear" as const; }, send);
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
    expect(await submitWhenClear(() => readDocumentHold(SCOPE, DOC, { peek }), send)).toEqual({ kind: "held", device: "held" });
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

  it("starts in checking and reads the device after every load", () => {
    expect(source).toMatch(/device: "checking"/);
    expect(source).toMatch(/void checkDevice\(opened\.work\.documentId, mine\)/);
  });
});
