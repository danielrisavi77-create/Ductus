import { describe, expect, it } from "vitest";
import { newNodeId } from "../document";
import { createTextAnchor, MAX_MATCHES, resolveTextAnchor } from "./anchor";

const ID = newNodeId(() => "11111111-1111-4111-8111-111111111111");
const OTHER = newNodeId(() => "22222222-2222-4222-8222-222222222222");

describe("TextAnchor", () => {
  it("resolves the unchanged range exactly", () => {
    const text = "Prije važna tvrdnja poslije.";
    const start = text.indexOf("važna tvrdnja");
    const a = createTextAnchor({ nodeId: ID, nodeText: text, start, end: start + "važna tvrdnja".length });
    expect(resolveTextAnchor(a, ID, text)).toEqual({ status: "exact", start, end: start + "važna tvrdnja".length });
  });

  it("finds a target that moved inside the same node", () => {
    const oldText = "Uvod. važna tvrdnja Zaključak.";
    const start = oldText.indexOf("važna tvrdnja");
    const a = createTextAnchor({ nodeId: ID, nodeText: oldText, start, end: start + "važna tvrdnja".length, contextLength: 0 });
    const next = "Novi početak. Uvod. važna tvrdnja Zaključak.";
    const moved = next.indexOf("važna tvrdnja");
    expect(resolveTextAnchor(a, ID, next)).toEqual({ status: "moved", start: moved, end: moved + "važna tvrdnja".length });
  });

  it("refuses to guess between duplicate quotations", () => {
    const oldText = "A cilj B";
    const start = oldText.indexOf("cilj");
    const a = createTextAnchor({ nodeId: ID, nodeText: oldText, start, end: start + 4, contextLength: 0 });
    expect(resolveTextAnchor(a, ID, "cilj i opet cilj")).toEqual({ status: "ambiguous", matches: 2 });
  });

  // #418: another occurrence of the quote moved onto the old position is not an exact hit.
  it("follows the anchored occurrence when another one moves onto its old position", () => {
    const oldText = "cilj cilj";
    const a = createTextAnchor({ nodeId: ID, nodeText: oldText, start: 5, end: 9 });
    const next = "Ovo: cilj cilj";
    expect(next.slice(a.startHint, a.endHint)).toBe("cilj");
    expect(resolveTextAnchor(a, ID, next)).toEqual({ status: "moved", start: 10, end: 14 });
  });

  it("refuses to guess when an anchor without context sees its quote twice", () => {
    const a = createTextAnchor({ nodeId: ID, nodeText: "A cilj B", start: 2, end: 6, contextLength: 0 });
    expect(resolveTextAnchor(a, ID, "A cilj cilj B")).toEqual({ status: "ambiguous", matches: 2 });
  });

  it("refuses to guess when the whole recorded context appears twice", () => {
    const a = createTextAnchor({ nodeId: ID, nodeText: "x cilj y", start: 2, end: 6, contextLength: 2 });
    expect(resolveTextAnchor(a, ID, "x cilj y x cilj y")).toEqual({ status: "ambiguous", matches: 2 });
  });

  it("reports the old position as moved, not exact, once its context changed", () => {
    const oldText = "Prije važna tvrdnja poslije.";
    const start = oldText.indexOf("važna tvrdnja");
    const end = start + "važna tvrdnja".length;
    const a = createTextAnchor({ nodeId: ID, nodeText: oldText, start, end });
    expect(resolveTextAnchor(a, ID, "Prije važna tvrdnja kasnije.")).toEqual({ status: "moved", start, end });
  });

  it("reports a deleted target as missing", () => {
    const a = createTextAnchor({ nodeId: ID, nodeText: "važna tvrdnja", start: 0, end: "važna tvrdnja".length });
    expect(resolveTextAnchor(a, ID, "nešto drugo")).toEqual({ status: "missing" });
  });

  it("never reanchors across a different structural node", () => {
    const a = createTextAnchor({ nodeId: ID, nodeText: "važna tvrdnja", start: 0, end: "važna tvrdnja".length });
    expect(resolveTextAnchor(a, OTHER, "važna tvrdnja")).toEqual({ status: "missing" });
  });

  it("preserves Croatian Unicode text", () => {
    const text = "Početak — obvezno glasovanje čuva značenje.";
    const quote = "obvezno glasovanje";
    const start = text.indexOf(quote);
    const a = createTextAnchor({ nodeId: ID, nodeText: text, start, end: start + quote.length });
    expect(a.quote).toBe(quote);
    expect(resolveTextAnchor(a, ID, text).status).toBe("exact");
  });

  it("gives no place, and does not throw, for a short quote that fills a long paragraph (F-093)", () => {
    const a = createTextAnchor({ nodeId: ID, nodeText: "x a y", start: 2, end: 3 });
    // 260 001 characters, the quote in every other one; the old position misses.
    const long = "b" + "ab".repeat(130_000);
    expect(resolveTextAnchor(a, ID, long)).toEqual({ status: "ambiguous", matches: MAX_MATCHES + 1 });
  });

  it("still places a quote that occurs up to the limit of matches", () => {
    const a = createTextAnchor({ nodeId: ID, nodeText: "x a y", start: 2, end: 3 });
    const text = "b".repeat(10) + "x a y" + " ab".repeat(MAX_MATCHES - 1);
    expect(resolveTextAnchor(a, ID, text)).toEqual({ status: "moved", start: 12, end: 13 });
  });

  it("rejects invalid ranges instead of creating a poisoned anchor", () => {
    expect(() => createTextAnchor({ nodeId: ID, nodeText: "abc", start: 2, end: 2 })).toThrow("invalid range");
    expect(() => createTextAnchor({ nodeId: ID, nodeText: "abc", start: -1, end: 1 })).toThrow("invalid range");
  });
});
