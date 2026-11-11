import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBrowserReplayStepsV1 } from "@/adapters/evidence/edit-steps-v1-replay-steps";
import type { ReplayOutcome } from "@/client/replay";
import { browserCookieJar, endSessionsInCookie } from "@/client/session-marks";
import { buildReplayPlayer } from "@/domain/projection/replay-player";
import { buildRecord, jcsOf, recordSchema as schema, startNode as start } from "@/domain/projection/replay-record.fixture";
import { messagesHr } from "@/lib/i18n/messages.hr";

/**
 * The real ReplayView when its session ends (QA FAIL c.6796519106 on #1937):
 * while the record is on the way, and after the work is shown. Only the
 * request is a stand-in; the hook, the session watch and the player are the
 * real ones, over a synthetic record (invented ids, filler text).
 *
 * The suite runs in node without a DOM library, so a DOM just large enough
 * for React to render the view into is set up below, as in
 * RevisionPanel.session.test.ts.
 */

const t = messagesHr.replay;

const load = vi.hoisted(() => ({
  calls: 0,
  resolve: null as null | ((outcome: unknown) => void),
  current: null as null | (() => boolean),
}));
vi.mock("@/client/replay", async (original) => ({
  ...(await original<typeof import("@/client/replay")>()),
  loadReplay: vi.fn((_documentId: string, current: () => boolean) => {
    load.calls += 1;
    load.current = current;
    return new Promise((resolve) => { load.resolve = resolve; });
  }),
}));

// ---- A DOM just large enough for React -------------------------------------

class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  constructor(readonly nodeType: number, readonly nodeName: string, public ownerDocument: unknown = null) {}
  get firstChild(): FakeNode | null { return this.childNodes[0] ?? null; }
  get lastChild(): FakeNode | null { return this.childNodes.at(-1) ?? null; }
  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  appendChild(child: FakeNode) { return this.insertBefore(child, null); }
  insertBefore(child: FakeNode, before: FakeNode | null) {
    child.parentNode?.removeChild(child);
    const at = before ? this.childNodes.indexOf(before) : -1;
    if (at < 0) this.childNodes.push(child); else this.childNodes.splice(at, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child: FakeNode) {
    this.childNodes = this.childNodes.filter((c) => c !== child);
    child.parentNode = null;
    return child;
  }
  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(value: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (value) this.appendChild(new FakeText(value, this.ownerDocument));
  }
  addEventListener() {}
  removeEventListener() {}
}

class FakeText extends FakeNode {
  constructor(public nodeValue: string, ownerDocument: unknown) { super(3, "#text", ownerDocument); }
  get data() { return this.nodeValue; }
  override get textContent() { return this.nodeValue; }
  override set textContent(value: string) { this.nodeValue = value; }
}

class FakeElement extends FakeNode {
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, unknown> = { setProperty() {}, removeProperty() {} };
  constructor(readonly tagName: string, ownerDocument: unknown) { super(1, tagName.toUpperCase(), ownerDocument); }
  setAttribute(name: string, value: unknown) { this.attributes.set(name, String(value)); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  // Just enough of a select for React to mark the chosen option.
  selected = false;
  defaultSelected = false;
  private own: string | null = null;
  get value(): string { return this.own ?? this.attributes.get("value") ?? this.textContent; }
  set value(value: string) { this.own = String(value); }
  get options(): FakeElement[] {
    return this.childNodes.filter((c): c is FakeElement => c instanceof FakeElement && c.tagName === "option");
  }
}

/** A channel the test speaks on in place of another tab; one per session watch. */
class FakeChannel {
  static open: FakeChannel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(readonly name: string) { FakeChannel.open.push(this); }
  close() { this.closed = true; }
}

/** Window listeners by event name; the test fires them as the browser would. */
const heard = new Map<string, Set<() => void>>();
const fire = (type: string) => { for (const listener of heard.get(type) ?? []) listener(); };

/** A document whose cookie jar keeps `name=value` pairs, as a browser does. */
function installDom(withChannel: boolean) {
  const document = new FakeNode(9, "#document") as FakeNode & Record<string, unknown>;
  const body = new FakeElement("body", document);
  const cookies = new Map<string, string>();
  Object.assign(document, {
    body,
    documentElement: body,
    activeElement: null,
    createElement: (tag: string) => new FakeElement(tag, document),
    createElementNS: (_ns: string, tag: string) => new FakeElement(tag, document),
    createTextNode: (text: string) => new FakeText(text, document),
    createComment: () => new FakeNode(8, "#comment", document),
  });
  Object.defineProperty(document, "cookie", {
    get: () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    set: (cookie: string) => {
      const [pair = ""] = cookie.split(";");
      const at = pair.indexOf("=");
      cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    },
  });
  heard.clear();
  const window = {
    document, event: undefined, HTMLIFrameElement: class {},
    addEventListener: (type: string, listener: () => void) => {
      heard.set(type, (heard.get(type) ?? new Set()).add(listener));
    },
    removeEventListener: (type: string, listener: () => void) => { heard.get(type)?.delete(listener); },
  };
  document.defaultView = window;
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("location", { protocol: "http:" });
  vi.stubGlobal("localStorage", undefined);
  vi.stubGlobal("BroadcastChannel", withChannel ? FakeChannel : undefined);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return body;
}

// ---- One verified record of the session that ends --------------------------

const TYPED = "Dodano";
async function okOutcome(): Promise<ReplayOutcome> {
  const r = buildRecord(start, [{ at: "10:00", events: [{ edit: (tr) => { tr.insert(17, schema.text(TYPED)); } }] }]);
  const player = await buildReplayPlayer(
    { startDocument: jcsOf(start), segments: r.segments, head: r.head, resumeDocuments: {} }, createBrowserReplayStepsV1());
  if (!player.ok) throw new Error(player.reason);
  return { kind: "ok", player };
}

let body: FakeElement;
let root: Root;

async function mount(withChannel = false) {
  load.calls = 0;
  load.resolve = null;
  load.current = null;
  FakeChannel.open = [];
  body = installDom(withChannel);
  const { default: ReplayView } = await import("./ReplayView");
  root = createRoot(body as never);
  await act(async () => {
    root.render(createElement(ReplayView, { documentId: "doc-test-z1", session: { tag: "sesijaA", at: 1 }, student: true }));
  });
  expect(load.calls).toBe(1);
}

async function answer(outcome: ReplayOutcome) {
  await act(async () => { load.resolve!(outcome); });
}

beforeEach(() => { heard.clear(); });

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("ReplayView: the session ends while the record is on the way", () => {
  it("control: in the same session the work is shown and current() stays true", async () => {
    await mount();
    expect(body.textContent).toContain(t.loading);
    expect(load.current!()).toBe(true);
    await answer(await okOutcome());
    expect(body.textContent).toContain(TYPED);
    expect(body.textContent).not.toContain(t.signedOut);
  });

  it("a late answer after a cookie-only end is never shown, and nothing more is asked", async () => {
    await mount();
    const outcome = await okOutcome();
    expect(endSessionsInCookie(browserCookieJar(), ["sesijaA"])).toBe(true);
    // No event reaches the page: the view learns of the end only by asking.
    await answer(outcome);
    expect(body.textContent).not.toContain(TYPED);
    expect(body.textContent).toContain(t.signedOut);
    expect(load.calls).toBe(1);
  });

  it("current() handed to loadReplay is false once the session has ended", async () => {
    await mount();
    expect(load.current!()).toBe(true);
    expect(endSessionsInCookie(browserCookieJar(), ["sesijaA"])).toBe(true);
    let ended = true;
    await act(async () => { ended = load.current!(); });
    expect(ended).toBe(false);
    expect(body.textContent).toContain(t.signedOut);
    expect(load.calls).toBe(1);
  });

  it("a cookie for another session leaves the work shown", async () => {
    await mount();
    expect(endSessionsInCookie(browserCookieJar(), ["sesijaB"])).toBe(true);
    await answer(await okOutcome());
    expect(body.textContent).toContain(TYPED);
    expect(load.current!()).toBe(true);
  });
});

describe("ReplayView: the session ends after the work is shown", () => {
  it("a sign-out in another tab (channel) takes the work off the page and asks nothing more", async () => {
    await mount(true);
    await answer(await okOutcome());
    expect(body.textContent).toContain(TYPED);
    const channel = FakeChannel.open.find((c) => !c.closed);
    expect(channel).toBeDefined();
    await act(async () => { channel!.onmessage!({ data: "sesijaA" }); });
    expect(body.textContent).not.toContain(TYPED);
    expect(body.textContent).toContain(t.signedOut);
    expect(load.calls).toBe(1);
    expect(load.current!()).toBe(false);
  });

  for (const event of ["storage", "pageshow"]) {
    it(`a cookie-only end heard through a ${event} event does the same`, async () => {
      await mount();
      await answer(await okOutcome());
      expect(body.textContent).toContain(TYPED);
      expect(endSessionsInCookie(browserCookieJar(), ["sesijaA"])).toBe(true);
      await act(async () => { fire(event); });
      expect(body.textContent).not.toContain(TYPED);
      expect(body.textContent).toContain(t.signedOut);
      expect(load.calls).toBe(1);
    });
  }
});
