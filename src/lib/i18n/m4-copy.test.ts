import { describe, expect, it } from "vitest";

import { messagesHr } from "./messages.hr";

// DAN-506 (M4.4-P04a): Croatian copy for S-11 and A-04, taken from the approved
// reference (docs/design/ductura/m4-reference) and PRODUCT §5.

function leaves(node: unknown, path: string): [string, string][] {
  if (typeof node === "string") {
    return [[path, node]];
  }
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, `${path}.${key}`),
  );
}

const shape = messagesHr.workspace.upute.shape;
const rules = messagesHr.facultyRules;
const all = [
  ...leaves(shape, "workspace.upute.shape"),
  ...leaves(rules, "facultyRules"),
];

const FORBIDDEN = [
  "integritet",
  "prošlo",
  "prošao",
  "usklađeno s fpzg",
  "rizik",
  "sumnj",
  "anomalij",
  "postot",
  "vjerojatnost",
  "autentičn",
  "kopiran",
  "prepisan",
  "skriven",
  "skriva",
  "%",
  "✓",
  "✗",
  "✔",
  "✘",
];

describe("M4 copy for S-11 and A-04", () => {
  it("has non-empty text under both subtrees", () => {
    expect(all.length).toBeGreaterThan(40);
    for (const [path, text] of all) {
      expect(text.trim(), path).not.toBe("");
    }
  });

  it("uses the agreed phrases", () => {
    expect(shape.findingsHeading).toBe("Odstupanja od pravila");
    expect(shape.notChecked).toBe("nije provjereno");
    expect(shape.unavailable).toBe("Provjera oblika za ovu vrstu rada nije dostupna.");
    expect(rules.notApplicable.toLocaleLowerCase("hr")).toContain("ne odnosi se na ovu vrstu rada");
  });

  it("keeps the existing checks note unchanged", () => {
    expect(messagesHr.workspace.upute.checksNote).toBe("Provjera pomaže; ništa ne blokira predaju.");
  });

  it("uses no forbidden term, mark or percentage", () => {
    for (const [path, text] of all) {
      const lower = text.toLocaleLowerCase("hr");
      for (const word of FORBIDDEN) {
        expect(lower.includes(word), `${path}: "${text}" contains "${word}"`).toBe(false);
      }
    }
  });

  it("says findings are informative and never block submission", () => {
    expect(shape.informative).toBe("Informativno. Ne utječe na predaju.");
    expect(shape.disabled).toContain("Predaja nije zbog toga ograničena");
    expect(shape.loadFailed).toContain("Rad i dalje možete pisati i predati");
  });

  it("names every placeholder", () => {
    for (const [path, text] of all) {
      for (const match of text.matchAll(/\{([^}]*)\}/g)) {
        expect(match[1], path).toMatch(/^[a-zA-Z]+$/);
      }
    }
  });
});
