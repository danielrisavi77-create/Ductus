// @vitest-environment node
/**
 * F-8 3d-2c2 (contract #476 c.6391714810 §6 property): a random run of
 * typing, Enter, Backspace and saves through `EvidenceSession`, while the
 * commit route loses answers (the commit lands, the client sees an error) or
 * answers 503. Once the drain is exhausted:
 * - the session shows SYNCED;
 * - the journal's head is the hash of the last segment sent;
 * - replaying every sent segment from the assigned document gives exactly the
 *   editor's text;
 * - no key was ever sent with two different bodies.
 * Real recorder on a headless editor, fake-indexeddb, the kit's fake route
 * and invented Ed25519 receipts. All text is synthetic.
 */
import { Editor } from "@tiptap/core";
import { fc, test } from "@fast-check/vitest";
import { afterEach, expect } from "vitest";

import { createBrowserEditStepsV1Replayer } from "@/adapters/evidence/edit-steps-v1-browser-replayer";
import { decodeBase64 } from "@/client/evidence-ingest";
import type { CanonicalDocument } from "@/domain/document";
import { replayEvidenceSegmentsV2 } from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceSegmentV2 } from "@/domain/forensics/evidence-segment-v2";
import { canonicalizeJcs, jcsUtf8Bytes, type JcsJsonValue } from "@/domain/forensics/jcs";
import type { QueuedTransaction } from "@/domain/sync/journal-types";
import { canonicalToTiptap, tiptapToCanonical } from "@/editor/interop";
import { createEditorExtensions } from "@/editor/schema";
import { createDrainRunner } from "@/lib/sync/drain-runner";
import { createEvidenceTransport, evidenceVerifierFor } from "@/lib/sync/evidence-transport";
import { DOC, DOMAIN, journalKit, json, R0, server, sha256, trusted, type Answer } from "@/lib/sync/evidence-test-kit";

import { EvidenceSession } from "./evidence-session";

const editorOf = (content: object) => {
  const editor = new Editor({ element: null, extensions: createEditorExtensions(), content });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  return editor;
};
const canonicalOf = (editor: Editor) => {
  const candidate = tiptapToCanonical(editor.getJSON());
  if (!candidate.ok) throw new Error("not canonical");
  return candidate.doc;
};

const ASSIGNED: CanonicalDocument = (() => {
  const editor = editorOf({ type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "aaaaaaaa-0000-4000-8000-00000000000a" }, content: [{ type: "text", text: "Uvod" }] }] });
  const doc = canonicalOf(editor);
  editor.destroy();
  return doc;
})();

const { open, cleanup } = journalKit("d");
afterEach(cleanup);

const op = fc.oneof(
  fc.record({ kind: fc.constant("type" as const), text: fc.constantFrom("a", "b", "ž", " ", "riječ") }),
  fc.record({ kind: fc.constant("enter" as const) }),
  fc.record({ kind: fc.constant("backspace" as const) }),
  fc.record({ kind: fc.constant("save" as const), wait: fc.boolean() }),
);
const fault = fc.constantFrom("ok", "lost", "503");

test.prop([fc.array(op, { minLength: 1, maxLength: 12 }), fc.array(fault, { maxLength: 6 })])(
  "3d-2c2: after any run with lost answers and 503s the drain ends SYNCED on exactly the editor's text",
  async (ops, faults) => {
    const answers: Answer[] = faults.map((kind) =>
      kind === "lost" ? (body, accept) => { accept(body); return new Error("lost"); }
        : kind === "503" ? () => json(503, {}) : (body, accept) => accept(body));
    const net = server(R0, ...answers);
    const journal = open();
    let clock = 0;
    const timers: { run: () => void; at: number }[] = [];
    const document = jcsUtf8Bytes(ASSIGNED);
    const session = new EvidenceSession({
      journal,
      documentId: DOC,
      open: async () => ({ status: "opened", work: {
        documentId: DOC, evidenceProfileId: "profil-izmisljeni", currentRevision: R0, documentHash: sha256(document),
        headSegmentHash: null, lastSequenceTo: 0, document, evidenceDomainId: DOMAIN, receiptKeys: [trusted.key], submitted: false,
      } }),
      replayer: createBrowserEditStepsV1Replayer,
      createRunner: (work) => createDrainRunner<QueuedTransaction>({
        journal, transport: createEvidenceTransport(net.fetchImpl), verifyFor: evidenceVerifierFor(work),
        now: () => clock, jitter: () => 0.5,
      }),
      network: { online: () => true, onOnline: () => () => {} },
      clock: () => clock,
      setTimer: (run, ms) => { const timer = { run, at: clock + ms }; timers.push(timer); return timer; },
      clearTimer: (handle) => { const i = timers.indexOf(handle as never); if (i >= 0) timers.splice(i, 1); },
    });
    expect((await session.load()).kind).toBe("ready");
    const editor = editorOf(canonicalToTiptap(ASSIGNED));
    let at = Date.parse("2026-10-24T09:00:00.000Z");
    editor.on("transaction", ({ transaction, appendedTransactions }) => {
      session.record([transaction, ...appendedTransactions], undefined, (at += 150));
    });
    const save = () => {
      session.edit();
      return session.propose(canonicalOf(editor));
    };
    try {
      // At least one change, so there is something to send: with nothing
      // owed and no receipt in this page session the state stays LOCAL_DURABLE (G3).
      editor.view.dispatch(editor.state.tr.insertText("x"));
      for (const step of ops) {
        if (step.kind === "type") editor.view.dispatch(editor.state.tr.insertText(step.text));
        else if (step.kind === "enter") editor.commands.splitBlock();
        else if (step.kind === "backspace" && !editor.commands.joinBackward()) {
          const { from } = editor.state.selection;
          if (from > 1 && editor.state.selection.$from.parentOffset > 0) editor.view.dispatch(editor.state.tr.delete(from - 1, from));
        } else if (step.kind === "save") {
          const saved = save();
          if (step.wait) await saved;
        }
      }
      await save();
      await session.settled();
      for (let i = 0; i < 100 && session.snapshot().state !== "SYNCED"; i++) {
        clock += 60_000;
        for (const timer of timers.splice(0)) timer.run();
        await session.settled();
      }

      expect(session.snapshot().state).toBe("SYNCED");
      const { meta, pending, snapshot } = await journal.readEvidence(DOC);
      expect(pending).toEqual([]);
      expect(canonicalizeJcs(snapshot!.document)).toBe(canonicalizeJcs(canonicalOf(editor)));

      const bodies = new Map<string, string>();
      const segments: EvidenceSegmentV2[] = [];
      let last: string | null = null;
      for (const { body, text } of net.calls) {
        const known = bodies.get(body.clientTransactionId);
        expect(known === undefined || known === text).toBe(true);
        if (known !== undefined) continue;
        bodies.set(body.clientTransactionId, text);
        const bytes = decodeBase64(body.segments[0])!;
        segments.push(JSON.parse(new TextDecoder().decode(bytes)) as EvidenceSegmentV2);
        last = sha256(bytes);
      }
      expect(meta?.evidenceHead?.segmentHash).toBe(last);
      const replay = await replayEvidenceSegmentsV2(
        ASSIGNED as unknown as JcsJsonValue, segments, createBrowserEditStepsV1Replayer());
      expect(replay.ok && replay.canonicalDocument).toBe(canonicalizeJcs(canonicalOf(editor)));
    } finally {
      session.close();
      editor.destroy();
      await cleanup();
    }
  },
);
