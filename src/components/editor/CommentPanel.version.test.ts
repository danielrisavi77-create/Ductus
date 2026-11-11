import { Editor } from "@tiptap/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommentThread, ListOutcome } from "@/client/comments";
import { createTextAnchor } from "@/domain/collaboration";
import { newNodeId, type NodeId } from "@/domain/document";
import { commentHighlightKey } from "@/editor/comment-anchor";
import { createEditorExtensions, NodeIdentity, NODE_ID_ATTRIBUTE } from "@/editor/schema";
import { messagesHr } from "@/lib/i18n/messages.hr";

/**
 * The real CommentPanel after the submission (DAN-215, K7c and K7d; QA FAIL
 * on #1091 c.6726447343): what is drawn in the editor and what stays in the
 * list, together. Only the provider hooks and the comment request are
 * stand-ins; the editor, the placer, the gate and the highlight are the real
 * ones. Synthetic texts and ids only.
 *
 * The suite runs in node without a DOM library, so a DOM just large enough
 * for React to render the panel into is set up below.
 */

const t = messagesHr.comments;

// ---- The provider and the request, driven by the test ----------------------

const local = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    editor: null as unknown,
    /** The provider's saver snapshot; the hook reads it through the real `submittedOf`. */
    snapshot: null as null | Record<string, unknown>,
    listeners,
    set(change: { submitted?: boolean; snapshot?: Record<string, unknown> }) {
      if (change.submitted !== undefined) {
        this.snapshot = { state: "LOCAL_DURABLE", failure: null, capacity: "ok", closedBy: change.submitted ? "submission" : null, refused: false, submitted: change.submitted };
      }
      if (change.snapshot !== undefined) this.snapshot = change.snapshot;
      for (const listener of listeners) listener();
    },
  };
});

vi.mock("./LocalDocument", async () => {
  const { useSyncExternalStore } = await import("react");
  const { submittedOf } = await import("./document-saver");
  const subscribe = (listener: () => void) => {
    local.listeners.add(listener);
    return () => local.listeners.delete(listener);
  };
  return {
    useLocalEditor: () => useSyncExternalStore(subscribe, () => local.editor),
    useLocalSignedOut: () => false,
    // The provider's own rule over the snapshot it holds (`useLocalSubmitted`).
    useLocalSubmitted: () => useSyncExternalStore(subscribe, () => submittedOf(local.snapshot as never)),
  };
});

const list = vi.hoisted(() => ({ next: null as null | Promise<unknown> }));
vi.mock("@/client/comments", async (original) => ({
  ...(await original<typeof import("@/client/comments")>()),
  listComments: vi.fn(() => list.next),
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
  all(tag: string): FakeElement[] {
    return this.childNodes.flatMap((c) => (c instanceof FakeElement ? [...(c.tagName === tag ? [c] : []), ...c.all(tag)] : []));
  }
}

function installDom() {
  const document = new FakeNode(9, "#document") as FakeNode & Record<string, unknown>;
  const body = new FakeElement("body", document);
  Object.assign(document, {
    body,
    documentElement: body,
    activeElement: null,
    createElement: (tag: string) => new FakeElement(tag, document),
    createElementNS: (_ns: string, tag: string) => new FakeElement(tag, document),
    createTextNode: (text: string) => new FakeText(text, document),
    createComment: () => new FakeNode(8, "#comment", document),
  });
  const window = { document, event: undefined, HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {} };
  document.defaultView = window;
  Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
  return document;
}

// ---- The document, the comments and what the panel shows -------------------

const ID = { a: "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa", b: "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb" } as const;
type Letter = keyof typeof ID;
const TEXT: Record<Letter, string> = { a: "Alfa prvi odlomak rada.", b: "Beta drugi odlomak s citatom ovdje." };
const QUOTE: Record<Letter, string> = { a: "prvi", b: "citatom" };

function newEditor(): Editor {
  const extensions = createEditorExtensions().map((e) => (e.name === "nodeIdentity" ? NodeIdentity.configure({ mint: newNodeId }) : e));
  const editor = new Editor({
    element: null,
    extensions,
    content: {
      type: "doc",
      content: (Object.keys(ID) as Letter[]).map((l) => ({ type: "paragraph", attrs: { [NODE_ID_ATTRIBUTE]: ID[l] }, content: [{ type: "text", text: TEXT[l] }] })),
    },
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  // Without a DOM the view is never mounted, and Tiptap reports an editor
  // with no mounted view as destroyed; the panel would then place nothing in
  // any case. In the browser the panel only ever sees a mounted editor, so
  // the editor here counts as live until the test destroys it.
  let destroyed = false;
  editor.on("destroy", () => { destroyed = true; });
  Object.defineProperty(editor, "isDestroyed", { get: () => destroyed });
  return editor;
}

function thread(letter: Letter, number: number): CommentThread {
  const start = TEXT[letter].indexOf(QUOTE[letter]);
  return {
    id: `0000000${number}-1111-4111-8111-111111111111`,
    number,
    state: "open",
    anchor: createTextAnchor({ nodeId: ID[letter] as NodeId, nodeText: TEXT[letter], start, end: start + QUOTE[letter].length }),
    comments: [{ id: `0000000${number}-2222-4222-8222-222222222222`, role: "teacher", isOwn: false, body: `Komentar ${number}.`, createdWindow: "2026-11-02T10:00:00.000Z", deletedWindow: null }],
  };
}

/** Replaces `find` in block `i` of the editor with `by`, as typing would. */
function replaceIn(editor: Editor, i: number, find: string, by: string) {
  let pos = 0;
  for (let k = 0; k < i; k += 1) pos += editor.state.doc.child(k).nodeSize;
  const at = editor.state.doc.child(i).textContent.indexOf(find);
  expect(at).toBeGreaterThanOrEqual(0);
  editor.view.dispatch(editor.state.tr.insertText(by, pos + 1 + at, pos + 1 + at + find.length));
}

/** The texts the highlight draws in the editor right now. */
function marked(editor: Editor): string[] {
  const set = commentHighlightKey.getState(editor.state);
  return (set?.find() ?? []).map((d) => editor.state.doc.textBetween(d.from, d.to));
}

let document: FakeNode & Record<string, unknown>;
let editor: Editor;
let root: Root;
let container: FakeElement;
let fetchSpy: ReturnType<typeof vi.fn>;

/** Every card of the list: its comment and whether it carries the note. */
function cards() {
  return container.all("article").map((a) => ({ body: a.all("p").map((p) => p.textContent).find((x) => x.startsWith("Komentar")), notPlaced: a.textContent.includes(t.notPlaced) }));
}

async function mount() {
  const { default: CommentPanel } = await import("./CommentPanel");
  root = createRoot(container as unknown as Element);
  await act(async () => { root.render(createElement(CommentPanel, { documentId: "dddddddd-0000-4000-8000-dddddddddddd" })); });
}

async function answer(threads: CommentThread[]): Promise<() => Promise<void>> {
  let resolve!: (value: ListOutcome) => void;
  list.next = new Promise<ListOutcome>((r) => { resolve = r; });
  return async () => { await act(async () => { resolve({ kind: "ok", threads }); }); };
}

beforeAll(() => { document = installDom(); });

beforeEach(() => {
  editor = newEditor();
  local.editor = editor;
  local.snapshot = null;
  container = (document.createElement as (tag: string) => FakeElement)("div");
  // A submitted work makes no live request (O2); nothing here may reach the network.
  fetchSpy = vi.fn(() => Promise.reject(new Error("no request expected")));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  editor.destroy();
  vi.unstubAllGlobals();
});

describe("CommentPanel after the submission (DAN-215, K7c/K7d)", () => {
  it("K7c: a mark already shown goes once the work is submitted with a paragraph unlike the submitted one; the thread stays with its note", async () => {
    const land = await answer([thread("b", 1)]);
    await mount();
    await land();
    // The student edits the context of the quote: the anchor still finds it.
    await act(async () => { replaceIn(editor, 1, " ovdje.", " ovdje, i još malo."); });
    expect(marked(editor)).toEqual(["citatom"]);
    expect(cards()).toEqual([{ body: "Komentar 1.", notPlaced: false }]);

    // The work is submitted; the paragraph in the editor is not the submitted one.
    await act(async () => { local.set({ submitted: true }); });
    expect(marked(editor)).toEqual([]);
    expect(cards()).toEqual([{ body: "Komentar 1.", notPlaced: true }]);
    expect(container.all("button").map((b) => b.textContent)).not.toContain(t.showInText);
  });

  it("concurrency: a list answered after an edit that removed the quote draws nothing; the thread stays with its note", async () => {
    const land = await answer([thread("b", 1)]);
    await mount();
    // The request is on its way; the student deletes the quote.
    await act(async () => { replaceIn(editor, 1, "citatom", "navodom"); });
    await land();
    expect(marked(editor)).toEqual([]);
    expect(cards()).toEqual([{ body: "Komentar 1.", notPlaced: true }]);
  });

  it("K7d: submitted, the submitted revision not known: no mark at all, every thread stays, and no live request is made", async () => {
    local.set({ submitted: true });
    const land = await answer([thread("a", 1), thread("b", 2)]);
    await mount();
    await land();
    // Without the gate both would be drawn: the editor text is unchanged.
    expect(marked(editor)).toEqual([]);
    expect(cards()).toEqual([{ body: "Komentar 1.", notPlaced: true }, { body: "Komentar 2.", notPlaced: true }]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("before the submission the same comments are drawn (the test sees marks when there should be some)", async () => {
    const land = await answer([thread("a", 1), thread("b", 2)]);
    await mount();
    await land();
    expect(marked(editor).sort()).toEqual(["citatom", "prvi"]);
    expect(cards()).toEqual([{ body: "Komentar 1.", notPlaced: false }, { body: "Komentar 2.", notPlaced: false }]);
  });
  // Review FAIL codex:cxcr1742 on c09d3dee (c.6726896384): a work submitted
  // elsewhere, reopened from a local record left in a sticky state. The load
  // stops before `closedBy` is set; only the server's `submitted` says it.
  it.each(["CONFLICT", "RECOVERY_REQUIRED"] as const)(
    "submitted, the local record left in %s: no mark on the locally changed paragraph, the thread stays with its note",
    async (state) => {
      local.set({ snapshot: { state, failure: null, capacity: "ok", closedBy: null, refused: false, submitted: true } });
      // The local paragraph differs from the submitted one, the quote still in it.
      replaceIn(editor, 1, " ovdje.", " ovdje, lokalno.");
      const land = await answer([thread("a", 1), thread("b", 2)]);
      await mount();
      await land();
      expect(marked(editor)).toEqual([]);
      expect(cards()).toEqual([{ body: "Komentar 1.", notPlaced: true }, { body: "Komentar 2.", notPlaced: true }]);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("the same sticky record of a work not submitted still draws its marks (the gate is not shut by the sticky state alone)", async () => {
    local.set({ snapshot: { state: "CONFLICT", failure: null, capacity: "ok", closedBy: null, refused: false, submitted: false } });
    const land = await answer([thread("a", 1), thread("b", 2)]);
    await mount();
    await land();
    expect(marked(editor).sort()).toEqual(["citatom", "prvi"]);
  });
});
