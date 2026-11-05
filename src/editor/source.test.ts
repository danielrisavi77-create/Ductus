// @vitest-environment node
import { Editor } from "@tiptap/core";
import { Fragment, Slice, type Node as PmNode } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { describe, expect, it, vi } from "vitest";

import { createEditStepsV1Replayer } from "@/adapters/evidence/edit-steps-v1-replayer";
import { verifyCanonicalEvidencePayloadV2 } from "@/domain/forensics/evidence-chain-v2";
import { replayEvidenceSegmentsV2 } from "@/domain/forensics/evidence-replay-v2";
import { writeSource } from "@/components/editor/sources";
import type { EvidenceSegment, EvidenceSource } from "@/domain/forensics/evidence-segment-v2";
import type { JcsJsonValue } from "@/domain/forensics/jcs";
import { projectProcessSummary } from "@/domain/projection/process-summary";

import { changeOf, EvidenceRecorder, type BuiltSegment, type SegmentContext } from "./capture";
import { tiptapToCanonical } from "./interop";
import { createEditorExtensions } from "./schema";
import { CITATION_FORM_META, NO_OBSERVATION, recordWithSource, SourceObserver, sourceOfChange, type SourceObservation } from "./source";

/**
 * F-8 step 3d-1c (Q1, DAN-287; contract #476 issuecomment-6385376486 with
 * addenda 6385389840 and 6385392797). Every scenario runs on the real editor
 * of src/editor/ with history; the observer's props get event objects, and
 * the transactions are shaped as prosemirror-view 1.42.6 sends them. Oracles:
 * replay #391 and the process summary (P-02 = 200). Synthetic text and ids only.
 */

const IDS = ["a", "b", "c"].map((x) => `${x.repeat(8)}-0000-4000-8000-${x.repeat(12)}`);
const T0 = Date.parse("2026-10-24T09:00:00.000Z");
const CONTEXT: SegmentContext = {
  documentId: "dokument-izmisljeni",
  sessionId: "11111111-1111-4111-8111-111111111111",
  segmentId: "22222222-2222-4222-8222-222222222222",
  evidenceProfileId: "profil-izmisljeni",
  sequenceFrom: 1,
  predecessorSegmentHash: null,
};
const THRESHOLDS = { sessionBreakAboveMinutes: 30, pasteListedAboveCharacters: 200 };

type Spy = { preventDefault: ReturnType<typeof vi.fn> };
type Options = { trusted?: boolean };

/** The end of the browser task: the observer clears what it saw with `setTimeout(0)`. */
const endTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function keyEvent(name: string, ctrl = false, shift = false, trusted = true) {
  const code = [...name].length === 1 ? name.toUpperCase().charCodeAt(0) : { Enter: 13, Backspace: 8, Delete: 46 }[name] ?? 0;
  return {
    type: "keydown", key: name, keyCode: code, which: code, ctrlKey: ctrl, shiftKey: shift, altKey: false, metaKey: false,
    isTrusted: trusted, preventDefault: vi.fn(), stopPropagation() {},
  } as unknown as KeyboardEvent & Spy;
}

const domEvent = <T,>(type: string, trusted: boolean, extra: Record<string, unknown> = {}) =>
  ({ type, isTrusted: trusted, preventDefault: vi.fn(), defaultPrevented: false, ...extra }) as unknown as T & Spy;

function paragraphs(texts: readonly string[]) {
  return {
    type: "doc",
    content: texts.map((text, i) => ({ type: "paragraph", attrs: { nodeId: IDS[i] }, content: text ? [{ type: "text", text }] : [] })),
  };
}

function canonical(editor: Editor): JcsJsonValue {
  const candidate = tiptapToCanonical(editor.getJSON());
  if (!candidate.ok) throw new Error("test document is not canonical");
  return candidate.doc as unknown as JcsJsonValue;
}

/**
 * An editor with the observer whose every change goes through
 * `recordWithSource`, and the DOM paths of prosemirror-view it would take.
 * `observer: false` leaves the observer out (QA t. 9).
 */
function setup(texts: readonly string[] = ["Odlomak izmisljen jedan", "Odlomak izmisljen dva"], observe = true) {
  const observer = new SourceObserver();
  const editor = new Editor({
    element: null,
    extensions: [...createEditorExtensions(), ...(observe ? [observer.extension] : [])],
    content: paragraphs(texts),
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  const view = editor.view;
  const recorder = new EvidenceRecorder();
  const initial = canonical(editor);
  const sources: EvidenceSource[] = [];
  const changes: { transactions: Transaction[]; at: number }[] = [];
  let at = T0 + 5_000;
  editor.on("transaction", ({ transaction, appendedTransactions }) => {
    const all: Transaction[] = [transaction, ...appendedTransactions];
    const source = recordWithSource(recorder, all, observer.take(all), at);
    if (source !== null) {
      sources.push(source);
      changes.push({ transactions: all, at });
    }
  });
  // `view.someProp` of prosemirror-view: every plugin in order, until one says it handled the event.
  type Props = Record<string, ((...args: unknown[]) => unknown) | Record<string, (...args: unknown[]) => unknown> | undefined>;
  const someProp = (name: string, call: (prop: (...args: unknown[]) => unknown) => unknown) =>
    editor.state.plugins.some((plugin) => {
      const prop = (plugin.props as unknown as Props)[name];
      return typeof prop === "function" ? Boolean(call(prop.bind(plugin))) : false;
    });
  const domHandler = (type: string, event: Event) =>
    editor.state.plugins.some((plugin) => {
      const handler = ((plugin.props as unknown as Props).handleDOMEvents as Record<string, (...args: unknown[]) => unknown> | undefined)?.[type];
      return handler ? Boolean(handler.call(plugin, view, event)) || event.defaultPrevented : false;
    });
  const t = {
    someProp, editor, view, observer, recorder, initial, sources, changes,
    wait(ms: number) {
      at += ms;
    },
    /** A keydown as prosemirror-view hands it on: the observer first, then the keymaps. */
    key(name: string, ctrl = false, shift = false, trusted = true) {
      return someProp("handleKeyDown", (f) => f(view, keyEvent(name, ctrl, shift, trusted)));
    },
    /** A `beforeinput`; `replacement` is the text a browser puts in `dataTransfer` when `data` is null. */
    beforeinput(inputType: string, data: string | null, trusted = true, replacement?: string) {
      const dataTransfer = replacement === undefined ? null : { getData: (type: string) => (type === "text/plain" ? replacement : "") };
      domHandler("beforeinput", domEvent<InputEvent>("beforeinput", trusted, { inputType, data, dataTransfer }));
    },
    composition(type: "compositionstart" | "compositionend", trusted = true, data = "") {
      domHandler(type, domEvent<CompositionEvent>(type, trusted, { data }));
    },
    /** A spelling suggestion picked in the browser: Chromium gives the text in `dataTransfer`, not in `data`. */
    replace(text: string, trusted = true) {
      t.beforeinput("insertReplacementText", null, trusted, text);
    },
    /** One character from the keyboard: keydown, beforeinput insertText, then the DOM change. */
    typeChar(char: string, { key = true, keyTrusted = true, inputTrusted = true } = {}) {
      if (key) t.key(char, false, false, keyTrusted);
      t.beforeinput("insertText", char, inputTrusted);
      view.dispatch(editor.state.tr.insertText(char));
    },
    /** `doPaste` of prosemirror-view: handlePaste, then replaceSelection with `paste` and `uiEvent`. */
    paste(slice: Slice, { trusted = true }: Options = {}) {
      const event = domEvent<ClipboardEvent>("paste", trusted, { clipboardData: { getData: () => "" } });
      if (domHandler("paste", event)) return event;
      if (someProp("handlePaste", (f) => f(view, event, slice))) return event;
      view.dispatch(editor.state.tr.replaceSelection(slice).scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
      return event;
    },
    pasteText(text: string, options: Options = {}) {
      return t.paste(new Slice(Fragment.from(editor.schema.text(text)), 0, 0), options);
    },
    /** `editHandlers.cut` of prosemirror-view. */
    cut({ trusted = true }: Options = {}) {
      const event = domEvent<ClipboardEvent>("cut", trusted);
      if (domHandler("cut", event)) return event;
      view.dispatch(editor.state.tr.deleteSelection().scrollIntoView().setMeta("uiEvent", "cut"));
      return event;
    },
    /** `handleDrop` of prosemirror-view: with `moved`, deleting and inserting are one transaction. */
    drop(slice: Slice, insertPos: number, moved: boolean, { trusted = true }: Options = {}) {
      const event = domEvent<DragEvent>("drop", trusted);
      if (someProp("handleDrop", (f) => f(view, event, slice, moved))) return event;
      const tr = editor.state.tr;
      if (moved) tr.deleteSelection();
      const pos = tr.mapping.map(insertPos);
      tr.replaceRange(pos, pos, slice);
      view.dispatch(tr.setMeta("uiEvent", "drop"));
      return event;
    },
    select(from: number, to = from) {
      view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
    },
  };
  return t;
}

type Setup = ReturnType<typeof setup>;

/** Every segment the recorder gives. */
async function takeAll(recorder: EvidenceRecorder): Promise<BuiltSegment[]> {
  recorder.close();
  const segments: BuiltSegment[] = [];
  let context = CONTEXT;
  for (let built = await recorder.takeSegment(context); built; built = await recorder.takeSegment(context)) {
    segments.push(built);
    context = { ...CONTEXT, sequenceFrom: built.segment.sequenceTo + 1, predecessorSegmentHash: built.sha256 };
  }
  return segments;
}

/**
 * The fixed QA criterion: the recorder is intact, every segment verifies,
 * replay #391 gives its `finalDocumentHash` and the editor's document. Returns
 * the events' sources and the process summary.
 */
async function check(t: Setup) {
  const built = await takeAll(t.recorder);
  expect(t.recorder.intact).toBe(true);
  const segments: EvidenceSegment[] = [];
  for (const one of built) {
    const payload = await verifyCanonicalEvidencePayloadV2(one.bytes);
    expect(payload.ok).toBe(true);
    if (payload.ok) segments.push(payload.segment);
  }
  expect(segments.length).toBeGreaterThan(0);
  const replay = await replayEvidenceSegmentsV2(t.initial, segments, createEditStepsV1Replayer());
  expect(replay).toMatchObject({ ok: true, documentSha256: segments.at(-1)!.finalDocumentHash });
  const replayer = createEditStepsV1Replayer();
  const rebuilt = segments.flatMap((s) => s.events).reduce((doc, event) => replayer.apply(doc, event), replayer.load(t.initial));
  expect(replayer.toCanonical(rebuilt)).toEqual(canonical(t.editor));
  const summary = await projectProcessSummary({
    payloads: built.map((one) => one.bytes),
    head: { segmentHash: built.at(-1)!.sha256, segmentCount: built.length },
    thresholds: THRESHOLDS,
  });
  if (!summary.ok) throw new Error(`summary: ${summary.reason}`);
  return { built, events: segments.flatMap((s) => s.events), sources: segments.flatMap((s) => s.events.map((e) => e.source)), pastes: summary.summary.pastes };
}

const text = (n: number) => "Izmisljeno lijepljenje ".repeat(Math.ceil(n / 23)).slice(0, n);

/** Three paragraphs and a heading with bold and italic, without ids (as `transformPasted` leaves them). */
function htmlSlice(editor: Editor): Slice {
  const s = editor.schema;
  const bold = s.marks.bold!.create();
  const italic = s.marks.italic!.create();
  const blocks: PmNode[] = [
    s.nodes.paragraph!.create(null, [s.text("Prvi "), s.text("podebljan", [bold])]),
    s.nodes.heading!.create({ level: 2 }, s.text("Naslov izmisljen")),
    s.nodes.paragraph!.create(null, [s.text("kurziv", [italic]), s.text(" i **jos** jedan")]),
    s.nodes.paragraph!.create(null, s.text("Zadnji")),
  ];
  return new Slice(Fragment.from(blocks), 1, 1);
}

describe("3d-1c QA t. 1: pasting plain text", () => {
  it.each([
    ["in the middle of a paragraph", ["Odlomak izmisljen jedan"], 9],
    ["at the start of a block", ["Odlomak izmisljen jedan"], 1],
    ["at the end of a block", ["Odlomak izmisljen jedan"], 24],
    ["in an empty document", [""], 1],
  ])("250 characters %s are one paste event, listed with 250 characters; 50 are smallerCount 1", async (_name, texts, pos) => {
    const t = setup(texts);
    t.select(pos);
    t.pasteText(text(250));
    await endTask();
    t.wait(1_000);
    t.select(pos);
    t.pasteText(text(50));
    const { sources, pastes } = await check(t);
    expect(sources).toEqual(["paste", "paste"]);
    expect(pastes.listed.map((p) => p.characters)).toEqual([250]);
    expect(pastes.smallerCount).toBe(1);
  });
});

describe("3d-1c QA t. 2: pasting HTML", () => {
  it("three paragraphs and a heading with bold and italic, without ids, are one paste event with the appended steps", async () => {
    const t = setup();
    t.select(9);
    t.paste(htmlSlice(t.editor));
    expect(t.changes).toHaveLength(1);
    expect(t.changes[0]!.transactions.length).toBeGreaterThan(1);
    const { sources, events } = await check(t);
    expect(sources).toEqual(["paste"]);
    expect(events[0]!.steps.some((step) => step.stepType === "attr")).toBe(true);
    // The paste rule of Tiptap made **jos** bold in the appended transaction.
    expect(JSON.stringify(t.editor.getJSON())).toContain('"marks":[{"type":"bold"}],"text":"jos"');
  });
});

describe("3d-1c QA t. 3: pasting over a selection across blocks", () => {
  it.each([
    ["from the middle of a block to the middle of the next", 5, 30],
    ["from the start of a block to the middle of the next", 26, 52],
    ["from the whole first block to part of a later one", 1, 52],
  ])("%s, plain text and HTML, is paste and intact", async (_name, from, to) => {
    for (const kind of ["plain", "html"] as const) {
      const t = setup(["Odlomak izmisljen jedan", "Odlomak izmisljen dva", "Odlomak izmisljen tri"]);
      t.select(from, to);
      if (kind === "plain") t.pasteText("zamjena izmisljena");
      else t.paste(htmlSlice(t.editor));
      const { sources } = await check(t);
      expect(sources, kind).toEqual(["paste"]);
    }
  });
});

describe("3d-1c QA t. 4: dropping", () => {
  it("moving a word from one paragraph to another is one drop transaction and one drop event", async () => {
    const t = setup();
    t.select(9, 18);
    const slice = t.editor.state.selection.content();
    t.drop(slice, 34, true);
    expect(t.changes[0]!.transactions[0]!.steps.length).toBeGreaterThanOrEqual(2);
    const { sources, pastes } = await check(t);
    expect(sources).toEqual(["drop"]);
    expect(pastes.listed).toEqual([]);
    expect(pastes.smallerCount).toBe(0);
  });

  it("text dropped from outside is a drop event and no paste in the summary", async () => {
    const t = setup();
    t.drop(new Slice(Fragment.from(t.editor.schema.text(text(250))), 0, 0), 5, false);
    const { sources, pastes } = await check(t);
    expect(sources).toEqual(["drop"]);
    expect(pastes).toMatchObject({ listed: [], smallerCount: 0 });
  });
});

describe("3d-1c QA t. 5: Undo after a paste", () => {
  it("Ctrl+Z and Ctrl+Y after a paste are unattributed, and the summary has one paste", async () => {
    const t = setup();
    t.select(9);
    t.pasteText(text(250));
    await endTask();
    t.wait(1_000);
    expect(t.key("z", true)).toBe(true);
    await endTask();
    t.wait(1_000);
    expect(t.key("y", true)).toBe(true);
    const { sources, pastes } = await check(t);
    expect(sources).toEqual(["paste", "unattributed", "unattributed"]);
    expect(pastes.listed).toHaveLength(1);
    expect(pastes.smallerCount).toBe(0);
  });

  it("Undo from the toolbar after a paste is unattributed", async () => {
    const t = setup();
    t.select(9);
    t.pasteText(text(250));
    await endTask();
    t.wait(1_000);
    t.editor.commands.undo();
    await endTask();
    t.wait(1_000);
    t.editor.commands.redo();
    const { sources, pastes } = await check(t);
    expect(sources).toEqual(["paste", "unattributed", "unattributed"]);
    expect(pastes.listed).toHaveLength(1);
  });

  it("Undo of typing in the same task as a trusted Enter is still unattributed", async () => {
    const t = setup();
    t.select(9);
    t.typeChar("a");
    await endTask();
    t.wait(1_000);
    t.key("Enter");
    t.editor.commands.undo();
    expect(t.sources).toEqual(["editor", "editor", "unattributed"]);
  });
});

describe("3d-1c QA t. 6: pastes are events of their own", () => {
  it("two pastes within 400 ms are two events, never summed", async () => {
    const t = setup();
    t.select(9);
    t.pasteText(text(150));
    await endTask();
    t.wait(100);
    t.pasteText(text(150));
    const { sources, pastes } = await check(t);
    expect(sources).toEqual(["paste", "paste"]);
    expect(pastes.listed).toEqual([]);
    expect(pastes.smallerCount).toBe(2);
  });

  it("typing right after a paste is a new editor event", async () => {
    const t = setup();
    t.select(9);
    t.typeChar("x");
    await endTask();
    t.wait(50);
    t.pasteText(text(30));
    await endTask();
    t.wait(50);
    t.typeChar("y");
    const { sources } = await check(t);
    expect(sources).toEqual(["editor", "paste", "editor"]);
  });

  it("a paste, cut or drop of the same source as the open event does not join it", async () => {
    for (const source of ["paste", "cut", "drop"] as const) {
      const t = setup();
      const observation: SourceObservation = { ...NO_OBSERVATION, clipboard: source };
      const tr1 = t.editor.state.tr.insertText("a", 9).setMeta("uiEvent", source);
      t.view.updateState(t.editor.state.apply(tr1));
      recordWithSource(t.recorder, [tr1], observation, T0);
      const tr2 = t.editor.state.tr.insertText("b", 10).setMeta("uiEvent", source);
      t.view.updateState(t.editor.state.apply(tr2));
      recordWithSource(t.recorder, [tr2], observation, T0 + 10);
      expect(t.recorder.pendingEvents, source).toBe(2);
    }
  });
});

// DAN-343, contract on #866 (`issuecomment-6423076996`): the Literatura form's text is `citation-form`.
describe("citation-form", () => {
  const BOOK_ENTRY = "Horvat, Ana (2021) Izmisljena knjiga. Zagreb: Primjer.";

  it("writeSource is one citation-form event, apart from typing before and after", async () => {
    const t = setup();
    t.select(9);
    t.typeChar("x");
    await endTask();
    t.wait(50);
    expect(writeSource(t.editor, "(Horvat, 2021: 15)", BOOK_ENTRY)).toBe(true);
    await endTask();
    t.wait(50);
    t.typeChar("y");
    const { sources, built, pastes } = await check(t);
    expect(sources).toEqual(["editor", "citation-form", "editor"]);
    expect(built.map((one) => one.segment.evidenceSchema)).toContain("ductus-evidence-segment-v3");
    // Not a paste: the summary and the quick path count no paste for it (contract t. 4).
    expect(pastes.listed).toEqual([]);
    expect(pastes.smallerCount).toBe(0);
  });

  it("a long entry from the form is no paste in the summary", async () => {
    const t = setup();
    t.select(9);
    expect(writeSource(t.editor, null, `Horvat, Ana (2021) ${"Izmisljena knjiga ".repeat(28)}`)).toBe(true);
    const { sources, pastes } = await check(t);
    expect(sources).toEqual(["citation-form"]);
    expect(pastes.listed).toEqual([]);
    expect(pastes.smallerCount).toBe(0);
  });

  // Review on #866 (cxr866): with Ctrl+A the end of the selection is the document itself.
  it("with everything selected the citation goes at the end of the last paragraph and evidence stays intact", async () => {
    const t = setup();
    t.editor.commands.selectAll();
    expect(writeSource(t.editor, "(Horvat, 2021: 15)", BOOK_ENTRY)).toBe(true);
    const { sources } = await check(t);
    expect(sources).toEqual(["citation-form"]);
    const doc = t.editor.state.doc;
    expect(doc.child(1).textContent).toBe("Odlomak izmisljen dva(Horvat, 2021: 15)");
    expect(doc.child(2).textContent).toBe("Literatura");
    expect(doc.child(3).textContent).toBe(BOOK_ENTRY);
    expect(doc.childCount).toBe(4);
  });

  it("Undo of the form's text is unattributed", async () => {
    const t = setup();
    t.select(9);
    writeSource(t.editor, "(Horvat, 2021)", null);
    await endTask();
    t.wait(50);
    t.editor.commands.undo();
    const { sources } = await check(t);
    expect(sources).toEqual(["citation-form", "unattributed"]);
  });

  it("the mark next to a clipboard event never gives citation-form", () => {
    const t = setup();
    for (const clipboard of [null, "paste"] as const) {
      const tr = t.editor.state.tr.insertText("a", 9).setMeta(CITATION_FORM_META, true).setMeta("uiEvent", "paste");
      expect(sourceOfChange([tr], { ...NO_OBSERVATION, clipboard })).toBe(clipboard ?? "unattributed");
    }
    const plain = t.editor.state.tr.insertText("a", 9);
    expect(sourceOfChange([plain], NO_OBSERVATION)).toBe("unattributed");
  });
});

describe("3d-1c QA t. 7: untrusted or no event", () => {
  it.each([
    ["an untrusted paste", (t: Setup) => t.pasteText(text(250), { trusted: false })],
    ["pasteHTML without a trusted event", (t: Setup) => t.paste(htmlSlice(t.editor), { trusted: false })],
    ["an untrusted drop", (t: Setup) => t.drop(new Slice(Fragment.from(t.editor.schema.text(text(250))), 0, 0), 5, false, { trusted: false })],
    ["an untrusted cut", (t: Setup) => { t.select(1, 8); t.cut({ trusted: false }); }],
    ["insertContent with uiEvent paste", (t: Setup) => t.editor.chain().setMeta("uiEvent", "paste").insertContent({ type: "text", text: text(250) }).run()],
  ])("%s is unattributed, and the summary has no paste", async (_name, act) => {
    const t = setup();
    t.select(9);
    act(t);
    const { sources, pastes } = await check(t);
    expect(sources).toEqual(["unattributed"]);
    expect(pastes).toMatchObject({ listed: [], smallerCount: 0 });
  });

  it("a trusted event of another kind does not make a paste", async () => {
    const t = setup();
    t.select(1, 8);
    t.cut();
    t.pasteText("x", { trusted: false });
    expect(t.sources).toEqual(["cut", "unattributed"]);
  });

  it("a paste in the same task as a trusted Enter and a typed key is paste, never editor (rule 2 before 5)", async () => {
    const t = setup();
    t.select(9);
    t.key("Enter");
    t.typeChar("a");
    t.pasteText(text(30));
    t.pasteText(text(30), { trusted: false });
    // The trusted paste is taken by its own change; the untrusted one after it has nothing (F-127).
    expect(t.sources).toEqual(["editor", "editor", "paste", "unattributed"]);
    await endTask();
    t.key("Enter");
    t.typeChar("b");
    t.select(1, 4);
    t.cut({ trusted: false });
    expect(t.sources.slice(4)).toEqual(["editor", "editor", "unattributed"]);
  });
});

describe("3d-1c QA t. 8: the rest of the table", () => {
  it.each(["a", "č", "ć", "ž", "š", "đ", "Č", " "])("a trusted keydown and insertText %j is editor", async (char) => {
    const t = setup();
    t.select(9);
    t.typeChar(char);
    expect((await check(t)).sources).toEqual(["editor"]);
  });

  it.each([
    ["Enter", (t: Setup) => t.key("Enter")],
    // In the middle of text no keymap takes Backspace or Delete: the browser deletes, in the same task.
    ["Backspace", (t: Setup) => { if (!t.key("Backspace")) t.view.dispatch(t.editor.state.tr.delete(8, 9)); }],
    ["Delete", (t: Setup) => { if (!t.key("Delete")) t.view.dispatch(t.editor.state.tr.delete(9, 10)); }],
    ["Backspace at the start of a block", (t: Setup) => { t.select(26); expect(t.key("Backspace")).toBe(true); }],
    ["Ctrl+B", (t: Setup) => { t.select(1, 8); t.key("b", true); }],
    ["Ctrl+I", (t: Setup) => { t.select(1, 8); t.key("i", true); }],
  ])("%s is editor", async (_name, act) => {
    const t = setup();
    t.select(9);
    act(t);
    expect((await check(t)).sources).toEqual(["editor"]);
  });

  it("insertText without a keydown is keyless-input", async () => {
    const t = setup();
    t.select(9);
    t.typeChar("a", { key: false });
    expect((await check(t)).sources).toEqual(["keyless-input"]);
  });

  it("insertText after an untrusted keydown, or of another character than the key, is keyless-input", async () => {
    const t = setup();
    t.select(9);
    t.typeChar("a", { keyTrusted: false });
    await endTask();
    t.key("e");
    t.beforeinput("insertText", "é");
    t.view.dispatch(t.editor.state.tr.insertText("é"));
    expect(t.sources).toEqual(["keyless-input", "keyless-input"]);
  });

  it("an untrusted insertText after a trusted keydown is unattributed", async () => {
    const t = setup();
    t.select(9);
    t.typeChar("a", { inputTrusted: false });
    expect(t.sources).toEqual(["unattributed"]);
  });

  it("IME composition and its end are keyless-input, never composition", async () => {
    const t = setup();
    t.select(9);
    t.key("Process");
    t.composition("compositionstart");
    t.beforeinput("insertCompositionText", "k");
    t.view.dispatch(t.editor.state.tr.insertText("k"));
    await endTask();
    // The end of the composition gives the whole composed text; the change inserts only what is new.
    t.composition("compositionend", true, "ka");
    t.view.dispatch(t.editor.state.tr.insertText("a"));
    const { sources, built } = await check(t);
    expect(sources).toEqual(["keyless-input"]);
    expect(new TextDecoder().decode(built[0]!.bytes)).not.toContain("Process");
  });

  it("an untrusted composition is unattributed", async () => {
    const t = setup();
    t.select(9);
    t.composition("compositionend", false);
    t.view.dispatch(t.editor.state.tr.insertText("a"));
    expect(t.sources).toEqual(["unattributed"]);
  });

  it("a trusted insertReplacementText is system-replacement; an untrusted one is unattributed", async () => {
    const t = setup();
    t.select(1, 8);
    t.replace("Odlomka");
    t.view.dispatch(t.editor.state.tr.insertText("Odlomka"));
    await endTask();
    t.wait(1_000);
    t.select(1, 8);
    t.replace("Odlomak", false);
    t.view.dispatch(t.editor.state.tr.insertText("Odlomak"));
    expect((await check(t)).sources).toEqual(["system-replacement", "unattributed"]);
  });

  it("a trusted Ctrl+X is cut", async () => {
    const t = setup();
    t.select(1, 8);
    t.key("x", true);
    t.cut();
    expect((await check(t)).sources).toEqual(["cut"]);
  });

  it("a program's transaction and a toolbar click are unattributed", async () => {
    const t = setup();
    t.view.dispatch(t.editor.state.tr.insertText("p", 9));
    t.editor.chain().setTextSelection({ from: 1, to: 8 }).toggleBold().run();
    expect(t.sources).toEqual(["unattributed", "unattributed"]);
  });

  it("what was seen holds through the microtasks of its task", async () => {
    const t = setup();
    t.select(9);
    t.key("a");
    t.beforeinput("insertText", "a");
    await Promise.resolve();
    await Promise.resolve();
    t.view.dispatch(t.editor.state.tr.insertText("a"));
    expect(t.sources).toEqual(["editor"]);
  });

  describe("F-127: what was seen belongs to one change, not to the task", () => {
    const chunk = "Pripremljeni izmisljeni odlomak";
    const onlyObserver = (t: Setup, event: KeyboardEvent) =>
      t.observer.plugin.props.handleKeyDown!.call(t.observer.plugin, t.view, event);

    it("a key, then a program inserting more than the key in the same change, is not editor", () => {
      const t = setup();
      t.select(9);
      t.key("a");
      t.beforeinput("insertText", "a");
      t.view.dispatch(t.editor.state.tr.insertText(`a${chunk}`));
      expect(t.sources).toEqual(["unattributed"]);
    });

    it("a key, its own change, then a program change in the same task: only the first is editor", () => {
      const t = setup();
      t.select(9);
      t.typeChar("a");
      t.view.dispatch(t.editor.state.tr.insertText(chunk));
      expect(t.sources).toEqual(["editor", "unattributed"]);
    });

    it("a keymap key, then a program inserting text in the same task, is not editor", () => {
      const t = setup();
      t.select(9);
      for (const key of ["Enter", "Backspace", "Delete"]) onlyObserver(t, keyEvent(key));
      t.view.dispatch(t.editor.state.tr.insertText(chunk));
      expect(t.sources).toEqual(["unattributed"]);
    });

    it("input without a key, then a program inserting other text, is not keyless-input", () => {
      const t = setup();
      t.select(9);
      t.beforeinput("insertText", "x");
      t.view.dispatch(t.editor.state.tr.insertText(chunk));
      expect(t.sources).toEqual(["unattributed"]);
    });

    it("a spelling replacement and a paste are taken by their first change only", () => {
      const t = setup();
      t.select(9);
      t.replace("ispravak");
      t.view.dispatch(t.editor.state.tr.insertText("ispravak"));
      t.view.dispatch(t.editor.state.tr.insertText(chunk));
      t.pasteText("zalijepljeno");
      t.view.dispatch(t.editor.state.tr.insertText(chunk).setMeta("uiEvent", "paste"));
      expect(t.sources).toEqual(["system-replacement", "unattributed", "paste", "unattributed"]);
    });

    it("a selection change takes nothing, and the data is dropped with the change", () => {
      const t = setup();
      t.select(9);
      t.key("a");
      t.beforeinput("insertText", "a");
      t.select(10);
      t.select(9);
      t.view.dispatch(t.editor.state.tr.insertText("a"));
      expect(t.sources).toEqual(["editor"]);
      expect((t.observer as unknown as { inputData: unknown }).inputData).toBeNull();
    });
  });

  describe("F-130", () => {
    const chunk = "Pripremljeni izmisljeni odlomak";
    const own = (t: Setup) => t.observer as unknown as { replacementText: unknown; composedText: unknown };

    it("a picked spelling suggestion, then a program's change first, is not system-replacement", () => {
      const t = setup();
      t.select(1, 8);
      t.replace("Odlomka");
      t.view.dispatch(t.editor.state.tr.insertText(chunk));
      expect(t.sources).toEqual(["unattributed"]);
    });

    it("a suggestion whose change inserts other text is not system-replacement, even without data", () => {
      const t = setup();
      t.select(1, 8);
      t.beforeinput("insertReplacementText", null);
      t.view.dispatch(t.editor.state.tr.insertText("Odlomka"));
      expect(t.sources).toEqual(["unattributed"]);
    });

    it("a suggestion counts when its change inserts only the changed part of the suggested text", () => {
      const t = setup();
      // "Odlomak" -> "Odlomka": the editor replaces only "ak" with "ka".
      t.select(6, 8);
      t.replace("Odlomka");
      t.view.dispatch(t.editor.state.tr.insertText("ka"));
      expect(t.sources).toEqual(["system-replacement"]);
      expect(own(t).replacementText).toBeNull();
    });

    it("a dead key or IME composition, then a program's change first, is not keyless-input", () => {
      const t = setup();
      t.select(9);
      t.composition("compositionstart");
      t.composition("compositionend", true, "é");
      t.view.dispatch(t.editor.state.tr.insertText(chunk));
      t.view.dispatch(t.editor.state.tr.insertText("é"));
      expect(t.sources).toEqual(["unattributed", "unattributed"]);
    });

    it("composition text, then a program's change first, is not keyless-input", () => {
      const t = setup();
      t.select(9);
      t.composition("compositionstart");
      t.beforeinput("insertCompositionText", "k");
      t.view.dispatch(t.editor.state.tr.insertText(chunk));
      expect(t.sources).toEqual(["unattributed"]);
    });

    it("a composition without text, then a deletion, is not keyless-input", () => {
      const t = setup();
      t.select(1, 8);
      t.composition("compositionstart");
      t.view.dispatch(t.editor.state.tr.deleteSelection());
      expect(t.sources).toEqual(["unattributed"]);
    });

    it("the suggested and composed text is dropped with the change and at the end of the task", async () => {
      const t = setup();
      t.select(9);
      t.composition("compositionend", true, "é");
      t.view.dispatch(t.editor.state.tr.insertText("é"));
      expect(t.sources).toEqual(["keyless-input"]);
      expect(own(t).composedText).toBeNull();
      t.replace("ispravak");
      t.composition("compositionend", true, "ü");
      await endTask();
      expect(own(t).replacementText).toBeNull();
      expect(own(t).composedText).toBeNull();
    });
  });

  describe("F-131 regression", () => {
    it("F-131 regression: replacement", () => {
      const t = setup();
      t.select(1, 8);
      t.replace("Odlomka izmisljenoga");
      t.view.dispatch(t.editor.state.tr.insertText("mis", 30));
      expect(t.sources).toEqual(["unattributed"]);
    });

    it("F-131 regression: composition", () => {
      const t = setup();
      t.select(9);
      t.composition("compositionstart");
      t.beforeinput("insertCompositionText", "izmisljeno");
      t.view.dispatch(t.editor.state.tr.insertText("mis", 30));
      expect(t.sources).toEqual(["unattributed"]);
    });

    it("F-131 regression: composition end", () => {
      const t = setup();
      t.select(9);
      t.composition("compositionend", true, "izmisljeno");
      t.view.dispatch(t.editor.state.tr.insertText("mis"));
      expect(t.sources).toEqual(["unattributed"]);
    });

    it("F-131 regression: whole text still counts", () => {
      const t = setup();
      t.select(1, 8);
      t.replace("Odlomka izmisljenoga");
      t.view.dispatch(t.editor.state.tr.insertText("Odlomka izmisljenoga"));
      t.select(9);
      t.composition("compositionend", true, "ab");
      t.view.dispatch(t.editor.state.tr.insertText("ab"));
      expect(t.sources).toEqual(["system-replacement", "keyless-input"]);
    });
  });

  it.each([
    ["a typed key", (t: Setup) => { t.key("a"); t.beforeinput("insertText", "a"); }],
    ["Enter", (t: Setup) => { t.key("Enter", false, false); }],
    ["a trusted paste", (t: Setup) => { t.observer.plugin.props.handlePaste!.call(t.observer.plugin, t.view, domEvent<ClipboardEvent>("paste", true), Slice.empty); }],
    ["a composition", (t: Setup) => t.composition("compositionstart")],
  ])("%s seen in an earlier task does not count after it ends", async (_name, see) => {
    const t = setup();
    t.select(9);
    see(t);
    const before = t.sources.length;
    await endTask();
    expect(t.observer.observation).toEqual(NO_OBSERVATION);
    t.view.dispatch(t.editor.state.tr.insertText("q"));
    t.view.dispatch(t.editor.state.tr.insertText("r").setMeta("uiEvent", "paste"));
    expect(t.sources.slice(before)).toEqual(["unattributed", "unattributed"]);
  });

  it("history before everything: an Undo transaction is unattributed whatever was seen", () => {
    const t = setup();
    t.typeChar("a");
    const full: SourceObservation = { keymapKey: true, keyedInput: true, keylessInput: true, composing: true, replacement: true, clipboard: "paste" };
    t.editor.commands.undo();
    const undo = t.changes.at(-1)!.transactions;
    expect(sourceOfChange(undo, full)).toBe("unattributed");
  });
});

describe("3d-1c QA t. 9: the observer does not change the editor", () => {
  it("every prop returns false and none calls preventDefault", () => {
    const { observer, view } = setup();
    const props = observer.plugin.props;
    const events = [
      keyEvent("a"), keyEvent("Enter"), keyEvent("b", true), keyEvent("z", true, false, false),
    ];
    for (const event of events) {
      expect(props.handleKeyDown!.call(observer.plugin, view, event)).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    for (const trusted of [true, false]) {
      const paste = domEvent<ClipboardEvent>("paste", trusted);
      const drop = domEvent<DragEvent>("drop", trusted);
      expect(props.handlePaste!.call(observer.plugin, view, paste, Slice.empty)).toBe(false);
      expect(props.handleDrop!.call(observer.plugin, view, drop, Slice.empty, true)).toBe(false);
      const handlers = props.handleDOMEvents as Record<string, (v: typeof view, e: Event) => boolean>;
      const dom = [
        domEvent<InputEvent>("beforeinput", trusted, { inputType: "insertText", data: "a" }),
        domEvent<InputEvent>("beforeinput", trusted, { inputType: "insertReplacementText", data: null }),
        domEvent<ClipboardEvent>("cut", trusted),
        domEvent<CompositionEvent>("compositionstart", trusted),
        domEvent<CompositionEvent>("compositionend", trusted),
      ];
      for (const event of dom) {
        expect(handlers[event.type]!.call(observer.plugin, view, event)).toBe(false);
        expect(event.preventDefault).not.toHaveBeenCalled();
      }
      expect(paste.preventDefault).not.toHaveBeenCalled();
      expect(drop.preventDefault).not.toHaveBeenCalled();
    }
  });

  it("the document after paste, cut, drop, typing, Enter and Undo is the same with and without the observer", async () => {
    const run = async (observe: boolean) => {
      const t = setup(undefined, observe);
      t.select(9);
      t.paste(htmlSlice(t.editor));
      await endTask();
      t.typeChar("č");
      t.key("Enter");
      await endTask();
      t.select(1, 4);
      t.cut();
      t.select(2, 5);
      t.drop(t.editor.state.selection.content(), 12, true);
      await endTask();
      t.key("z", true);
      return t.editor.state.doc;
    };
    const [withObserver, without] = [await run(true), await run(false)];
    // New blocks get random ids: those are set to one value on both sides, in one schema, before comparing.
    const sameIds = (doc: PmNode) => {
      const json = JSON.parse(JSON.stringify(doc.toJSON()).replace(/"nodeId":"(?!(a{8}|b{8}|c{8}))[^"]+"/g, '"nodeId":"nov"'));
      return withObserver.type.schema.nodeFromJSON(json);
    };
    expect(withObserver.childCount).toBeGreaterThan(2);
    expect(sameIds(withObserver).eq(sameIds(without))).toBe(true);
  });
});

describe("3d-1c QA t. 10: privacy", () => {
  const SHAPE = ["clipboard", "composing", "keyedInput", "keylessInput", "keymapKey", "replacement"];

  it("what the observer holds never has a key, data, text or time", async () => {
    const t = setup();
    t.select(9);
    const steps: (() => void)[] = [
      () => t.key("č"), () => t.beforeinput("insertText", "č"), () => t.key("Enter"), () => t.key("s", true),
      () => t.beforeinput("insertText", "tajna"), () => t.beforeinput("insertReplacementText", "Ispravak"),
      () => t.composition("compositionstart"), () => t.beforeinput("insertCompositionText", "ime"),
      () => t.pasteText("zalijepljeni tekst"), () => t.cut(), () => t.composition("compositionend"),
    ];
    for (const step of steps) {
      step();
      const seen = t.observer.observation;
      expect(Object.keys(seen).sort()).toEqual(SHAPE);
      for (const [name, value] of Object.entries(seen)) {
        if (name === "clipboard") expect([null, "paste", "cut", "drop"]).toContain(value);
        else expect(typeof value).toBe("boolean");
      }
      const json = JSON.stringify(seen);
      for (const secret of ["č", "tajna", "Ispravak", "ime", "zalijepljeni", "Enter", '"s"']) expect(json).not.toContain(secret);
      expect(json).not.toMatch(/\d/);
    }
    // A key waits only for the beforeinput of its task, and nothing outlives the task.
    const own = t.observer as unknown as { pendingKey: unknown; inputData: unknown; replacementText: unknown; composedText: unknown };
    t.key("x");
    t.beforeinput("insertText", "x");
    expect(own.pendingKey).toBeNull();
    t.key("y");
    t.beforeinput("insertText", "y");
    await endTask();
    expect(own.pendingKey).toBeNull();
    expect(own.inputData).toBeNull();
    expect(own.replacementText ?? null).toBeNull();
    expect(own.composedText ?? null).toBeNull();
    expect(t.observer.observation).toEqual(NO_OBSERVATION);
  });

  it("the segment and timing bytes with the observer equal those with the same sources given by hand", async () => {
    const t = setup();
    t.select(9);
    t.typeChar("č");
    await endTask();
    t.wait(100);
    t.pasteText(text(220));
    await endTask();
    t.wait(100);
    t.typeChar("a", { key: false });
    await endTask();
    t.wait(1_000);
    t.key("z", true);
    const observed = await takeAll(t.recorder);
    const byHand = new EvidenceRecorder();
    t.changes.forEach(({ transactions, at }, i) => {
      if (t.sources[i] === "paste") byHand.close();
      byHand.record(changeOf(transactions, t.sources[i]!, at));
      if (t.sources[i] === "paste") byHand.close();
    });
    const manual = await takeAll(byHand);
    expect(t.sources).toEqual(["editor", "paste", "keyless-input", "unattributed"]);
    expect(manual.map((b) => new TextDecoder().decode(b.bytes))).toEqual(observed.map((b) => new TextDecoder().decode(b.bytes)));
    expect(manual.map((b) => b.timing)).toEqual(observed.map((b) => b.timing));
  });
});

describe("F-132 regression", () => {
  it("F-132 regression: same range", () => {
    const t = setup();
    t.select(1, 8);
    t.composition("compositionstart", true, "Odlomak");
    t.view.dispatch(t.editor.state.tr.insertText("Odlomak", 1, 8));
    expect(t.sources).toEqual(["unattributed"]);
  });

  it("F-132 regression: other position", () => {
    const t = setup();
    t.select(1, 8);
    t.composition("compositionstart", true, "Odlomak");
    t.view.dispatch(t.editor.state.tr.insertText("Odlomak", 26));
    expect(t.sources).toEqual(["unattributed"]);
  });

  it("F-132 regression: composition end still counts", () => {
    const t = setup();
    t.select(1, 8);
    t.composition("compositionstart", true, "Odlomak");
    t.composition("compositionend", true, "é");
    t.view.dispatch(t.editor.state.tr.insertText("é", 1, 8));
    expect(t.sources).toEqual(["keyless-input"]);
  });
});
