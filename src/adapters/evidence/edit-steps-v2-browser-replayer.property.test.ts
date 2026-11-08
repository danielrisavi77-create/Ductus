// @vitest-environment node
import { fc, test } from "@fast-check/vitest";
import { Fragment, type Node as PmNode } from "@tiptap/pm/model";
import { canJoin, Transform } from "@tiptap/pm/transform";
import { expect } from "vitest";

import type { DocumentSource } from "@/domain/document/schema";
import { digestCanonicalDocumentV2, replayEvidenceSegmentsV2 } from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceEventV3, EvidenceSegmentV2 } from "@/domain/forensics/evidence-segment-v2";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";

import { removedRangeSha256 } from "./edit-steps-v1-replayer";
import { createBrowserEditStepsV2Replayer } from "./edit-steps-v2-browser-replayer";
import { createEditStepsV2Replayer, sourceRecordSha256 } from "./edit-steps-v2-replayer";
import { editStepJsonV2, editStepsV2Schema, type EditStepsV2Document } from "./edit-steps-v2-rules";

/**
 * docs/contracts/document-schema-v2.md §10, properties (f) and (g) (DAN-619
 * PR b). (f): random v2 edits, some with a forged or shifted hash, replay to
 * the same result on the server and in the browser, and an unforged run ends
 * in the editor's own document. (g): no accepted event changes or drops a
 * citation unless it removes a range with a hash. Synthetic only.
 */

const ids = ["bbbbbbbb-0000-4000-8000-000000000001", "bbbbbbbb-0000-4000-8000-000000000002",
  "bbbbbbbb-0000-4000-8000-000000000003"];
const S = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc"];
const OTHER_HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

const text = (value: string) => ({ type: "text", text: value, marks: [] });
const book = (id: string, year: number) => ({
  id, authors: [{ kind: "person", family: "Prezime", given: "Ime" }], year,
  title: "Izvor 1", type: "book", place: "Zagreb", publisher: "Nakladnik",
}) as unknown as DocumentSource;

const start: JcsJsonValue = {
  schemaVersion: 2,
  nodes: [
    { type: "paragraph", id: ids[0], children: [text("Prvi čž "), { type: "citation", sourceId: S[0], locator: "str. 12" }, text(".")] },
    { type: "heading", id: ids[1], level: 2, children: [text("Naslov 😀")] },
    { type: "paragraph", id: ids[2], children: [text("Treći "), { type: "citation", sourceId: S[1] }] },
  ],
  sources: [book(S[0], 2020), book(S[1], 2020)],
} as unknown as JcsJsonValue;

const server = createEditStepsV2Replayer();
const browser = createBrowserEditStepsV2Replayer();
const schema = editStepsV2Schema();

type Kind = "insert" | "cite" | "delete" | "join" | "bold" | "split" | "heading" | "sourceSet" | "sourceRemove";
type Op = { kind: Kind; a: number; b: number; text: string; source: number; year: number; forge: number };
const op = fc.record({
  kind: fc.constantFrom<Kind>("insert", "cite", "delete", "join", "bold", "split", "heading", "sourceSet", "sourceRemove"),
  a: fc.nat(),
  b: fc.nat(),
  text: fc.constantFrom("a", "Ž", "😀", "riječ ", ""),
  source: fc.nat({ max: 2 }),
  year: fc.constantFrom(2020, 2021),
  forge: fc.nat({ max: 9 }),
}) as fc.Arbitrary<Op>;

/** The editor's normal form after a transaction (§3.1): no marks on a citation. */
function unmarked(document: PmNode): PmNode {
  const blocks: PmNode[] = [];
  document.forEach((block) => {
    const children: PmNode[] = [];
    block.forEach((child) => children.push(child.type.name === "citation" ? child.mark([]) : child));
    blocks.push(block.copy(Fragment.from(children)));
  });
  return document.copy(Fragment.from(blocks));
}

/**
 * src/editor/capture.ts's test, with a citation counted as content (§5.2):
 * a character, a citation or a whole block in the range.
 */
function removesContent(document: PmNode, from: number, to: number): boolean {
  if (document.textBetween(from, to, undefined, "\uFFFC").length > 0) return true;
  let wholeBlock = false;
  document.forEach((block, offset) => {
    wholeBlock ||= offset >= from && offset + block.nodeSize <= to;
  });
  return wholeBlock;
}

/**
 * Applies `o` and says whether an editor could have made it: a text selection
 * ends only inside a block, and joinBackward joins only where it may. Other
 * transforms stay in the run, for (g) and for the server and browser to agree.
 */
function change(tr: Transform, o: Op): boolean {
  const size = tr.doc.content.size;
  const [x, y] = [o.a % (size + 1), o.b % (size + 1)];
  const [from, to] = [Math.min(x, y), Math.max(x, y)];
  const inText = (...at: number[]) => at.every((pos) => tr.doc.resolve(pos).parent.inlineContent);
  let editorLike = inText(x, from, to);
  if (o.kind === "insert" && o.text) tr.insert(x, schema.text(o.text));
  if (o.kind === "cite") tr.insert(x, schema.nodes.citation.create({ sourceId: S[o.source], locator: o.text || null }));
  if (o.kind === "delete") tr.delete(from, to);
  if (o.kind === "join") {
    editorLike = canJoin(tr.doc, x);
    tr.join(x);
  }
  if (o.kind === "bold") tr.addMark(from, to, schema.marks.bold.create());
  if (o.kind === "split") tr.split(x, 1, [{ type: schema.nodes.paragraph, attrs: { nodeId: null } }]);
  if (o.kind === "heading") {
    const block = tr.doc.resolve(x).node(1);
    tr.setBlockType(x, x, schema.nodes.heading, { level: 2, nodeId: block.attrs.nodeId });
  }
  return editorLike;
}

/** The one source step of `o`, as the editor would record it, or null when it changes nothing. */
function sourceStep(sources: readonly DocumentSource[], o: Op) {
  const old = sources.find((source) => source.id === S[o.source]);
  const hash = (record: DocumentSource) => (o.forge < 2 ? OTHER_HASH : sourceRecordSha256(record));
  if (o.kind === "sourceRemove") {
    if (!old) return null;
    return { step: { stepType: "sourceRemove", sourceId: old.id, removedSha256: hash(old) },
      after: sources.filter((source) => source !== old), forged: o.forge < 2 };
  }
  const record = book(S[o.source], o.year);
  if (!old) return { step: { stepType: "sourceSet", source: record }, after: [...sources, record], forged: false };
  if (old.year === o.year) return null;
  return { step: { stepType: "sourceSet", source: record, removedSha256: hash(old) },
    after: sources.map((source) => (source === old ? record : source)), forged: o.forge < 2 };
}

type Run = { segment: EvidenceSegmentV2; final: EditStepsV2Document; clean: boolean } | null;

/** One event per edit the editor accepts; 1 in 5 hashes forged, 1 in 10 of a shifted range. */
async function segmentOf(ops: Op[]): Promise<Run> {
  let state: EditStepsV2Document = server.load(start);
  let clean = true;
  const hash = async (s: EditStepsV2Document) => {
    try {
      return (await digestCanonicalDocumentV2(server.toCanonical(s))).sha256;
    } catch {
      clean = false; // a block without an id: the replay rightly fails here
      return OTHER_HASH;
    }
  };
  const initial = await hash(state);
  let before = initial;
  const events: EvidenceEventV3[] = [];
  for (const o of ops) {
    let steps: unknown[];
    let next: EditStepsV2Document;
    if (o.kind === "sourceSet" || o.kind === "sourceRemove") {
      const made = sourceStep(state.sources, o);
      if (!made) continue;
      clean &&= !made.forged;
      steps = [made.step];
      next = { doc: state.doc, sources: made.after };
    } else {
      const tr = new Transform(state.doc);
      try {
        clean &&= change(tr, o);
      } catch {
        continue;
      }
      const doc = unmarked(tr.doc);
      if (doc.eq(state.doc)) continue;
      steps = tr.steps.map((step, i) => {
        const json = editStepJsonV2(step.toJSON()) as Record<string, unknown>;
        const [from, to] = [json.from as number, json.to as number];
        if (json.stepType === "replace" && to > from && !json.structure) {
          if (!removesContent(tr.docs[i], from, to)) {
            json.structure = true; // as src/editor/capture.ts writes a boundary-only removal
            return JSON.parse(JSON.stringify(json)) as unknown;
          }
          const shifted = Math.min(to + 1, tr.docs[i].content.size);
          clean &&= o.forge >= 3;
          try {
            json.removedSha256 = o.forge < 2 ? OTHER_HASH
              : o.forge < 3 ? removedRangeSha256(tr.docs[i], from, shifted)
              : removedRangeSha256(tr.docs[i], from, to);
          } catch {
            json.removedSha256 = OTHER_HASH; // half a surrogate pair has no JCS form
            clean = false;
          }
        }
        return JSON.parse(JSON.stringify(json)) as unknown;
      });
      next = { doc, sources: state.sources };
    }
    state = next;
    const after = await hash(state);
    events.push({ sequence: events.length + 1, source: "editor", steps, beforeDocumentHash: before, afterDocumentHash: after } as EvidenceEventV3);
    before = after;
  }
  if (events.length === 0) return null;
  const segment = {
    initialDocumentHash: initial,
    finalDocumentHash: before,
    events,
    captureContext: { editorModel: "prosemirror", transactionFormat: "ductus-edit-steps-v2" },
  } as unknown as EvidenceSegmentV2;
  return { segment, final: state, clean };
}

const citations = (state: EditStepsV2Document) => {
  const found: string[] = [];
  state.doc.descendants((node) => {
    if (node.type.name === "citation") found.push(canonicalizeJcs(node.attrs as JcsJsonValue));
  });
  return found;
};

const isSubsequence = (small: string[], large: string[]) => {
  let i = 0;
  for (const item of large) if (item === small[i]) i++;
  return i === small.length;
};

test.prop([fc.array(op, { minLength: 1, maxLength: 8 })], { numRuns: 200 })(
  "(f) random v2 edits replay alike on the server and in the browser, and as in the editor",
  async (ops) => {
    const run = await segmentOf(ops);
    if (!run) return;
    const onServer = await replayEvidenceSegmentsV2(start, [run.segment], server);
    expect(await replayEvidenceSegmentsV2(start, [run.segment], browser)).toEqual(onServer);
    if (run.clean) {
      expect(onServer).toMatchObject({ ok: true, canonicalDocument: canonicalizeJcs(server.toCanonical(run.final)) });
    }
  },
);

test.prop([fc.array(op, { minLength: 1, maxLength: 8 })], { numRuns: 200 })(
  "(g) no accepted event changes a citation except a removal with a hash",
  async (ops) => {
    const run = await segmentOf(ops);
    if (!run) return;
    let state = server.load(start);
    for (const event of run.segment.events as unknown as EvidenceEventV3[]) {
      let next: EditStepsV2Document;
      try {
        next = server.apply(state, event);
      } catch {
        return; // refused: nothing changed
      }
      const removes = (event.steps as Record<string, unknown>[])
        .some((step) => step.stepType === "replace" && "removedSha256" in step);
      if (!removes) expect(isSubsequence(citations(state), citations(next))).toBe(true);
      state = next;
    }
  },
);
