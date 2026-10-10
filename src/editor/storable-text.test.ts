// @vitest-environment node
/**
 * Text the canonical boundary refuses is made storable before journalling
 * (#131, plan #197 attack 10). All text here is synthetic.
 */
import { describe, expect, it } from "vitest";
import {
  newNodeId, paragraphNode, textNode, validateDocument, type CanonicalDocument,
} from "../domain/document";
import { canonicalizeJcs } from "../domain/forensics/jcs";
import { storableDocument, storableText } from "./storable-text";

const P1 = newNodeId(() => "aaaaaaaa-0000-4000-8000-000000000001");
const P2 = newNodeId(() => "aaaaaaaa-0000-4000-8000-000000000002");

function doc(...runs: string[][]): CanonicalDocument {
  return {
    schemaVersion: 1,
    nodes: runs.map((texts, i) => paragraphNode(i === 0 ? P1 : P2, texts.map((t) => textNode(t)))),
  };
}

describe("storableText (#131)", () => {
  it("replaces a lone surrogate with U+FFFD", () => {
    expect(storableText("a\uD800b")).toBe("a\uFFFDb");
    expect(storableText("\uDC00")).toBe("\uFFFD");
    expect(storableText("x\uD83D")).toBe("x\uFFFD");
    expect(storableText("\uDE00\uD83D")).toBe("\uFFFD\uFFFD");
  });

  it("drops NUL", () => {
    expect(storableText("a\u0000b\u0000")).toBe("ab");
  });

  it("leaves valid pairs, diacritics and ordinary text untouched (same string)", () => {
    for (const text of ["Rad 😀 o 𝔸", "čćžšđ ČĆŽŠĐ", "obični tekst", ""]) {
      expect(storableText(text)).toBe(text);
    }
  });
});

describe("storableDocument (#131)", () => {
  it("returns the same object when nothing needs changing", () => {
    const clean = doc(["Uvod u rad 😀"], ["čćžšđ"]);
    expect(storableDocument(clean)).toBe(clean);
  });

  it("makes a document JCS refused into one JCS accepts, keeping node ids", () => {
    const broken = doc(["prije \uD800 poslije"], ["\u0000"]);
    expect(() => canonicalizeJcs(broken)).toThrow();
    const fixed = storableDocument(broken);
    expect(() => canonicalizeJcs(fixed)).not.toThrow();
    expect(validateDocument(fixed).ok).toBe(true);
    expect(fixed.nodes.map((n) => n.id)).toEqual([P1, P2]);
    expect(fixed.nodes[0]!.children[0]!.text).toBe("prije \uFFFD poslije");
    // A run that held only NUL is gone: no empty text node is stored.
    expect(fixed.nodes[1]!.children).toEqual([]);
    expect(broken.nodes[0]!.children[0]!.text).toBe("prije \uD800 poslije");
  });
});
