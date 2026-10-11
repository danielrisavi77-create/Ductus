// @vitest-environment node
import { readFileSync } from "node:fs";

import { getSchema } from "@tiptap/core";
import { Slice, type Node as PmNode, type Schema } from "@tiptap/pm/model";
import { Step, Transform } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";

import { createEditorExtensions } from "@/editor/schema";
import { sha256WebCrypto } from "@/domain/forensics/crypto";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";

import {
  EDIT_STEP_FORMAT_V1,
  EDIT_STEP_REJECTIONS,
  EDIT_STEP_TYPES,
  MAX_EDIT_STEP_BYTES,
  parseEditStep,
  parseEditSteps,
  type EditStepRejection,
} from "./edit-step";

/**
 * Golden vectors of the edit-step format (attack plan #203). All data is
 * invented.
 *
 * The expected canonical strings and hashes in `edit-step.vectors.json` were
 * derived outside the code under test (Python `json` and `hashlib`). A test
 * that fails against them found a change of the format: fix the code or raise
 * the change, never regenerate the file from this module.
 */
type Accepted = { name: string; input: unknown; canonical: string; sha256: string };
type Rejected = { name: string; input: unknown; code: EditStepRejection; path: string };
const vectors = JSON.parse(
  readFileSync(new URL("./edit-step.vectors.json", import.meta.url), "utf8"),
) as { format: string; accepted: Accepted[]; rejected: Rejected[] };

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "aaaaaaaa-0000-4000-8000-000000000002";
const HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const typing = () => ({
  stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: "a" }] },
});

describe("edit step format: golden vectors", () => {
  it("names the format the vectors were written for", () => {
    expect(vectors.format).toBe(EDIT_STEP_FORMAT_V1);
    expect(vectors.accepted.length).toBeGreaterThan(0);
    expect(vectors.rejected.length).toBeGreaterThan(0);
  });

  it.each(vectors.accepted)("accepts: $name", async (vector) => {
    const result = parseEditStep(vector.input);
    if (!result.ok) throw new Error(`${result.code} at ${result.path}`);
    // Same bytes from the plain serialiser and from RFC 8785, and the same
    // hash as the independently derived one.
    expect(JSON.stringify(result.step)).toBe(vector.canonical);
    expect(canonicalizeJcs(result.step as JcsJsonValue)).toBe(vector.canonical);
    expect(await sha256WebCrypto(vector.canonical)).toBe(vector.sha256);
    // Nothing was added, dropped or rewritten.
    expect(result.step).toEqual(vector.input);
    expect(result.step).not.toBe(vector.input);
  });

  it.each(vectors.rejected)("rejects: $name", (vector) => {
    expect(parseEditStep(vector.input)).toEqual({
      ok: false, code: vector.code, path: vector.path,
    });
    expect(parseEditSteps(EDIT_STEP_FORMAT_V1, [typing(), vector.input])).toMatchObject({
      ok: false, code: vector.code,
    });
  });

  it("covers every step type and only declared rejection codes", () => {
    const types = new Set(vectors.accepted.map((v) => (v.input as { stepType: string }).stepType));
    expect([...types].sort()).toEqual([...EDIT_STEP_TYPES].sort());
    for (const vector of vectors.rejected) {
      expect(EDIT_STEP_REJECTIONS).toContain(vector.code);
    }
  });

  it("keeps NFC and NFD apart: text is never normalised", () => {
    const hashes = vectors.accepted.filter((v) => v.name.startsWith("text in NF")).map((v) => v.sha256);
    expect(new Set(hashes).size).toBe(2);
  });
});

describe("edit step format: hostile input", () => {
  it("does not pollute a prototype, whatever a forged key carries", () => {
    for (const vector of vectors.rejected.filter((v) => v.code === "forbidden_key")) {
      parseEditStep(vector.input);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("reads own keys only, enumerable or not, and never symbols", () => {
    const inherited = Object.assign(Object.create({ stepType: "replace" }), { from: 1, to: 1 });
    expect(parseEditStep(inherited)).toMatchObject({ ok: false, code: "not_object" });
    const hidden = Object.defineProperty(typing(), "occurredAt", { value: 1, enumerable: false });
    expect(parseEditStep(hidden)).toMatchObject({ ok: false, code: "unknown_field" });
    const symbol = { ...typing(), [Symbol("at")]: 1 };
    expect(parseEditStep(symbol)).toMatchObject({ ok: false, code: "forbidden_key" });
    expect(parseEditStep(new (class Step {})())).toMatchObject({ ok: false, code: "not_object" });
  });

  it("never throws: a throwing getter or a revoked proxy is refused", () => {
    const getter = Object.defineProperty({ stepType: "replace", to: 1 }, "from", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(parseEditStep(getter)).toEqual({ ok: false, code: "unreadable", path: "$" });
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(parseEditStep(proxy)).toEqual({ ok: false, code: "unreadable", path: "$" });
    expect(parseEditSteps(EDIT_STEP_FORMAT_V1, [proxy])).toMatchObject({ ok: false });
  });

  it("refuses holes, -0 and non-finite numbers", () => {
    const sparse = typing();
    sparse.slice.content = new Array(2) as never;
    expect(parseEditStep(sparse)).toMatchObject({ ok: false, code: "not_object" });
    for (const from of [-0, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(parseEditStep({ ...typing(), from })).toMatchObject({
        ok: false, code: "invalid_position",
      });
    }
  });

  it("refuses oversized input before copying or scanning it", () => {
    const endless = { ...typing(), slice: { content: new Array(2 ** 31) } };
    expect(parseEditStep(endless)).toMatchObject({ ok: false, code: "too_large" });
    const long = { ...typing(), slice: { content: [{ type: "text", text: "a".repeat(50_000_000) }] } };
    const started = performance.now();
    expect(parseEditStep(long)).toMatchObject({ ok: false, code: "too_large" });
    // Refused on its length alone; scanning it took about a second.
    expect(performance.now() - started).toBeLessThan(300);
  });

  // 100 000 text nodes of 40 characters pass the limit long before the last
  // one, which is invalid and would be the answer if it were ever read. The
  // place where reading stops shows how many bytes each character was counted as.
  it.each([
    ["one-byte letters", "a", 37_000, 38_000],
    ["three-byte characters", "€", 15_000, 16_000],
  ])("stops inside an oversized step of %s instead of reading it to its end", (_name, unit, min, max) => {
    const content: unknown[] = Array.from({ length: 100_000 }, (_, i) => ({
      type: "text", text: unit.repeat(40), ...(i % 2 ? { marks: [{ type: "bold" }] } : {}),
    }));
    content[content.length - 1] = { type: "text", text: "" };
    const result = parseEditStep({ ...typing(), slice: { content } });
    if (result.ok) throw new Error("accepted");
    expect(result.code).toBe("too_large");
    const stoppedAt = Number(/^\$\.slice\.content\[(\d+)\]$/.exec(result.path)?.[1]);
    expect(stoppedAt).toBeGreaterThan(min);
    expect(stoppedAt).toBeLessThan(max);
  });

  // QA of #213 (third round, M2). The engine lists every key of an object
  // before the first can be read, so this is refused correctly but not early.
  // What bounds the cost is the size of the request body, checked by the route
  // before `JSON.parse`: within the D-96 limit an object has few enough keys.
  it("refuses an object with as many keys as fit the size limit", () => {
    // `"k…":1,` is at least six bytes a key: 2 MiB hold fewer than 350 000.
    const crowded: Record<string, unknown> = { ...typing() };
    for (let i = 0; i < 350_000; i += 1) crowded[`k${i}`] = 1;
    expect(JSON.stringify(crowded).length).toBeGreaterThan(MAX_EDIT_STEP_BYTES);
    const unknownKind = { ...crowded, stepType: "undo" };
    const started = performance.now();
    expect(parseEditStep(crowded)).toEqual({ ok: false, code: "unknown_field", path: "$.k0" });
    expect(parseEditStep(unknownKind)).toEqual({
      ok: false, code: "unknown_step_type", path: "$.stepType",
    });
    // Linear in the keys: well under a second. Looking every key up in a list
    // of all of them, as the unknown kind once did, took over a minute and a half.
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});

/**
 * Owner decision 3 (QA of #213, second round, B1): a block that a step creates
 * has no id, and gets one from an `attr` step of the same event. Otherwise the
 * same event could be written in two ways.
 */
describe("edit step format: a new block and its id", () => {
  const insert = (nodeId: string | null) => ({
    stepType: "replace", from: 12, to: 12,
    slice: { content: [{ type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text: "Q" }] }] },
  });

  it("refuses a new block that arrives with its id", () => {
    expect(parseEditStep(insert(A))).toEqual({
      ok: false, code: "new_block_has_id", path: "$.slice.content[0].attrs.nodeId",
    });
  });

  it("accepts the block without an id, followed by the step that names it", () => {
    const steps = [insert(null), { stepType: "attr", pos: 12, attr: "nodeId", value: A }];
    expect(parseEditSteps(EDIT_STEP_FORMAT_V1, steps)).toEqual({ ok: true, steps });
  });
});

/**
 * D-96 (#203 attack 8, QA of #213 B1): the limit is 2 097 152 bytes of the
 * canonical form, exactly. The sizes below were counted outside the module
 * (Python `json`): a typing step without its text is 86 bytes, a deletion
 * with one-digit positions 121, an attribute step with a one-digit position 90.
 */
describe("edit step format: the D-96 size limit, to the byte", () => {
  const MAX = 2_097_152;
  const TYPING_OVERHEAD = 86;
  const DELETION = 121;
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  const typed = (text: string) => ({ ...typing(), slice: { content: [{ type: "text", text }] } });
  /** A deletion whose `to` has `extra` more digits than one. */
  const deletion = (extra = 0) => ({
    stepType: "replace", from: 1, to: extra === 0 ? 2 : 10 ** extra, removedSha256: HASH,
  });

  it("is the limit D-96 names", () => {
    expect(MAX_EDIT_STEP_BYTES).toBe(MAX);
  });

  it.each([
    ["ASCII text", (n: number) => "a".repeat(n), 1],
    ["two-byte letters", (n: number) => "š".repeat(n / 2), 2],
    // Three bytes each: the euro sign, a line separator, a zero-width space.
    ["three-byte characters", (n: number) => "€ ​".repeat(Math.floor(n / 9)) + "a".repeat(n % 9), 3],
    ["four-byte characters", (n: number) => "😀".repeat((n - 2) / 4) + "ab", 4],
    // The last plane: its high surrogate is U+DBFF, the end of the range.
    ["four-byte characters of plane 16", (n: number) => "\u{10FFFD}".repeat((n - 2) / 4) + "ab", 4],
    ["characters JSON escapes", (n: number) => '"'.repeat(n / 2), 2],
    // U+001F is written \u001f, six bytes; the rest is filled with ASCII.
    ["control characters", (n: number) => "\u001f".repeat(Math.floor(n / 6)) + "a".repeat(n % 6), 6],
  ])("one large step of %s: exactly the limit is accepted, one byte more is not", (_name, fill) => {
    const text = fill(MAX - TYPING_OVERHEAD);
    const atLimit = parseEditStep(typed(text));
    if (!atLimit.ok) throw new Error(`${atLimit.code} at ${atLimit.path}`);
    expect(bytes(atLimit.step)).toBe(MAX);
    expect(parseEditStep(typed(`${text}a`))).toEqual({ ok: false, code: "too_large", path: "$" });
    // A list of one step costs its two brackets as well.
    expect(parseEditSteps(EDIT_STEP_FORMAT_V1, [typed(text)])).toMatchObject({ code: "too_large" });
    expect(parseEditSteps(EDIT_STEP_FORMAT_V1, [typed(text.slice(2))]).ok).toBe(true);
  });

  it("many small steps: exactly the limit is accepted, one byte more is not", () => {
    // n steps cost n * 121, n - 1 commas and two brackets: 122 n + 1.
    const count = Math.floor((MAX - 1) / (DELETION + 1));
    const spare = MAX - (count * (DELETION + 1) + 1);
    expect([count, spare]).toEqual([17189, 93]);
    // 93 spare bytes: six steps with fifteen more digits, one with three.
    const steps = Array.from({ length: count }, (_, i) => deletion(i < 6 ? 15 : i === 6 ? 3 : 0));
    const atLimit = parseEditSteps(EDIT_STEP_FORMAT_V1, steps);
    if (!atLimit.ok) throw new Error(`${atLimit.code} at ${atLimit.path}`);
    expect(bytes(atLimit.steps)).toBe(MAX);

    const oneDigitMore = steps.map((step, i) => (i === count - 1 ? deletion(1) : step));
    expect(parseEditSteps(EDIT_STEP_FORMAT_V1, oneDigitMore)).toEqual({
      ok: false, code: "too_large", path: `$[${count - 1}]`,
    });
    expect(parseEditSteps(EDIT_STEP_FORMAT_V1, [...steps, deletion()])).toMatchObject({
      ok: false, code: "too_large", path: `$[${count}]`,
    });
  });

  it("refuses the oversized events QA measured as accepted", () => {
    const attr = { stepType: "attr", pos: 1, attr: "nodeId", value: A };
    for (const [step, count] of [[attr, 131_072], [attr, 40_000], [deletion(), 20_000]] as const) {
      const steps = Array.from({ length: count }, () => step);
      expect(bytes(steps)).toBeGreaterThan(MAX);
      expect(parseEditSteps(EDIT_STEP_FORMAT_V1, steps)).toMatchObject({
        ok: false, code: "too_large",
      });
    }
    // 23 301 attribute steps of 90 bytes are 2 120 392 bytes; 23 045 are 2 097 096.
    const fits = Array.from({ length: 23_045 }, () => attr);
    expect(bytes(fits)).toBe(2_097_096);
    expect(parseEditSteps(EDIT_STEP_FORMAT_V1, fits).ok).toBe(true);
  });
});

describe("parseEditSteps", () => {
  it.each(["ductus-edit-steps-v2", "ductus-test-insert-text-v0", "", null, undefined, 1, ["x"]])(
    "refuses the unknown format %j before reading a step",
    (format) => {
      const trap = new Proxy([], {
        get() {
          throw new Error("steps were read");
        },
      });
      expect(parseEditSteps(format, trap)).toEqual({
        ok: false, code: "unsupported_format", path: "$",
      });
    },
  );

  it("refuses a missing, empty or non-array list", () => {
    expect(parseEditSteps(EDIT_STEP_FORMAT_V1, [])).toMatchObject({ code: "steps_empty" });
    for (const steps of [null, undefined, typing(), "[]", { length: 1, 0: typing() }]) {
      expect(parseEditSteps(EDIT_STEP_FORMAT_V1, steps)).toMatchObject({ code: "steps_not_array" });
    }
  });

  it("returns every step in order and points at the one that failed", () => {
    const mark = { stepType: "addMark", from: 1, to: 2, mark: { type: "bold" } };
    const parsed = parseEditSteps(EDIT_STEP_FORMAT_V1, [typing(), mark]);
    expect(parsed).toEqual({ ok: true, steps: [typing(), mark] });
    expect(parseEditSteps(EDIT_STEP_FORMAT_V1, [typing(), { ...mark, ts: 1 }])).toEqual({
      ok: false, code: "unknown_field", path: "$[1].ts",
    });
  });
});

/**
 * #203 attack 4: the client and the server replay with the same library, so
 * the lockfile may resolve each ProseMirror package to one version only.
 */
describe("edit step format: one ProseMirror for both sides", () => {
  it("resolves every prosemirror package to a single version", () => {
    const lock = readFileSync(new URL("../../../pnpm-lock.yaml", import.meta.url), "utf8");
    const versions = new Map<string, Set<string>>();
    for (const [, name, version] of lock.matchAll(/^ {2}'?(prosemirror-[a-z]+)@([^'(:\s]+)/gm)) {
      versions.set(name, (versions.get(name) ?? new Set()).add(version));
    }
    expect([...versions.keys()]).toEqual(
      expect.arrayContaining(["prosemirror-model", "prosemirror-transform", "prosemirror-state"]),
    );
    for (const [name, found] of versions) {
      expect([...found], name).toHaveLength(1);
    }
  });
});

/**
 * False-blocking control: the JSON that ProseMirror itself produces for
 * ordinary editing on the F1 schema must be accepted unchanged, and must mean
 * the same step when read back. Capture and replay are later steps; this only
 * pins that the closed shape matches the library.
 */
describe("edit step format: steps ProseMirror really produces", () => {
  const schema: Schema = getSchema(createEditorExtensions());
  const start: PmNode = schema.nodeFromJSON({
    type: "doc",
    content: [
      { type: "paragraph", attrs: { nodeId: A }, content: [{ type: "text", text: "Prvi izmišljeni odlomak." }] },
      { type: "heading", attrs: { nodeId: B, level: 2 }, content: [{ type: "text", text: "Naslov" }] },
    ],
  });
  const { paragraph, heading } = schema.nodes;
  const { bold, italic } = schema.marks;

  const edits: [string, (tr: Transform) => void][] = [
    ["typing", (tr) => tr.insert(5, schema.text("č"))],
    ["typing with both marks", (tr) => tr.insert(5, schema.text("ž", [italic.create(), bold.create()]))],
    ["deleting", (tr) => tr.delete(2, 6)],
    ["replacing", (tr) => tr.replaceWith(2, 6, schema.text("novo"))],
    ["splitting, new block without an id", (tr) => tr.split(5, 1, [{ type: paragraph, attrs: { nodeId: null } }])],
    ["joining", (tr) => tr.join(26)],
    ["paragraph to heading", (tr) => tr.setBlockType(1, 1, heading, { level: 1, nodeId: A })],
    ["heading to paragraph", (tr) => tr.setBlockType(27, 27, paragraph, { nodeId: B })],
    ["adding bold", (tr) => tr.addMark(1, 5, bold.create())],
    ["removing a mark", (tr) => tr.addMark(1, 9, italic.create()).removeMark(3, 6, italic.create())],
    ["giving a block an id", (tr) => tr.setNodeAttribute(26, "nodeId", A.replace(/1$/, "9"))],
    // Accepted by its shape only. The last block of the slice becomes the tail
    // of the paragraph that the paste divides, a new block, yet it carries the
    // id of the heading. The validator cannot see that without the document;
    // the replayer must refuse it, and capture must write the tail with `null`
    // and an `attr` step.
    ["pasting two blocks (shape only)", (tr) => tr.replace(5, 5, new Slice(start.content, 1, 1))],
    ["deleting across blocks", (tr) => tr.delete(20, 30)],
    ["inserting an empty block", (tr) => tr.insert(26, paragraph.create({ nodeId: null }))],
    ["inserting a block with text", (tr) => tr.insert(26, heading.create({ level: 3, nodeId: null }, schema.text("x")))],
  ];

  it.each(edits)("accepts %s", (_name, edit) => {
    const tr = new Transform(start);
    edit(tr);
    expect(tr.steps.length).toBeGreaterThan(0);
    let doc = start;
    for (const pmStep of tr.steps) {
      const json = pmStep.toJSON() as Record<string, unknown>;
      // Capture (a later step) adds the hash; here any well-formed one will do.
      if (json.stepType === "replace" && (json.to as number) > (json.from as number) && !json.structure) {
        json.removedSha256 = HASH;
      }
      const wire = JSON.parse(JSON.stringify(json)) as unknown;
      const result = parseEditStep(wire);
      if (!result.ok) throw new Error(`${result.code} at ${result.path}: ${JSON.stringify(wire)}`);
      expect(result.step).toEqual(wire);
      const applied = Step.fromJSON(schema, result.step).apply(doc);
      expect(applied.failed).toBeNull();
      doc = applied.doc as PmNode;
    }
    expect(doc.toJSON()).toEqual(tr.doc.toJSON());
  });

  // QA of #213 (third round, M3). A slice open at its end whose last block is
  // of another type changes the type of the block it continues and inserts
  // text in one step. Not intended: a change of type is `replaceAround` only.
  const retyped = { type: "heading", attrs: { level: 1, nodeId: A }, content: [{ type: "text", text: "Z" }] };

  // With one block the step alone shows it, whatever the document: one
  // position replaced by one block open at its end rewrites an opening.
  it("refuses a replace of one position by one block open at its end", () => {
    const step = { stepType: "replace", from: 0, to: 1, structure: true, slice: { content: [retyped], openEnd: 1 } };
    // ProseMirror would apply it and turn the paragraph into a heading.
    expect(Step.fromJSON(schema, step).apply(start).doc?.firstChild?.type.name).toBe("heading");
    expect(parseEditStep(step)).toEqual({ ok: false, code: "not_canonical", path: "$.slice" });
  });

  // Why that refusal blocks nothing legitimate: wherever ProseMirror can apply
  // a step of this shape, it does exactly one thing, it writes the block of
  // the slice over the opening of the block that starts there. So the opening
  // either comes back unchanged (the text alone is an insertion of text) or
  // is changed (`replaceAround`). Everywhere else the step does not apply.
  it("a step of that shape only ever rewrites the opening of a block", () => {
    const blocks = [
      { type: "paragraph", attrs: { nodeId: A } },
      { type: "paragraph", attrs: { nodeId: null }, content: [{ type: "text", text: "Z" }] },
      { type: "heading", attrs: { level: 2, nodeId: B }, content: [{ type: "text", text: "Z" }] },
      { type: "heading", attrs: { level: 3, nodeId: null } },
    ];
    const starts: number[] = [];
    start.forEach((_node, offset) => starts.push(offset));
    let applied = 0;
    for (let from = 0; from < start.content.size; from += 1) {
      for (const block of blocks) {
        const step = Step.fromJSON(schema, {
          stepType: "replace", from, to: from + 1, slice: { content: [block], openEnd: 1 },
        });
        let doc: PmNode | null = null;
        try {
          doc = step.apply(start).doc;
        } catch {
          doc = null;
        }
        if (!starts.includes(from)) {
          expect(doc, `position ${from}`).toBeNull();
          continue;
        }
        applied += 1;
        const index = starts.indexOf(from);
        const before = start.child(index);
        const after = (doc as PmNode).child(index);
        expect((doc as PmNode).childCount).toBe(start.childCount);
        expect(after.type.name).toBe(block.type);
        expect({ ...after.attrs }).toEqual(block.attrs);
        expect(after.textContent).toBe(("content" in block ? "Z" : "") + before.textContent);
      }
    }
    expect(applied).toBe(starts.length * blocks.length);
  });

  // With a new block in front the same change hides in a step that may be
  // legitimate (a block inserted before, text added to the next one). The
  // validator cannot tell without the document what the block was, so the
  // step passes by its shape; the replayer must refuse it (obligation 3: the
  // block on an open side equals the block it continues, type and level too).
  it("accepts by shape a longer replace that would change the type of the block it continues", () => {
    const fresh = { type: "paragraph", attrs: { nodeId: null }, content: [{ type: "text", text: "x" }] };
    const step = {
      stepType: "replace", from: 0, to: 1, structure: true,
      slice: { content: [fresh, retyped], openEnd: 1 },
    };
    const result = parseEditStep(step);
    if (!result.ok) throw new Error(`${result.code} at ${result.path}`);
    const applied = Step.fromJSON(schema, result.step).apply(start);
    expect(applied.doc?.child(1).type.name).toBe("heading");
    expect(applied.doc?.child(1).textContent).toBe("ZPrvi izmišljeni odlomak.");
  });

  // What ProseMirror writes when the editor has not cleared the id of a new
  // block. Capture (a later step) has to record these with `null` and an
  // `attr` step; until it does, the format refuses them rather than guess.
  const refused: [string, (tr: Transform) => void, EditStepRejection][] = [
    ["a split that copies the id onto the new block", (tr) => tr.split(5), "invalid_node_id"],
    [
      "an inserted block that still carries an id",
      (tr) => tr.insert(26, paragraph.create({ nodeId: A.replace(/1$/, "9") }, schema.text("x"))),
      "new_block_has_id",
    ],
  ];

  it.each(refused)("refuses %s", (_name, edit, code) => {
    const tr = new Transform(start);
    edit(tr);
    expect(tr.steps).toHaveLength(1);
    expect(parseEditStep(JSON.parse(JSON.stringify(tr.steps[0].toJSON())))).toMatchObject({
      ok: false, code,
    });
  });
});
