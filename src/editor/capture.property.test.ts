// @vitest-environment node
import { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, Slice } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { createEditStepsV1Replayer } from "@/adapters/evidence/edit-steps-v1-replayer";
import { verifyCanonicalEvidencePayloadV2 } from "@/domain/forensics/evidence-chain-v2";
import { replayEvidenceSegmentsV2 } from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceSegmentV2, EvidenceSourceV2 } from "@/domain/forensics/evidence-segment-v2";
import type { JcsJsonValue } from "@/domain/forensics/jcs";

import { CaptureError, changeOf, EvidenceRecorder, type SegmentContext } from "./capture";
import { tiptapToCanonical } from "./interop";
import { createEditorExtensions } from "./schema";

/**
 * F-8 step 3d-1b (DAN-282, contract #476 issuecomment-6383232090), QA t. 2:
 * 200 seeds of 30 random actions each on the real editor (the edits of QA
 * t. 1, typing, deleting, bold and italic, Undo and Redo, random pauses and
 * sources). No segment the recorder gives is refused by replay #391, and the
 * recorder stops only with `unsupported_step` or `too_large`; every stop is
 * reported with its seed and action. Synthetic text and ids only.
 */

const SEEDS = 200;
const ACTIONS = 30;
const T0 = Date.parse("2026-10-24T09:00:00.000Z");
const IDS = ["a", "b", "c"].map((x) => `${x.repeat(8)}-0000-4000-8000-${x.repeat(12)}`);
const SOURCES: EvidenceSourceV2[] = ["editor", "editor", "editor", "keyless-input", "unattributed"];
const WORDS = ["Izmisljeno", "rijec", " ", "Ab", "x"];
const BASE: SegmentContext = {
  documentId: "dokument-izmisljeni",
  sessionId: "11111111-1111-4111-8111-111111111111",
  segmentId: "22222222-2222-4222-8222-222222222222",
  evidenceProfileId: "profil-izmisljeni",
  sequenceFrom: 1,
  predecessorSegmentHash: null,
};

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

function key(name: string, ctrl = false, shift = false) {
  const code = name.length === 1 ? name.toUpperCase().charCodeAt(0) : { Enter: 13, Backspace: 8 }[name]!;
  return { key: name, keyCode: code, which: code, ctrlKey: ctrl, shiftKey: shift, altKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} } as unknown as KeyboardEvent;
}

function canonical(editor: Editor): JcsJsonValue {
  const candidate = tiptapToCanonical(editor.getJSON());
  if (!candidate.ok) throw new Error("test document is not canonical");
  return candidate.doc as unknown as JcsJsonValue;
}

type Outcome = { segments: EvidenceSegmentV2[]; initial: JcsJsonValue; stop: string | null; final: JcsJsonValue };

async function run(seed: number): Promise<Outcome> {
  const r = random(seed);
  const editor = new Editor({
    element: null,
    extensions: createEditorExtensions(),
    content: {
      type: "doc",
      content: IDS.map((nodeId, i) => (i === 1
        ? { type: "heading", attrs: { nodeId, level: 2 }, content: [{ type: "text", text: "Naslov dva" }] }
        : { type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text: `Odlomak ${i} izmisljen` }] })),
    },
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  const recorder = new EvidenceRecorder();
  const initial = canonical(editor);
  const segments: EvidenceSegmentV2[] = [];
  let context = BASE;
  let at = T0;
  let source: EvidenceSourceV2 = "editor";
  let stop: string | null = null;
  let action = "";
  editor.on("transaction", ({ transaction, appendedTransactions }) => {
    const all: Transaction[] = [transaction, ...appendedTransactions];
    if (stop === null && all.some((tr) => tr.docChanged)) recorder.record(changeOf(all, source, at));
  });
  const press = (name: string, ctrl = false, shift = false) =>
    editor.state.plugins.some((plugin) => plugin.props.handleKeyDown?.call(plugin, editor.view, key(name, ctrl, shift)));
  const position = () => {
    const doc = editor.state.doc;
    return TextSelection.near(doc.resolve(1 + r.int(doc.content.size - 1))).from;
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
    ["type", () => editor.view.dispatch(editor.state.tr.insertText(r.pick(WORDS)))],
    ["Backspace", () => press("Backspace")],
    ["Enter", () => press("Enter")],
    ["Ctrl+A", () => press("a", true)],
    ["select", () => {
      const [a, b] = [position(), position()].sort((x, y) => x - y);
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.between(editor.state.doc.resolve(a!), editor.state.doc.resolve(b!))));
    }],
    ["caret", () => editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(position()))))],
    ["block start", () => {
      const pos = position();
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, editor.state.doc.resolve(pos).start())));
    }],
    ["bold", () => press("b", true)],
    ["italic", () => press("i", true)],
    ["paragraph", () => editor.chain().focus().setParagraph().run()],
    ["heading", () => editor.chain().focus().setHeading({ level: (1 + r.int(3)) as 1 | 2 | 3 }).run()],
    ["paste", () => {
      source = "paste";
      editor.view.dispatch(editor.state.tr.replaceSelection(new Slice(Fragment.from(editor.schema.text(r.pick(WORDS))), 0, 0)).setMeta("uiEvent", "paste"));
    }],
    ["Undo", () => press("z", true)],
    ["Redo", () => press("z", true, true)],
  ];
  for (let i = 0; i < ACTIONS && stop === null; i += 1) {
    const [name, act] = r.pick(actions);
    action = `action ${i} (${name})`;
    // Random pauses: inside an event, past 400 ms, a new undo group.
    at += r.pick([0, 30, 120, 450, 900, 2_000]);
    source = r.pick(SOURCES);
    if (r.next() < 0.5) editor.view.dispatch(closeHistory(editor.state.tr));
    try {
      act();
      if (r.next() < 0.3) await drain();
    } catch (error) {
      if (!(error instanceof CaptureError)) throw error;
      stop = `seed ${seed}, ${action}: ${error.code}`;
    }
  }
  // After a stop the events closed before it still come out, and must replay too.
  try {
    await drain();
  } catch (error) {
    if (!(error instanceof CaptureError)) throw error;
    stop ??= `seed ${seed}, ${action}: ${error.code}`;
  }
  return { segments, initial, stop, final: canonical(editor) };
}

describe("F-8 3d-1b: random edits never give a segment that replay refuses", () => {
  it(`${SEEDS} seeds of ${ACTIONS} actions`, async () => {
    const stops: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const { segments, initial, stop, final } = await run(seed);
      if (stop !== null) {
        stops.push(stop);
        expect(stop, stop).toMatch(/: (unsupported_step|too_large)$/);
      }
      if (segments.length === 0) continue;
      const replay = await replayEvidenceSegmentsV2(initial, segments, createEditStepsV1Replayer());
      expect(replay, `seed ${seed}: the segments it gave do not replay`).toMatchObject({
        ok: true, documentSha256: segments.at(-1)!.finalDocumentHash,
      });
      if (stop === null) {
        const replayer = createEditStepsV1Replayer();
        const rebuilt = segments.flatMap((s) => s.events).reduce((doc, event) => replayer.apply(doc, event), replayer.load(initial));
        expect(replayer.toCanonical(rebuilt), `seed ${seed}`).toEqual(final);
      }
    }
    // The report: every stop with its seed and action (printed when a check fails).
    console.info(`stops: ${stops.length} of ${SEEDS}\n${stops.join("\n")}`);
    if (process.env.CAPTURE_STOPS_REPORT) (await import("node:fs")).writeFileSync(process.env.CAPTURE_STOPS_REPORT, stops.join("\n"));
  }, 600_000);
});
