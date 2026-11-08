import { describe, expect, it } from "vitest";

import { canonicalizeJcs, type JcsJsonValue } from "../forensics/jcs";
import {
  EDIT_STEP_FORMAT_V1,
  EDIT_STEP_FORMAT_V2,
  EDIT_STEP_REJECTIONS,
  parseEditStep,
  parseEditSteps,
} from "./edit-step";

/**
 * Parser of `ductus-edit-steps-v2`, docs/contracts/document-schema-v2.md §5
 * and §10 classes 25 to 28 as far as the step alone can tell (DAN-619 PR b).
 * What needs the document (an unknown source id, a hash that does not match)
 * is tested on the replayers. Synthetic data only.
 */

const SRC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P = "11111111-1111-4111-8111-111111111111";
const HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

const cite = (over: object = {}) => ({ type: "citation", sourceId: SRC, ...over });
const text = (value: string, over: object = {}) => ({ type: "text", text: value, ...over });
const insert = (content: unknown[], at = 1) => ({
  stepType: "replace", from: at, to: at, slice: { content },
});
const book = (over: object = {}) => ({
  id: SRC, authors: [{ kind: "person", family: "Prezime", given: "Ime" }], year: 2020,
  title: "Izvor 1", type: "book", place: "Zagreb", publisher: "Nakladnik", ...over,
});

function v2(...steps: unknown[]) {
  return parseEditSteps(EDIT_STEP_FORMAT_V2, steps);
}

function accepted(...steps: unknown[]) {
  const result = v2(...steps);
  if (!result.ok) throw new Error(`${result.code} at ${result.path}`);
  return result.steps;
}

describe("format selection (§5.4, class 28)", () => {
  it("reads both formats and nothing else", () => {
    expect(parseEditSteps(EDIT_STEP_FORMAT_V1, [insert([text("a")])]).ok).toBe(true);
    expect(v2(insert([text("a")])).ok).toBe(true);
    expect(parseEditSteps("ductus-edit-steps-v3", [insert([text("a")])])).toEqual({
      ok: false, code: "unsupported_format", path: "$",
    });
  });

  it("refuses a citation and both source steps under v1", () => {
    const v1 = (step: unknown) => parseEditSteps(EDIT_STEP_FORMAT_V1, [step]);
    expect(v1(insert([cite()]))).toEqual({
      ok: false, code: "invalid_node", path: "$[0].slice.content[0].type",
    });
    expect(v1(insert([text("a"), cite()]))).toEqual({
      ok: false, code: "invalid_node", path: "$[0].slice.content[1].type",
    });
    expect(parseEditStep(insert([text("a"), cite()]))).toMatchObject({ code: "invalid_node" });
    expect(v1({ stepType: "sourceSet", source: book() })).toEqual({
      ok: false, code: "unknown_step_type", path: "$[0].stepType",
    });
    expect(v1({ stepType: "sourceRemove", sourceId: SRC, removedSha256: HASH })).toEqual({
      ok: false, code: "unknown_step_type", path: "$[0].stepType",
    });
    expect(parseEditStep({ stepType: "sourceRemove", sourceId: SRC, removedSha256: HASH }))
      .toMatchObject({ code: "unknown_step_type" });
  });
});

describe("citations in a slice (§5.1)", () => {
  it("accepts a citation alone, among text and inside a block, in document form", () => {
    const [alone, among, inBlock] = accepted(
      insert([cite({ locator: "str. 12" })]),
      insert([text("a", { marks: [{ type: "bold" }] }), cite(), text("b", { marks: [{ type: "bold" }] })], 3),
      {
        stepType: "replace", from: 5, to: 5,
        slice: { openStart: 1, openEnd: 1, content: [
          { type: "paragraph", attrs: { nodeId: P }, content: [cite()] },
          { type: "paragraph", attrs: { nodeId: null } },
        ] },
      },
    );
    expect(alone).toEqual(insert([cite({ locator: "str. 12" })]));
    // Same marks on both sides of a citation are not neighbours (§3.1).
    expect(among.stepType).toBe("replace");
    expect(inBlock.stepType).toBe("replace");
  });

  it("returns sorted keys, so JSON.stringify is the JCS form", () => {
    const [step] = accepted(insert([{ locator: "str. 12", type: "citation", sourceId: SRC }]));
    expect(JSON.stringify(step)).toBe(canonicalizeJcs(step as JcsJsonValue));
  });

  it("refuses a citation with marks, unknown fields or a bad sourceId", () => {
    expect(v2(insert([cite({ marks: [{ type: "bold" }] })]))).toEqual({
      ok: false, code: "unknown_field", path: "$[0].slice.content[0].marks",
    });
    expect(v2(insert([cite({ text: "x" })]))).toMatchObject({ code: "unknown_field" });
    for (const sourceId of [SRC.toUpperCase(), "", null, 7, "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa"]) {
      expect(v2(insert([cite({ sourceId })]))).toEqual({
        ok: false, code: "invalid_value", path: "$[0].slice.content[0].sourceId",
      });
    }
    expect(v2(insert([{ type: "citation" }]))).toMatchObject({ code: "missing_field" });
  });

  it("refuses an empty, too long or forbidden locator", () => {
    const locators = ["", "x".repeat(101), "\u{1F600}".repeat(101), "a​b", "a\ud800", 12, null];
    for (const locator of locators) {
      expect(v2(insert([cite({ locator })]))).toEqual({
        ok: false, code: "invalid_value", path: "$[0].slice.content[0].locator",
      });
    }
    expect(v2(insert([cite({ locator: "\u{1F600}".repeat(100) })])).ok).toBe(true);
    expect(v2(insert([cite({ locator: " " })])).ok).toBe(true);
  });

  it("refuses a citation in a heading (class 26 at the parser)", () => {
    const heading = (content: unknown[]) => ({
      stepType: "replace", from: 0, to: 0,
      slice: { content: [{ type: "heading", attrs: { level: 1, nodeId: null }, content }] },
    });
    expect(v2(heading([text("a"), cite()]))).toEqual({
      ok: false, code: "invalid_node", path: "$[0].slice.content[0].content[1].type",
    });
    expect(v2(heading([text("a")])).ok).toBe(true);
  });

  it("refuses a citation as the slice of a replaceAround", () => {
    expect(v2({
      stepType: "replaceAround", from: 0, to: 4, gapFrom: 1, gapTo: 3, insert: 1, structure: true,
      slice: { content: [cite()] },
    })).toMatchObject({ code: "invalid_slice" });
  });

  it("still joins neighbouring text with the same marks only", () => {
    expect(v2(insert([text("a"), text("b")]))).toMatchObject({ code: "not_canonical" });
    expect(v2(insert([text("a"), cite(), text("b")])).ok).toBe(true);
    expect(v2(insert([cite(), cite()])).ok).toBe(true);
  });

  it("requires removedSha256 on a removal and refuses it on structure (class 25)", () => {
    expect(v2({ stepType: "replace", from: 1, to: 2 })).toEqual({
      ok: false, code: "missing_field", path: "$[0].removedSha256",
    });
    expect(v2({ stepType: "replace", from: 1, to: 2, removedSha256: "x" })).toMatchObject({
      code: "invalid_removed_hash",
    });
    expect(v2({ stepType: "replace", from: 1, to: 2, removedSha256: HASH }).ok).toBe(true);
  });
});

describe("sourceSet and sourceRemove (§5.3, class 27)", () => {
  it("accepts sourceSet with and without a hash and sorts every key", () => {
    const [added, replaced] = accepted(
      { stepType: "sourceSet", source: book() },
      { stepType: "sourceSet", source: book({ year: 2021 }), removedSha256: HASH },
    );
    expect(added).toEqual({ stepType: "sourceSet", source: book() });
    expect(replaced).toMatchObject({ removedSha256: HASH });
    expect(JSON.stringify(added)).toBe(canonicalizeJcs(added as JcsJsonValue));
    expect(JSON.stringify(replaced)).toBe(canonicalizeJcs(replaced as JcsJsonValue));
  });

  it("refuses an invalid source with invalid_value at the field", () => {
    const cases: [object, string][] = [
      [book({ title: " Izvor" }), "$[0].source.title"],
      [book({ id: SRC.toUpperCase() }), "$[0].source.id"],
      [book({ extra: 1 }), "$[0].source.extra"],
      [book({ authors: [{ kind: "person", family: "Prezime" }] }), "$[0].source.authors[0].given"],
    ];
    for (const [source, path] of cases) {
      expect(v2({ stepType: "sourceSet", source })).toEqual({ ok: false, code: "invalid_value", path });
    }
    expect(v2({ stepType: "sourceSet", source: null })).toEqual({
      ok: false, code: "invalid_value", path: "$[0].source",
    });
    expect(v2({ stepType: "sourceSet" })).toMatchObject({ code: "missing_field" });
  });

  it("refuses a malformed hash on sourceSet and unknown fields", () => {
    expect(v2({ stepType: "sourceSet", source: book(), removedSha256: HASH.toUpperCase() })).toEqual({
      ok: false, code: "invalid_removed_hash", path: "$[0].removedSha256",
    });
    expect(v2({ stepType: "sourceSet", source: book(), at: 0 })).toMatchObject({ code: "unknown_field" });
  });

  it("requires a well-formed hash and id on sourceRemove", () => {
    expect(accepted({ stepType: "sourceRemove", sourceId: SRC, removedSha256: HASH })).toEqual([
      { removedSha256: HASH, sourceId: SRC, stepType: "sourceRemove" },
    ]);
    expect(v2({ stepType: "sourceRemove", sourceId: SRC })).toEqual({
      ok: false, code: "missing_field", path: "$[0].removedSha256",
    });
    expect(v2({ stepType: "sourceRemove", sourceId: SRC, removedSha256: 1 })).toMatchObject({
      code: "invalid_removed_hash",
    });
    expect(v2({ stepType: "sourceRemove", sourceId: "Izvor 1", removedSha256: HASH })).toEqual({
      ok: false, code: "invalid_value", path: "$[0].sourceId",
    });
  });

  it("names only declared rejection codes and refuses forbidden keys first", () => {
    const proto = JSON.parse(`{"__proto__":{},"stepType":"sourceRemove","sourceId":"${SRC}"}`);
    expect(v2(proto)).toMatchObject({ code: "forbidden_key" });
    const result = v2({ stepType: "sourceMove", sourceId: SRC });
    expect(result).toEqual({ ok: false, code: "unknown_step_type", path: "$[0].stepType" });
    expect(EDIT_STEP_REJECTIONS).toContain(result.ok ? "" : result.code);
  });
});
