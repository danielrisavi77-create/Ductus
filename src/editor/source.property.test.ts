// @vitest-environment node
import { Editor } from "@tiptap/core";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Fragment, Slice, type Node as PmNode } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { createEditStepsV1Replayer } from "@/adapters/evidence/edit-steps-v1-replayer";
import { verifyCanonicalEvidencePayloadV2 } from "@/domain/forensics/evidence-chain-v2";
import { replayEvidenceSegmentsV2 } from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceSegmentV2 } from "@/domain/forensics/evidence-segment-v2";
import type { JcsJsonValue } from "@/domain/forensics/jcs";

import { CaptureError, EvidenceRecorder, type SegmentContext } from "./capture";
import { tiptapToCanonical } from "./interop";
import { createEditorExtensions } from "./schema";
import { recordWithSource, SourceObserver, STANDALONE_SOURCES } from "./source";

/**
 * F-8 step 3d-1c (Q1, DAN-287), QA t. 11, built on the random test of 3d-1b
 * (capture.property.test.ts): 200 seeds of 30 random actions on the real
 * editor with the observer, every change through `recordWithSource`. Typing,
 * Enter, deleting, pasting plain text and HTML, cutting, dropping, Undo and
 * Redo, with trusted and untrusted events and random pauses; each action is a
 * task of its own. No segment is refused by replay #391; every paste, cut and
 * drop is an event of its own; nothing from the history is anything but
 * `unattributed`; `composition` is never written; every stop is
 * `unsupported_step` or `too_large`, reported with its seed. Synthetic text only.
 */

const SEEDS = 200;
const ACTIONS = 30;
const T0 = Date.parse("2026-10-24T09:00:00.000Z");
const IDS = ["a", "b", "c"].map((x) => `${x.repeat(8)}-0000-4000-8000-${x.repeat(12)}`);
const WORDS = ["Izmisljeno", "rijec", " ", "Ab", "x", "č", "**jos**"];
const BASE: SegmentContext = {
  documentId: "dokument-izmisljeni",
  sessionId: "11111111-1111-4111-8111-111111111111",
  segmentId: "22222222-2222-4222-8222-222222222222",
  evidenceProfileId: "profil-izmisljeni",
  sequenceFrom: 1,
  predecessorSegmentHash: null,
};
const STANDALONE = new Set<string>(STANDALONE_SOURCES);

/** mulberry32: the same actions for the same seed, everywhere. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T,>(list: readonly T[]) => list[Math.floor(next() * list.length)]! };
}

const endTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function keyEvent(name: string, ctrl: boolean, shift: boolean, trusted: boolean) {
  const code = [...name].length === 1 ? name.toUpperCase().charCodeAt(0) : { Enter: 13, Backspace: 8 }[name] ?? 0;
  return { type: "keydown", key: name, keyCode: code, which: code, ctrlKey: ctrl, shiftKey: shift, altKey: false, metaKey: false, isTrusted: trusted, preventDefault() {}, stopPropagation() {} } as unknown as KeyboardEvent;
}

const domEvent = (type: string, trusted: boolean, extra: Record<string, unknown> = {}) =>
  ({ type, isTrusted: trusted, defaultPrevented: false, preventDefault() {}, ...extra }) as unknown as Event;

function canonical(editor: Editor): JcsJsonValue {
  const candidate = tiptapToCanonical(editor.getJSON());
  if (!candidate.ok) throw new Error("test document is not canonical");
  return candidate.doc as unknown as JcsJsonValue;
}

type Outcome = {
  segments: EvidenceSegmentV2[];
  initial: JcsJsonValue;
  stop: string | null;
  final: JcsJsonValue;
  standaloneChanges: number;
};

async function run(seed: number): Promise<Outcome> {
  const r = random(seed);
  const observer = new SourceObserver();
  const editor = new Editor({
    element: null,
    extensions: [...createEditorExtensions(), observer.extension],
    content: {
      type: "doc",
      content: IDS.map((nodeId, i) => (i === 1
        ? { type: "heading", attrs: { nodeId, level: 2 }, content: [{ type: "text", text: "Naslov dva" }] }
        : { type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text: `Odlomak ${i} izmisljen` }] })),
    },
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  const view = editor.view;
  const recorder = new EvidenceRecorder();
  const initial = canonical(editor);
  const segments: EvidenceSegmentV2[] = [];
  let context = BASE;
  let at = T0;
  let stop: string | null = null;
  let action = "";
  let standaloneChanges = 0;
  editor.on("transaction", ({ transaction, appendedTransactions }) => {
    const all: Transaction[] = [transaction, ...appendedTransactions];
    if (stop !== null) return;
    const source = recordWithSource(recorder, all, observer.take(all), at);
    if (source === null) return;
    expect(source, `seed ${seed}, ${action}`).not.toBe("composition");
    if (all.some((tr) => isHistoryTransaction(tr))) expect(source, `seed ${seed}, ${action}`).toBe("unattributed");
    // The recorder writes nothing for a change that leaves the document as it was.
    if (STANDALONE.has(source) && !transaction.before.eq(all.at(-1)!.doc)) standaloneChanges += 1;
  });
  const someProp = (name: string, call: (prop: (...args: unknown[]) => unknown) => unknown) =>
    editor.state.plugins.some((plugin) => {
      const prop = (plugin.props as unknown as Record<string, unknown>)[name];
      return typeof prop === "function" ? Boolean(call((prop as (...args: unknown[]) => unknown).bind(plugin))) : false;
    });
  const dom = (type: string, event: Event) =>
    editor.state.plugins.some((plugin) => {
      const handler = (plugin.props.handleDOMEvents as Record<string, ((...args: unknown[]) => unknown) | undefined> | undefined)?.[type];
      return handler ? Boolean(handler.call(plugin, view, event)) : false;
    });
  const key = (name: string, ctrl = false, shift = false) => someProp("handleKeyDown", (f) => f(view, keyEvent(name, ctrl, shift, r.next() < 0.8)));
  const position = () => TextSelection.near(editor.state.doc.resolve(1 + r.int(editor.state.doc.content.size - 1))).from;
  const select = () => {
    const [a, b] = [position(), position()].sort((x, y) => x - y);
    view.dispatch(editor.state.tr.setSelection(TextSelection.between(editor.state.doc.resolve(a!), editor.state.doc.resolve(b!))));
  };
  const textSlice = () => new Slice(Fragment.from(editor.schema.text(r.pick(WORDS))), 0, 0);
  const htmlSlice = () => {
    const s = editor.schema;
    const blocks: PmNode[] = [
      s.nodes.paragraph!.create(null, [s.text("Prvi "), s.text("podebljan", [s.marks.bold!.create()])]),
      s.nodes.heading!.create({ level: 2 }, s.text("Naslov")),
      s.nodes.paragraph!.create(null, s.text(r.pick(WORDS))),
    ];
    return new Slice(Fragment.from(blocks.slice(0, 1 + r.int(3))), 1, 1);
  };
  const paste = (slice: Slice) => {
    const event = domEvent("paste", r.next() < 0.7, { clipboardData: { getData: () => "" } });
    if (dom("paste", event) || someProp("handlePaste", (f) => f(view, event, slice))) return;
    view.dispatch(editor.state.tr.replaceSelection(slice).scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
  };
  const drain = async () => {
    recorder.close();
    for (;;) {
      const next = await recorder.takeSegment(context);
      if (!next) return;
      const payload = await verifyCanonicalEvidencePayloadV2(next.bytes);
      expect(payload.ok, `seed ${seed}, ${action}`).toBe(true);
      if (!payload.ok) return;
      segments.push(payload.segment);
      context = { ...BASE, sequenceFrom: next.segment.sequenceTo + 1, predecessorSegmentHash: next.sha256 };
    }
  };
  const actions: [string, () => void][] = [
    ["type", () => {
      const char = r.pick(["a", "č", " ", "Z"]);
      if (r.next() < 0.8) key(char);
      dom("beforeinput", domEvent("beforeinput", r.next() < 0.8, { inputType: "insertText", data: char }));
      view.dispatch(editor.state.tr.insertText(char));
    }],
    ["insertText", () => view.dispatch(editor.state.tr.insertText(r.pick(WORDS)))],
    ["Enter", () => key("Enter")],
    ["Backspace", () => {
      const { from, empty } = editor.state.selection;
      if (!key("Backspace") && empty && from > 1) view.dispatch(editor.state.tr.delete(from - 1, from));
    }],
    ["bold", () => key("b", true)],
    ["select", select],
    ["caret", () => view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(position()))))],
    ["paste text", () => paste(textSlice())],
    ["paste HTML", () => paste(htmlSlice())],
    ["cut", () => {
      select();
      if (r.next() < 0.5) key("x", true);
      if (dom("cut", domEvent("cut", r.next() < 0.7))) return;
      if (!editor.state.selection.empty) view.dispatch(editor.state.tr.deleteSelection().scrollIntoView().setMeta("uiEvent", "cut"));
    }],
    ["drop", () => {
      const moved = r.next() < 0.5;
      if (moved) select();
      const slice = moved ? editor.state.selection.content() : textSlice();
      const insertPos = position();
      if (someProp("handleDrop", (f) => f(view, domEvent("drop", r.next() < 0.7), slice, moved))) return;
      const tr = editor.state.tr;
      if (moved) tr.deleteSelection();
      const pos = tr.mapping.map(insertPos);
      tr.replaceRange(pos, pos, slice);
      if (tr.docChanged) view.dispatch(tr.setMeta("uiEvent", "drop"));
    }],
    ["Undo", () => key("z", true)],
    ["Redo", () => key("z", true, true)],
  ];
  for (let i = 0; i < ACTIONS && stop === null; i += 1) {
    const [name, act] = r.pick(actions);
    action = `action ${i} (${name})`;
    at += r.pick([0, 30, 120, 450, 900, 2_000]);
    try {
      act();
      await endTask();
      if (r.next() < 0.3) await drain();
    } catch (error) {
      if (!(error instanceof CaptureError)) throw error;
      stop = `seed ${seed}, ${action}: ${error.code}`;
    }
  }
  try {
    await drain();
  } catch (error) {
    if (!(error instanceof CaptureError)) throw error;
    stop ??= `seed ${seed}, ${action}: ${error.code}`;
  }
  return { segments, initial, stop, final: canonical(editor), standaloneChanges };
}

describe("F-8 3d-1c: random edits with the observer", () => {
  it(`${SEEDS} seeds of ${ACTIONS} actions`, async () => {
    const stops: string[] = [];
    let standalone = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const { segments, initial, stop, final, standaloneChanges } = await run(seed);
      const events = segments.flatMap((s) => s.events);
      expect(events.some((e) => e.source === "composition"), `seed ${seed}`).toBe(false);
      if (stop !== null) {
        stops.push(stop);
        expect(stop, stop).toMatch(/: (unsupported_step|too_large)$/);
      }
      if (segments.length > 0) {
        const replay = await replayEvidenceSegmentsV2(initial, segments, createEditStepsV1Replayer());
        expect(replay, `seed ${seed}: the segments it gave do not replay`).toMatchObject({
          ok: true, documentSha256: segments.at(-1)!.finalDocumentHash,
        });
      }
      if (stop !== null) continue;
      // Every paste, cut and drop that changed the document is exactly one event.
      const standaloneEvents = events.filter((e) => STANDALONE.has(e.source)).length;
      expect(standaloneEvents, `seed ${seed}`).toBe(standaloneChanges);
      standalone += standaloneEvents;
      if (segments.length > 0) {
        const replayer = createEditStepsV1Replayer();
        const rebuilt = events.reduce((doc, event) => replayer.apply(doc, event), replayer.load(initial));
        expect(replayer.toCanonical(rebuilt), `seed ${seed}`).toEqual(final);
      } else {
        expect(final, `seed ${seed}`).toEqual(initial);
      }
    }
    expect(standalone).toBeGreaterThan(SEEDS);
    console.info(`stops: ${stops.length} of ${SEEDS}; paste, cut and drop events: ${standalone}\n${stops.join("\n")}`);
    if (process.env.SOURCE_STOPS_REPORT) (await import("node:fs")).writeFileSync(process.env.SOURCE_STOPS_REPORT, stops.join("\n"));
  }, 600_000);
});
