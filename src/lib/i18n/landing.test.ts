import { describe, expect, it } from "vitest";

import { FLOW_STEPS } from "@/components/landing/flowSteps";

import { messagesHr } from "./messages.hr";

function leaves(node: unknown, path = "landing"): [string, string][] {
  if (typeof node === "string") return [[path, node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, `${path}.${key}`),
  );
}

const texts = leaves(messagesHr.landing);

// Public home page (FE-H1, #476). messages.test.ts checks the PRODUCT §5
// vocabulary for the whole catalogue; these are the limits the owner's order
// adds for this page.
const NOT_ON_THE_HOME_PAGE: [string, RegExp][] = [
  ["the word for oversight, even negated (owner order, #476)", /nadzor/i],
  ["a claim that typing is not shown live (contradicts D-142)", /ne\s+tipkanj/i],
  ["a claim that there is no replay (contradicts D-143, D-154)", /(nema|bez)\s+reprodukcij/i],
  ["an AI score or share (PRODUCT §5, 2)", /\bAI\b[^.]*\d|\d[^.]*\bAI\b/],
  ["a percentage or a mark of a person (PRODUCT §5, 2)", /%|postot|ocjena studenta/i],
  ["an investigation (PRIJEDLOG)", /istrag/i],
  ["a committee (PRIJEDLOG)", /povjerenstv/i],
  ["sign-in by e-mail or another provider (D-09)", /e-pošt|e-mail|google|lozink/i],
  ["the passport (PRIJEDLOG)", /putovnic/i],
  ["a role picker at sign-in (D-09, owner order)", /odaberi ulogu|izaberi ulogu/i],
];

describe("landing copy", () => {
  it("has text in every key", () => {
    expect(texts.length).toBeGreaterThan(20);
    for (const [path, text] of texts) expect(text.trim(), path).not.toBe("");
  });

  for (const [what, pattern] of NOT_ON_THE_HOME_PAGE) {
    it(`contains no ${what}`, () => {
      for (const [path, text] of texts) {
        expect(pattern.test(text), `${path}: "${text}"`).toBe(false);
      }
    });
  }

  it("names AAI@EduHr as the only way in (D-09)", () => {
    expect(messagesHr.landing.aaiOnly).toContain("AAI@EduHr");
    expect(messagesHr.landing.aaiOnly).toMatch(/isključivo/);
  });

  it("states live view and replay as the product has them (D-142, D-143, D-154)", () => {
    const all = texts.map(([, text]) => text).join(" ");
    expect(all).toMatch(/uživo/);
    expect(all).toMatch(/reproduc|reprodukcij/);
    // The summary is the same for both roles (PRODUCT §5, 5).
    expect(messagesHr.landing.forWhomLead).toMatch(/isti je za studenta i nastavnika/);
  });
});

describe("landing flow announcements (FE-H2a)", () => {
  const steps = messagesHr.landing.flow.steps;

  it("announces ten steps, each once, each with a name, a title and a body", () => {
    expect(FLOW_STEPS).toHaveLength(10);
    expect(new Set(FLOW_STEPS.map(({ key }) => key)).size).toBe(10);
    expect(Object.keys(steps).sort()).toEqual(FLOW_STEPS.map(({ key }) => key).sort());
    for (const { key } of FLOW_STEPS) {
      expect(Object.keys(steps[key]).sort(), key).toEqual(["body", "name", "title"]);
    }
  });

  it("marks exactly the steps the app does not have yet as coming (owner order, #476)", () => {
    expect(FLOW_STEPS.filter(({ soon }) => soon).map(({ key }) => key)).toEqual([
      "sources",
      "versionReview",
      "laterChange",
      "defence",
      "institution",
    ]);
    expect(messagesHr.landing.flow.soon).toBe("Uskoro");
  });

  it("names the live view in the writing step (D-142)", () => {
    expect(steps.writing.body).toMatch(/uživo/);
  });
});
