import { describe, expect, it } from "vitest";

import { createTextAnchor } from "../collaboration";
import { newNodeId } from "../document";
import {
  createClaimRevision,
  createEvidenceBasis,
  type ClaimId,
  type EvidenceBasisId,
  type SourceId,
} from "./basis";

// Ductus addition on top of the ported basis.test.ts (Codex review, PR #21).

const N = newNodeId(() => "11111111-1111-4111-8111-111111111111");
const claimText = "Rezultati pokazuju povezanost.";

function input() {
  const anchor = createTextAnchor({ nodeId: N, nodeText: claimText, start: 0, end: claimText.length, contextLength: 0 });
  return {
    id: "eb1" as EvidenceBasisId,
    claim: { claimId: "c1" as ClaimId, documentRevision: 3, target: anchor, text: claimText },
    source: { sourceId: "s1" as SourceId, version: "v1", title: "Izvor", locatorLabel: "str. 42" },
    excerpt: { sourceId: "s1" as SourceId, sourceVersion: "v1", locator: "42", text: "Izvadak.", kind: "summary" as const },
    reviewedAt: "2026-09-28T12:00:00Z",
  };
}

describe("createEvidenceBasis — no aliasing of validated input", () => {
  it("keeps source and excerpt consistent after the input is mutated", () => {
    const raw = input();
    const basis = createEvidenceBasis(raw);
    raw.source.version = "v2";
    raw.excerpt.sourceVersion = "v3";
    expect(basis.source.version).toBe("v1");
    expect(basis.excerpt.sourceVersion).toBe("v1");
  });

  it("does not share the claim anchor with the input", () => {
    const raw = input();
    const claim = createClaimRevision(raw.claim);
    expect(claim.target).not.toBe(raw.claim.target);
    expect(claim.target).toEqual(raw.claim.target);
  });
});
