import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RevisionListOutcome, RevisionRequest } from "@/client/revision-requests";
import type { NodeId } from "@/domain/document";
import { browserCookieJar, endSessionsInCookie } from "@/client/session-marks";
import { messagesHr } from "@/lib/i18n/messages.hr";

/**
 * The real RevisionPanel when its session ends in another tab while `list` is
 * on the way (review FAIL c.6781317888, QA FAIL c.6781295797 on #1858). The
 * other tab writes only the cookie: this browser has no localStorage and no
 * BroadcastChannel, and no storage or pageshow event reaches the page, so the
 * panel learns of the end only by asking right before it shows the answer.
 * Only the provider hook and the request are stand-ins. Synthetic texts only.
 *
 * The suite runs in node without a DOM library, so a DOM just large enough
 * for React to render the panel into is set up below.
 */

const t = messagesHr.revisions;

vi.mock("./LocalDocument", () => ({
  useLocalSignedOut: () => false,
  useLocalSubmitted: () => false,
  useLocalUnconfirmed: () => ({ unconfirmed: false, now: () => false, edits: () => 0 }),
}));

const list = vi.hoisted(() => ({ calls: 0, resolve: null as null | ((outcome: unknown) => void) }));
const respond = vi.hoisted(() => ({ calls: 0, resolve: null as null | ((outcome: unknown) => void) }));
vi.mock("@/client/revision-requests", async (original) => ({
  ...(await original<typeof import("@/client/revision-requests")>()),
  listRevisionRequests: vi.fn(() => {
    list.calls += 1;
    return new Promise((resolve) => { list.resolve = resolve; });
  }),
  respondRevisionRequest: vi.fn(() => {
    respond.calls += 1;
    return new Promise((resolve) => { respond.resolve = resolve; });
  }),
}));
vi.mock("@/client/evidence-ingest", () => ({
  openWork: vi.fn(async () => ({ status: "opened", work: { submitted: false, currentRevision: 5 } })),
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
}

/** A document whose cookie jar keeps `name=value` pairs, as a browser does. */
function installDom() {
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
  // Listeners are accepted and never called: no storage or pageshow event arrives.
  const window = { document, event: undefined, HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {} };
  document.defaultView = window;
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("location", { protocol: "http:" });
  vi.stubGlobal("localStorage", undefined);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return body;
}

// ---- One request of the session that ends ----------------------------------

const INSTRUCTION = "Dodajte izvor za tvrdnju o gradskim knjižnicama.";
const W = "2026-11-10T10:05:00.000Z";
const request: RevisionRequest = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  number: 1,
  state: "open",
  rowSeq: 3,
  anchor: {
    nodeId: "0f8e2a64-1b3c-4d5e-8f60-718293a4b5c6" as NodeId, quote: "knjižnice", prefix: "Gradske ", suffix: " su",
    startHint: 8, endHint: 17,
  },
  versions: [{
    version: 1, instruction: INSTRUCTION, requestedRevision: 4, openedIsOwn: false, openedWindow: W,
    response: null, closed: null,
  }],
};
const ok: RevisionListOutcome = { kind: "ok", requests: [request] };

let body: FakeElement;
let root: Root;

beforeEach(async () => {
  list.calls = 0;
  list.resolve = null;
  respond.calls = 0;
  respond.resolve = null;
  body = installDom();
  const { default: RevisionPanel } = await import("./RevisionPanel");
  root = createRoot(body as never);
  await act(async () => {
    root.render(createElement(RevisionPanel, { documentId: "doc-1", assignmentId: "asg-1", session: { tag: "sesijaA", at: 1 } }));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function answer(outcome: RevisionListOutcome) {
  expect(list.calls).toBe(1);
  await act(async () => { list.resolve!(outcome); });
}

describe("RevisionPanel: a list that lands after the session ended", () => {
  it("control: in the same session the list is shown", async () => {
    expect(body.textContent).toContain(t.loading);
    await answer(ok);
    expect(body.textContent).toContain(INSTRUCTION);
  });

  it("is dropped when another tab ended the session through the cookie alone", async () => {
    expect(endSessionsInCookie(browserCookieJar(), ["sesijaA"])).toBe(true);
    await answer(ok);
    expect(body.textContent).not.toContain(INSTRUCTION);
    expect(body.textContent).toContain(t.signedOut);
  });

  it("a cookie for another session leaves the list shown", async () => {
    expect(endSessionsInCookie(browserCookieJar(), ["sesijaB"])).toBe(true);
    await answer(ok);
    expect(body.textContent).toContain(INSTRUCTION);
  });
});

// React keeps an element's props on it; the fake DOM dispatches no events, so handlers are called directly.
function propsOf(node: FakeNode): Record<string, (arg?: unknown) => void> {
  const key = Object.keys(node).find((k) => k.startsWith("__reactProps"));
  return (node as unknown as Record<string, Record<string, (arg?: unknown) => void>>)[key!]!;
}
function all(node: FakeNode, tag: string): FakeNode[] {
  return node.childNodes.flatMap((c) => [...(c instanceof FakeElement && c.tagName === tag ? [c] : []), ...all(c, tag)]);
}

const TYPED = "Izvor je dodan u fusnotu 3.";

/** Lists the request, types an explanation and presses "done"; respond is then on the way. */
async function answerOnTheWay() {
  await answer(ok);
  const [textarea] = all(body, "textarea");
  await act(async () => { propsOf(textarea!).onChange!({ target: { value: TYPED } }); });
  const [done] = all(body, "button");
  await act(async () => { propsOf(done!).onClick!(); });
  expect(respond.calls).toBe(1);
}

describe("RevisionPanel: an answer that lands after the session ended (Codex c.4532645041)", () => {
  it("control: in the same session an error keeps the request and the typed explanation", async () => {
    await answerOnTheWay();
    await act(async () => { respond.resolve!({ kind: "unavailable" }); });
    expect(body.textContent).toContain(INSTRUCTION);
    expect(all(body, "textarea").some((n) => propsOf(n).value as unknown === TYPED)).toBe(true);
  });

  for (const outcome of [{ kind: "signedOut" }, { kind: "unavailable" }] as const) {
    it(`a ${outcome.kind} answer after a cookie-only end clears the requests and the explanation`, async () => {
      await answerOnTheWay();
      expect(endSessionsInCookie(browserCookieJar(), ["sesijaA"])).toBe(true);
      await act(async () => { respond.resolve!(outcome); });
      expect(body.textContent).not.toContain(INSTRUCTION);
      expect(all(body, "textarea")).toHaveLength(0);
      expect(body.textContent).toContain(t.signedOut);
    });
  }
});

// ---- A 409 whose list read fails (QA FAIL c.6784961513) --------------------

const fields = () => all(body, "textarea").map((n) => propsOf(n) as unknown as { value: string; readOnly?: boolean });
const button = (label: string) => all(body, "button").find((b) => b.textContent === label);

describe("RevisionPanel: a 409 whose list read fails (QA FAIL c.6784961513)", () => {
  const EXPLANATION = "Tvrdnja se odnosi na primjer iz uvoda.";

  it("keeps the unsent explanation readable and unsendable, and back in the form once the list is read", async () => {
    await answer(ok);
    const [field] = all(body, "textarea");
    await act(async () => { propsOf(field!).onChange!({ target: { value: EXPLANATION } }); });
    await act(async () => { propsOf(button(t.declined)!).onClick!(); });
    expect(respond.calls).toBe(1);
    await act(async () => { respond.resolve!({ kind: "conflict", state: "reopened" }); });
    // The conflict reads the list again by itself, and that read fails.
    expect(list.calls).toBe(2);
    await act(async () => { list.resolve!({ kind: "unavailable" }); });

    expect(body.textContent).toContain(t.unavailable);
    // It says which request it is for, from the list read before (Grok c.6785580350).
    expect(body.textContent).toContain(t.keptForLabel.replace("{n}", "1"));
    expect(body.textContent).toContain(t.keptUnloadedHint);
    expect(fields()).toEqual([expect.objectContaining({ value: EXPLANATION, readOnly: true })]);
    expect(button(t.done)).toBeUndefined();
    expect(button(t.declined)).toBeUndefined();

    // Read again: the card comes back with the same explanation in its form.
    await act(async () => { propsOf(button(t.retry)!).onClick!(); });
    expect(list.calls).toBe(3);
    await act(async () => { list.resolve!(ok); });
    expect(fields()).toEqual([expect.objectContaining({ value: EXPLANATION, readOnly: false })]);
    expect(body.textContent).not.toContain(t.keptUnloadedHint);
    expect(respond.calls).toBe(1);
  });

  it("after a 403 on the list read the same retry brings the explanation back unchanged (QA FAIL c.6786063110)", async () => {
    await answer(ok);
    const [field] = all(body, "textarea");
    await act(async () => { propsOf(field!).onChange!({ target: { value: EXPLANATION } }); });
    await act(async () => { propsOf(button(t.done)!).onClick!(); });
    expect(respond.calls).toBe(1);
    await act(async () => { respond.resolve!({ kind: "conflict", state: "reopened" }); });
    expect(list.calls).toBe(2);
    await act(async () => { list.resolve!({ kind: "forbidden" }); });

    expect(body.textContent).toContain(t.notAvailable);
    expect(fields()).toEqual([expect.objectContaining({ value: EXPLANATION, readOnly: true })]);
    expect(button(t.done)).toBeUndefined();
    expect(button(t.declined)).toBeUndefined();

    // Access is back: the retry reads the list once more, and nothing is sent again.
    await act(async () => { propsOf(button(t.retry)!).onClick!(); });
    expect(list.calls).toBe(3);
    await act(async () => { list.resolve!(ok); });
    expect(fields()).toEqual([expect.objectContaining({ value: EXPLANATION, readOnly: false })]);
    expect(body.textContent).not.toContain(t.keptUnloadedHint);
    expect(respond.calls).toBe(1);
  });
});
