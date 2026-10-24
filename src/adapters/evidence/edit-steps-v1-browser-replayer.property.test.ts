// @vitest-environment node
import { fc, test } from "@fast-check/vitest";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { expect } from "vitest";

import { digestCanonicalDocumentV2, replayEvidenceSegmentsV2 } from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceSegmentV2, EvidenceStepV2 } from "@/domain/forensics/evidence-segment-v2";
import type { JcsJsonValue } from "@/domain/forensics/jcs";

import { createBrowserEditStepsV1Replayer } from "./edit-steps-v1-browser-replayer";
import { createEditStepsV1Replayer, removedRangeSha256 } from "./edit-steps-v1-replayer";

/**
 * Granica 8 (#638), property: random edits, some with a forged or shifted
 * removed hash, replay to the same result with the server and the browser
 * replayer. The browser module runs here in Node; the bundle test shows the
 * same module runs with browser globals only.
 */

// Synthetic only: invented ids and filler text.
const ids = ["bbbbbbbb-0000-4000-8000-000000000001", "bbbbbbbb-0000-4000-8000-000000000002",
  "bbbbbbbb-0000-4000-8000-000000000003"];
const start: JcsJsonValue = {
  schemaVersion: 1,
  nodes: [
    { type: "paragraph", id: ids[0], children: [{ type: "text", text: "Prvi odlomak čž.", marks: [] }] },
    { type: "heading", id: ids[1], level: 2, children: [{ type: "text", text: "Naslov 😀", marks: [] }] },
    { type: "paragraph", id: ids[2], children: [{ type: "text", text: "Treći odlomak.", marks: [] }] },
  ],
};
const OTHER_HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const server = createEditStepsV1Replayer();
const browser = createBrowserEditStepsV1Replayer();
const schema = server.load(start).type.schema;

type Op = { kind: "insert" | "delete" | "join" | "bold" | "split"; a: number; b: number; text: string; forge: number };
const op = fc.record({
  kind: fc.constantFrom("insert", "delete", "join", "bold", "split"),
  a: fc.nat(),
  b: fc.nat(),
  text: fc.constantFrom("a", "Ž", "😀", "riječ ", ""),
  forge: fc.nat({ max: 9 }),
}) as fc.Arbitrary<Op>;

function change(tr: Transform, o: Op): void {
  const size = tr.doc.content.size;
  const [x, y] = [o.a % (size + 1), o.b % (size + 1)];
  const [from, to] = [Math.min(x, y), Math.max(x, y)];
  if (o.kind === "insert" && o.text) tr.insert(x, schema.text(o.text));
  if (o.kind === "delete") tr.delete(from, to);
  if (o.kind === "join") tr.join(x);
  if (o.kind === "bold") tr.addMark(from, to, schema.marks.bold.create());
  if (o.kind === "split") tr.split(x, 1, [{ type: schema.nodes.paragraph, attrs: { nodeId: null } }]);
}

/** One event per edit ProseMirror accepts; 1 in 5 removed hashes forged, 1 in 10 of a shifted range. */
async function segmentOf(ops: Op[]): Promise<EvidenceSegmentV2 | null> {
  let document: PmNode = server.load(start);
  const hash = async (d: PmNode) => {
    try {
      return (await digestCanonicalDocumentV2(server.toCanonical(d))).sha256;
    } catch {
      return OTHER_HASH;
    }
  };
  const initial = await hash(document);
  let before = initial;
  const events = [];
  for (const o of ops) {
    const tr = new Transform(document);
    try {
      change(tr, o);
    } catch {
      continue;
    }
    if (!tr.docChanged) continue;
    const steps = tr.steps.map((step, i) => {
      const json = step.toJSON() as Record<string, unknown>;
      const [from, to] = [json.from as number, json.to as number];
      if (json.stepType === "replace" && to > from && !json.structure) {
        const shifted = Math.min(to + 1, tr.docs[i].content.size);
        try {
          json.removedSha256 = o.forge < 2 ? OTHER_HASH
            : o.forge < 3 ? removedRangeSha256(tr.docs[i], from, shifted)
            : removedRangeSha256(tr.docs[i], from, to);
        } catch {
          json.removedSha256 = OTHER_HASH; // half a surrogate pair has no JCS form
        }
      }
      return JSON.parse(JSON.stringify(json)) as EvidenceStepV2;
    });
    document = tr.doc;
    const after = await hash(document);
    events.push({ sequence: events.length + 1, source: "editor", steps, beforeDocumentHash: before, afterDocumentHash: after });
    before = after;
  }
  if (events.length === 0) return null;
  return {
    initialDocumentHash: initial,
    finalDocumentHash: before,
    events,
    captureContext: { editorModel: "prosemirror", transactionFormat: "ductus-edit-steps-v1" },
  } as EvidenceSegmentV2;
}

test.prop([fc.array(op, { minLength: 1, maxLength: 8 })], { numRuns: 200 })(
  "random edits replay alike on the server and in the browser",
  async (ops) => {
    const segment = await segmentOf(ops);
    if (!segment) return;
    const onServer = await replayEvidenceSegmentsV2(start, [segment], server);
    expect(await replayEvidenceSegmentsV2(start, [segment], browser)).toEqual(onServer);
  },
);
