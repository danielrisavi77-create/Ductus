import { describe, expect, it } from "vitest";
import { newNodeId } from "../document";
import { createTextAnchor, resolveTextAnchor } from "./anchor";

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

  it("rejects invalid ranges instead of creating a poisoned anchor", () => {
    expect(() => createTextAnchor({ nodeId: ID, nodeText: "abc", start: 2, end: 2 })).toThrow("invalid range");
    expect(() => createTextAnchor({ nodeId: ID, nodeText: "abc", start: -1, end: 1 })).toThrow("invalid range");
  });
});
