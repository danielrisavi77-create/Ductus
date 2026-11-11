// @vitest-environment node
import { fc, test } from "@fast-check/vitest";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { describe, expect, it, vi } from "vitest";

import { EDIT_STEP_FORMAT_V1, EDIT_STEP_FORMAT_V2, EDIT_STEP_REJECTIONS, parseEditSteps } from "@/domain/document/edit-step";
import {
  digestCanonicalDocumentV2,
  EvidenceContentNotSupportedV2,
  replayEvidenceSegmentsV2,
  type AsyncEvidenceStepReplayerV2,
} from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceEventV3, EvidenceSegmentV2 } from "@/domain/forensics/evidence-segment-v2";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";

import { createBrowserEditStepsV1Replayer } from "./edit-steps-v1-browser-replayer";
import { createEditStepsV1Replayer, EditStepReplayRefusal, removedRangeSha256 } from "./edit-steps-v1-replayer";
import { removedRangeCanonical } from "./edit-steps-v1-rules";

/**
 * DAN-320, plan #1504 (PR B): fuzz of the edit step parser (P5) and of the
 * `ductus-edit-steps-v1` replayer through both drivers (P6), over the input
 * classes K4, K10, K13 and K14. Generated content only, never a real text.
 */

const IDS = [1, 2, 3].map((n) => `cccccccc-0000-4000-8000-00000000000${n}`);
const OTHER_HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const RULE_CODES = [
  "position_outside_document", "position_splits_surrogate_pair", "removed_range_record", "removed_range_hash",
  "open_start_block", "open_end_block", "replace_around_range", "replace_around_identity",
  "replace_around_unchanged", "attr_identity", "step_reads_back_differently", "step_does_not_apply",
  "step_changes_nothing",
];
/** Every way one event may end: applied, refused with a known code, unreadable here, or a ProseMirror error. */
const OUTCOME = new RegExp(`^(ok:|unsupported:|threw:(RangeError|ReplaceError|TransformError): |refused:(${[...EDIT_STEP_REJECTIONS, ...RULE_CODES].join("|")})$)`);

type Driver = AsyncEvidenceStepReplayerV2<PmNode>;
const server = createEditStepsV1Replayer();
const browser = createBrowserEditStepsV1Replayer();

const piece = fc.constantFrom("a", "Ž", "\u{1F600}", "riječ ", "č", "​", "x y");
const words = fc.array(piece, { minLength: 1, maxLength: 4 }).map((parts) => parts.join(""));
const SHAPES: { type: string; level?: number }[] = [{ type: "paragraph" }, { type: "bulletItem" }, { type: "quote" },
  { type: "heading", level: 1 }, { type: "heading", level: 2 }, { type: "heading", level: 3 }];
/** One to three blocks of plain text; ids are fixed, so every document is valid by construction. */
const documentArb: fc.Arbitrary<JcsJsonValue> = fc
  .array(fc.tuple(fc.constantFrom(...SHAPES), words), { minLength: 1, maxLength: 3 })
  .map((blocks): JcsJsonValue => ({
    schemaVersion: 1,
    nodes: blocks.map(([shape, text], i) => ({ ...shape, id: IDS[i], children: [{ type: "text", text, marks: [] }] }) as JcsJsonValue),
  }));
const schema = server.load(fc.sample(documentArb, { seed: 1, numRuns: 1 })[0]).type.schema;

type Spot = { block: PmNode; start: number; cuts: number[]; splits: number[] };
/** Per block: where it starts, the positions between characters and those inside a surrogate pair. */
function spots(document: PmNode): Spot[] {
  const out: Spot[] = [];
  document.forEach((block, start) => {
    const text = block.textContent;
    const spot: Spot = { block, start, cuts: [], splits: [] };
    for (let i = 0; i <= text.length; i++) {
      const high = (text.charCodeAt(i - 1) & 0xfc00) === 0xd800 && (text.charCodeAt(i) & 0xfc00) === 0xdc00;
      (high ? spot.splits : spot.cuts).push(start + 1 + i);
    }
    out.push(spot);
  });
  return out;
}
const pick = <T>(list: readonly T[], n: number): T => list[n % list.length];
/** A non-empty range of whole characters inside one block. */
function rangeIn(spot: Spot, a: number, b: number): [number, number] {
  const i = a % (spot.cuts.length - 1);
  return [spot.cuts[i], spot.cuts[i + 1 + (b % (spot.cuts.length - 1 - i))]];
}

type Edit = { kind: "delete" | "insert" | "mark" | "retype" | "split"; block: number; a: number; b: number; text: string };
const editArb: fc.Arbitrary<Edit> = fc.record({
  kind: fc.constantFrom("delete", "insert", "mark", "retype", "split"),
  block: fc.nat(), a: fc.nat(), b: fc.nat(), text: piece,
});
type StepJson = Record<string, unknown> & { from: number; to: number };

/** What capture does: ProseMirror's own steps, plus the hash of each removed range. Every edit here changes the document. */
function capture(document: PmNode, edit: Edit): { steps: StepJson[]; after: PmNode } {
  const spot = pick(spots(document), edit.block);
  const [from, to] = rangeIn(spot, edit.a, edit.b);
  const tr = new Transform(document);
  if (edit.kind === "delete") tr.delete(from, to);
  if (edit.kind === "insert") tr.insert(from, schema.text(edit.text));
  if (edit.kind === "mark") tr.addMark(from, to, schema.marks[pick(["bold", "italic"], edit.b)].create());
  if (edit.kind === "split") tr.split(from, 1, [{ type: spot.block.type, attrs: { ...spot.block.attrs, nodeId: null } }]);
  if (edit.kind === "retype") {
    const others = SHAPES.filter((s) => s.type !== spot.block.type.name || s.level !== (spot.block.attrs.level as unknown));
    const { type, ...attrs } = pick(others, edit.a);
    tr.setBlockType(from, from, schema.nodes[type], { ...attrs, nodeId: spot.block.attrs.nodeId as string });
  }
  const steps = tr.steps.map((step, i) => {
    const json = JSON.parse(JSON.stringify(step.toJSON())) as StepJson;
    if (json.stepType === "replace" && json.to > json.from) json.removedSha256 = removedRangeSha256(tr.docs[i], json.from, json.to);
    return json;
  });
  return { steps, after: tr.doc };
}

const event = (steps: unknown, before = OTHER_HASH, after = OTHER_HASH) =>
  ({ sequence: 1, source: "editor", steps, beforeDocumentHash: before, afterDocumentHash: after }) as EvidenceEventV3;
const hashOf = async (document: PmNode) => {
  try {
    return (await digestCanonicalDocumentV2(server.toCanonical(document))).sha256;
  } catch {
    return OTHER_HASH; // a block without an id has no canonical form
  }
};
async function segmentOf(document: PmNode, steps: unknown, after?: PmNode): Promise<EvidenceSegmentV2> {
  const [initial, final] = [await hashOf(document), after ? await hashOf(after) : OTHER_HASH];
  return {
    initialDocumentHash: initial, finalDocumentHash: final, events: [event(steps, initial, final)],
    captureContext: { editorModel: "prosemirror", transactionFormat: EDIT_STEP_FORMAT_V1 },
  } as EvidenceSegmentV2;
}

/** The end of one event in one driver, with the internal code the replay itself hides. */
async function outcome(driver: Driver, document: PmNode, steps: unknown): Promise<string> {
  try {
    return `ok:${JSON.stringify((await driver.apply(document, event(steps))).toJSON())}`;
  } catch (error) {
    if (error instanceof EditStepReplayRefusal) return `refused:${error.code}`;
    if (error instanceof EvidenceContentNotSupportedV2) return `unsupported:${error.kind}`;
    return `threw:${error instanceof Error ? `${error.name}: ${error.message}` : typeof error}`;
  }
}

/**
 * N-24 and N-27 for one event: both drivers end alike, with the same internal
 * code, and the replay of the segment never rejects and reports what the
 * driver did. Returns the common outcome.
 */
async function alike(initial: JcsJsonValue, steps: unknown, after?: PmNode): Promise<string> {
  const document = server.load(initial);
  const onServer = await outcome(server, document, steps);
  expect(await outcome(browser, document, steps)).toBe(onServer);
  expect(onServer).toMatch(OUTCOME);
  const segment = await segmentOf(document, steps, after);
  const replay = await replayEvidenceSegmentsV2(initial, [segment], server);
  expect(await replayEvidenceSegmentsV2(initial, [segment], browser)).toEqual(replay);
  const failed = (reason: string) => ({ ok: false, reason, segmentIndex: 0, sequence: 1 });
  if (onServer.startsWith("unsupported:")) expect(replay).toEqual(failed("unsupported_format"));
  else if (!onServer.startsWith("ok:")) expect(replay).toEqual(failed("step_failed"));
  else if (!replay.ok) expect(["step_failed", "document_hash_mismatch"]).toContain(replay.reason);
  return onServer;
}
const applied = (after: PmNode) => `ok:${JSON.stringify(after.toJSON())}`;

describe("P5 parseEditSteps fuzz (N-23)", () => {
  const format = fc.constantFrom(EDIT_STEP_FORMAT_V1, EDIT_STEP_FORMAT_V2);
  const anything = fc.anything({ withBigInt: true, withDate: true, withMap: true, withNullPrototype: true, withTypedArray: true });

  test.prop([anything, anything])("an unknown format is refused before the steps are read", (given, steps) => {
    const unknown = given === EDIT_STEP_FORMAT_V1 || given === EDIT_STEP_FORMAT_V2 ? `${given} ` : given;
    expect(parseEditSteps(unknown, steps)).toEqual({ ok: false, code: "unsupported_format", path: "$" });
  });

  test.prop([format, fc.oneof(fc.string(), fc.double(), fc.boolean(), fc.constant(null), fc.dictionary(fc.string(), fc.jsonValue()))])(
    "K4: steps that are not a list, and an empty list, are refused by name",
    (name, steps) => {
      expect(parseEditSteps(name, steps)).toEqual({ ok: false, code: "steps_not_array", path: "$" });
      expect(parseEditSteps(name, [])).toEqual({ ok: false, code: "steps_empty", path: "$" });
    },
  );

  test.prop([format, fc.oneof(anything, fc.array(fc.jsonValue()), fc.array(fc.dictionary(fc.constantFrom("stepType", "from", "to", "slice", "pos"), fc.jsonValue())))])(
    "K4: any value ends in a result from the closed list, never in a throw",
    (name, steps) => {
      const result = parseEditSteps(name, steps);
      if (result.ok) {
        // What the reader accepts is canonical: it reads back as itself.
        expect(parseEditSteps(name, JSON.parse(canonicalizeJcs(result.steps as unknown as JcsJsonValue)))).toEqual(result);
      } else {
        expect(EDIT_STEP_REJECTIONS).toContain(result.code);
        expect(result.path).toMatch(/^\$/);
      }
    },
  );

  const hostile: Record<string, () => unknown> = {
    getter: () => [Object.defineProperty({ stepType: "attr" }, "pos", { enumerable: true, get: () => { throw new Error("getter"); } })],
    proxy: () => [new Proxy({}, { ownKeys: () => { throw new Error("proxy"); } })],
    listProxy: () => new Proxy([], { get: () => { throw new Error("proxy"); } }),
    cycle: () => { const step: Record<string, unknown> = { stepType: "replace", from: 1, to: 1 }; step.slice = step; return [step]; },
    deep: () => { let slice: unknown = "x"; for (let i = 0; i < 20_000; i++) slice = { content: [slice] }; return [{ stepType: "replace", from: 1, to: 1, slice }]; },
    holes: () => Object.assign(new Array(3), { 1: { stepType: "attr" } }),
  };
  test.prop([format, fc.constantFrom(...Object.keys(hostile))])("K4: a hostile object is refused, never thrown", (name, kind) => {
    const result = parseEditSteps(name, hostile[kind]());
    expect(result.ok).toBe(false);
    expect(EDIT_STEP_REJECTIONS).toContain((result as { code: string }).code);
  });
});

describe("P6 edit steps v1 replayer fuzz, server and browser driver", () => {
  test.prop([documentArb, editArb])("N-24, N-26, N-27: a captured edit is applied by both drivers to the edited document", async (initial, edit) => {
    const { steps, after } = capture(server.load(initial), edit);
    expect(steps.length).toBeGreaterThan(0); // N-26: no run without a step
    // A divided block has a tail without an id, so that event alone has no canonical document.
    const split = edit.kind === "split";
    expect(await alike(initial, steps, after)).toBe(applied(after));
    const replay = await replayEvidenceSegmentsV2(initial, [await segmentOf(server.load(initial), steps, after)], browser);
    expect(replay).toMatchObject(split ? { ok: false, reason: "step_failed" } : { ok: true, documentSha256: await hashOf(after) });
  });

  test.prop([documentArb, fc.oneof(fc.jsonValue(), fc.array(fc.jsonValue(), { minLength: 1 }))])(
    "K4: random JSON as the steps of an event is never applied",
    async (initial, steps) => {
      expect(await alike(initial, steps)).not.toMatch(/^ok:/);
    },
  );

  type Slot = { holder: Record<string, unknown>; key: string };
  function slots(value: unknown, out: Slot[] = []): Slot[] {
    if (typeof value === "object" && value !== null) {
      for (const key of Object.keys(value)) {
        out.push({ holder: value as Record<string, unknown>, key });
        slots((value as Record<string, unknown>)[key], out);
      }
    }
    return out;
  }
  const mutationArb = fc.record({
    slot: fc.nat(),
    kind: fc.constantFrom("drop", "set", "add"),
    key: fc.constantFrom("extra", "__proto__", "constructor", "type", "structure", "removedSha256", "openStart", "insert"),
    value: fc.oneof(fc.jsonValue(), fc.constantFrom<unknown>(-1, -0, 0, 1, 2, 1.5, NaN, Infinity, 2 ** 53, 1e6, true, null, "",
      "figure", "paragraph", "heading", "bold", "addMark", "removeMark", "replace", IDS[0], IDS[2], OTHER_HASH, [], {})),
  });
  /** K13: one field of a valid step dropped, overwritten or added. */
  function mutate(steps: StepJson[], m: { slot: number; kind: string; key: string; value: unknown }): unknown[] {
    const copy = structuredClone(steps) as unknown[];
    const { holder, key } = pick(slots(copy), m.slot);
    if (m.kind === "drop") delete holder[key];
    if (m.kind === "set") holder[key] = m.value;
    const inner = holder[key];
    const target = typeof inner === "object" && inner !== null && !Array.isArray(inner) ? inner : holder;
    // defineProperty, so that `__proto__` becomes an own key as JSON.parse would make it.
    if (m.kind === "add") Object.defineProperty(target, m.key, { value: m.value, enumerable: true, writable: true, configurable: true });
    return copy;
  }

  test.prop([documentArb, editArb, mutationArb])("K13, N-24, N-27: a step one field away from a valid one ends alike in both drivers", async (initial, edit, mutation) => {
    const { steps, after } = capture(server.load(initial), edit);
    await alike(initial, mutate(steps, mutation), after);
  });

  test.prop([documentArb, fc.nat(), fc.nat(), fc.nat(), fc.nat(), fc.nat(), fc.nat({ max: 63 })])(
    "N-25, K14 (B-12): only the hash of the removed range itself is accepted",
    async (initial, block, a, b, otherBlock, c, flip) => {
      const document = server.load(initial);
      const { steps, after } = capture(document, { kind: "delete", block, a, b, text: "" });
      expect(steps).toHaveLength(1); // N-26: every run removes a range that has a hash
      const [{ removedSha256, ...bare }] = steps as [StepJson & { removedSha256: string }];
      const tried = (hash: Record<string, unknown>) => alike(initial, [{ ...bare, ...hash }], after);
      expect(await tried({ removedSha256 })).toBe(applied(after));

      const flipped = removedSha256.slice(0, flip) + (removedSha256[flip] === "0" ? "1" : "0") + removedSha256.slice(flip + 1);
      expect(await tried({ removedSha256: flipped })).toBe("refused:removed_range_hash");
      expect(await tried({ removedSha256: OTHER_HASH })).toBe("refused:removed_range_hash");
      // The hash of another range of the same document passes exactly when that range holds the same content.
      const [from, to] = rangeIn(pick(spots(document), otherBlock), c, a);
      const same = removedRangeCanonical(document, from, to) === removedRangeCanonical(document, bare.from, bare.to);
      expect(await tried({ removedSha256: removedRangeSha256(document, from, to) })).toBe(same ? applied(after) : "refused:removed_range_hash");
      const upper = removedSha256.toUpperCase();
      expect(await tried({ removedSha256: upper === removedSha256 ? `A${upper.slice(1)}` : upper })).toBe("refused:invalid_removed_hash");
      expect(await tried({})).toBe("refused:missing_field");
      // `structure` over text: the reader lets through only the width of a join, and the rules then see the text.
      const width = bare.to - bare.from;
      const structural = width === 2 ? "removed_range_record" : width === 1 ? "not_canonical" : "invalid_position";
      expect(await tried({ structure: true })).toBe(`refused:${structural}`);
      expect(await tried({ removedSha256, structure: true })).toBe("refused:invalid_removed_hash");
    },
  );

  test.prop([documentArb, fc.nat(), fc.nat({ max: 1000 }), fc.constantFrom(-1, 1.5, -0.5, NaN, Infinity, -Infinity, 2 ** 53), fc.constantFrom("bold", "italic")])(
    "N-28, K10: a position outside the document, not a position, or inside a surrogate pair is refused by name",
    async (given, block, beyond, notPosition, mark) => {
      // One emoji at the end of the first block, so that a position inside a pair always exists.
      const nodes = (given as { nodes: { children: { text: string }[] }[] }).nodes;
      nodes[0].children[0].text += "\u{1F600}";
      const document = server.load(given);
      const outside = document.content.size + 1 + beyond;
      const inPair = pick(spots(document)[0].splits, block);
      const text = { content: [{ type: "text", text: "a" }] };
      const shapes = (p: number, from: number, to: number) => [
        { stepType: "replace", from: p, to: p, slice: text },
        { stepType: "addMark", from, to, mark: { type: mark } },
        { stepType: "removeMark", from, to, mark: { type: mark } },
        { stepType: "attr", pos: p, attr: "nodeId", value: IDS[0] },
      ];
      for (const step of shapes(outside, 1, outside)) expect(await alike(given, [step])).toBe("refused:position_outside_document");
      for (const step of shapes(inPair, inPair, inPair + 1)) expect(await alike(given, [step])).toBe("refused:position_splits_surrogate_pair");
      for (const step of shapes(notPosition, notPosition, 2)) expect(await alike(given, [step])).toBe("refused:invalid_position");
    },
  );

  test.prop([documentArb, fc.nat(), fc.nat(), fc.uuid({ version: 4 })])(
    "N-29: a block keeps its identity through attr, replaceAround and the open sides of a slice",
    async (initial, block, a, foreign) => {
      const document = server.load(initial);
      const spot = pick(spots(document), block);
      const attr = { stepType: "attr", pos: spot.start, attr: "nodeId", value: foreign };
      expect(await alike(initial, [attr])).toBe("refused:attr_identity");

      type Wrapped = StepJson & { slice: { content: { type: string; attrs: Record<string, unknown> }[] } };
      const edited = (step: Wrapped, change: (step: Wrapped) => void) => {
        const copy = structuredClone(step);
        change(copy);
        return alike(initial, [copy]);
      };
      const around = capture(document, { kind: "retype", block, a, b: 0, text: "" });
      expect(around.steps).toHaveLength(1);
      const wrap = around.steps[0] as Wrapped;
      expect(wrap.stepType).toBe("replaceAround");
      expect(await alike(initial, [wrap], around.after)).toBe(applied(around.after));
      expect(await edited(wrap, (s) => (s.slice.content[0].attrs.nodeId = foreign))).toBe("refused:replace_around_identity");
      const { level } = spot.block.attrs as { level?: number };
      const unchanged = { type: spot.block.type.name, attrs: { nodeId: spot.block.attrs.nodeId as string, ...(level ? { level } : {}) } };
      expect(await edited(wrap, (s) => (s.slice.content[0] = unchanged))).toBe("refused:replace_around_unchanged");

      const divided = capture(document, { kind: "split", block, a, b: 0, text: "" });
      const split = divided.steps[0] as Wrapped;
      expect(await alike(initial, [split], divided.after)).toBe(applied(divided.after));
      expect(await edited(split, (s) => (s.slice.content[0].attrs.nodeId = foreign))).toBe("refused:open_start_block");
      expect(await edited(split, (s) => (s.slice.content[1].attrs.nodeId = foreign))).toBe("refused:open_end_block");
    },
  );

  const caseArb = fc.tuple(documentArb, editArb, fc.option(mutationArb, { nil: undefined }));
  test.prop([fc.array(caseArb, { minLength: 2, maxLength: 5 })])("N-35: replays run together end as the same replays run one by one", async (cases) => {
    const jobs: (() => ReturnType<typeof replayEvidenceSegmentsV2>)[] = [];
    for (const [initial, edit, mutation] of cases) {
      const { steps, after } = capture(server.load(initial), edit);
      const segment = await segmentOf(server.load(initial), mutation ? mutate(steps, mutation) : steps, after);
      for (const driver of [server, browser]) jobs.push(() => replayEvidenceSegmentsV2(initial, [segment], driver));
    }
    const serial = [];
    for (const job of jobs) serial.push(await job());
    expect(await Promise.all(jobs.map((job) => job()))).toEqual(serial);
  });

  it("N-35: the first replays of a fresh module, started together, build the schema once and agree", async () => {
    const [initial] = fc.sample(documentArb, { seed: 7, numRuns: 1 });
    const { steps, after } = capture(server.load(initial), { kind: "delete", block: 0, a: 0, b: 0, text: "" });
    const segment = await segmentOf(server.load(initial), steps, after);
    const expected = await replayEvidenceSegmentsV2(initial, [segment], server);
    expect(expected.ok).toBe(true);
    vi.resetModules(); // the schema of the rules module is built on first use
    const fresh = await import("@/domain/forensics/evidence-replay-v2");
    const drivers: Driver[] = [
      (await import("./edit-steps-v1-replayer")).createEditStepsV1Replayer(),
      (await import("./edit-steps-v1-browser-replayer")).createBrowserEditStepsV1Replayer(),
    ];
    const together = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => fresh.replayEvidenceSegmentsV2(initial, [segment], drivers[i % 2])));
    for (const result of together) expect(result).toEqual(expected);
    expect(drivers[0].load(initial).type.schema).toBe(drivers[1].load(initial).type.schema);
    expect(drivers[0].load(initial).type.schema).not.toBe(schema);
  });
});
