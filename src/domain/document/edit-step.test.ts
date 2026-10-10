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

  it("bounds a step by the segment limit, before copying a huge array", () => {
    const text = (size: number) => ({ type: "text", text: "š".repeat(size / 2) });
    const big = { ...typing(), slice: { content: [text(MAX_EDIT_STEP_BYTES)] } };
    expect(parseEditStep(big)).toMatchObject({ ok: false, code: "too_large" });
    const fits = { ...typing(), slice: { content: [text(MAX_EDIT_STEP_BYTES / 2)] } };
    expect(parseEditStep(fits).ok).toBe(true);
    const endless = { ...typing(), slice: { content: new Array(2 ** 31) } };
    expect(parseEditStep(endless)).toMatchObject({ ok: false, code: "too_large" });
    // The limit is shared by all steps of one event.
    expect(parseEditSteps(EDIT_STEP_FORMAT_V1, [fits, fits, fits])).toMatchObject({
      ok: false, code: "too_large", path: "$[1].slice.content[0]",
    });
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
    ["pasting two blocks", (tr) => tr.replace(5, 5, new Slice(start.content, 1, 1))],
    ["deleting across blocks", (tr) => tr.delete(20, 30)],
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
});
