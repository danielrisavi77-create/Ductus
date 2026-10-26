import { describe, expect, it } from "vitest";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { applyEdit, buildFrames, clampStep, parseEdit } from "./rewind-frames";

const SAMPLE_EDITS = t.landing.replay.edits.map(parseEdit);

describe("landing replay model", () => {
  it("starts from the empty paragraph and adds one frame per edit", () => {
    const frames = buildFrames(SAMPLE_EDITS);
    expect(frames).toHaveLength(SAMPLE_EDITS.length + 1);
    expect(frames[0]).toBe("");
  });

  it("applies every sample edit and ends on the final text", () => {
    const frames = buildFrames(SAMPLE_EDITS);
    expect(frames.at(-1)).toBe(
      "Europski gradovi sve češće, ali neujednačeno, mijenjaju pravila prometa. Najčešće se mijenja parkiranje u središtu.",
    );
  });

  it("parses the catalogue notation", () => {
    expect(parseEdit("+abc")).toEqual({ kind: "append", text: "abc" });
    expect(parseEdit("a>>b")).toEqual({ kind: "replace", from: "a", to: "b" });
    expect(() => parseEdit("abc")).toThrow();
  });

  it("shows a removal as a frame that is shorter than the one before", () => {
    const frames = buildFrames([
      { kind: "append", text: "abcdef" },
      { kind: "replace", from: "def", to: "" },
    ]);
    expect(frames).toEqual(["", "abcdef", "abc"]);
  });

  it("rejects a replace that does not match the text", () => {
    expect(() => applyEdit("abc", { kind: "replace", from: "x", to: "y" })).toThrow();
  });

  it("clamps the step into the frame range", () => {
    expect(clampStep(-3, 5)).toBe(0);
    expect(clampStep(99, 5)).toBe(4);
    expect(clampStep(2.7, 5)).toBe(2);
    expect(clampStep(Number.NaN, 5)).toBe(0);
  });
});
