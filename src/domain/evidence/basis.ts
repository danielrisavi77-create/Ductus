import type { TextAnchor } from "../collaboration";
import type { NodeId } from "../document";
import { resolveTextAnchor } from "../collaboration";

export type ClaimId = string & { readonly __claimId: unique symbol };
export type SourceId = string & { readonly __sourceId: unique symbol };
export type EvidenceBasisId = string & { readonly __evidenceBasisId: unique symbol };

export type ClaimRevision = {
  claimId: ClaimId;
  documentRevision: number;
  target: TextAnchor;
  text: string;
};

export type SourceVersion = {
  sourceId: SourceId;
  version: string;
  title: string;
  locatorLabel: string;
};

export type EvidenceExcerpt = {
  sourceId: SourceId;
  sourceVersion: string;
  locator: string;
  text: string;
  kind: "quote" | "summary";
};

export type EvidenceBasis = {
  id: EvidenceBasisId;
  claim: ClaimRevision;
  source: SourceVersion;
  excerpt: EvidenceExcerpt;
  reviewedAt: string;
};

export type EvidenceEvaluation =
  | { status: "VALID"; resolution: "exact" | "moved" }
  | { status: "RECHECK_REQUIRED"; reason: "claim-changed" | "claim-missing" | "claim-ambiguous" | "source-version-changed" };

function validRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function createClaimRevision(input: ClaimRevision): ClaimRevision {
  if (!input.claimId || !validRevision(input.documentRevision) || !input.text) throw new Error("createClaimRevision: invalid input");
  if (input.text !== input.target.quote) throw new Error("createClaimRevision: text must equal anchor quote");
  return { ...input, target: { ...input.target } };
}

export function createEvidenceBasis(input: EvidenceBasis): EvidenceBasis {
  if (!input.id || !input.source.sourceId || !input.source.version || !input.excerpt.locator || !input.excerpt.text) {
    throw new Error("createEvidenceBasis: required field missing");
  }
  if (input.excerpt.sourceId !== input.source.sourceId || input.excerpt.sourceVersion !== input.source.version) {
    throw new Error("createEvidenceBasis: excerpt must belong to source version");
  }
  if (Number.isNaN(Date.parse(input.reviewedAt))) throw new Error("createEvidenceBasis: invalid reviewedAt");
  // Copy nested objects so later changes to the input cannot break the
  // source-version check above.
  return {
    ...input,
    source: { ...input.source },
    excerpt: { ...input.excerpt },
    claim: createClaimRevision(input.claim),
  };
}

export function evaluateEvidenceBasis(
  basis: EvidenceBasis,
  nodeId: NodeId,
  currentNodeText: string,
  currentSourceVersion: string,
): EvidenceEvaluation {
  if (currentSourceVersion !== basis.source.version) return { status: "RECHECK_REQUIRED", reason: "source-version-changed" };
  const resolved=resolveTextAnchor(basis.claim.target,nodeId,currentNodeText);
  if (resolved.status==="missing") return { status:"RECHECK_REQUIRED",reason:"claim-missing" };
  if (resolved.status==="ambiguous") return { status:"RECHECK_REQUIRED",reason:"claim-ambiguous" };
  const current=currentNodeText.slice(resolved.start,resolved.end);
  if (current!==basis.claim.text) return { status:"RECHECK_REQUIRED",reason:"claim-changed" };
  return { status:"VALID",resolution:resolved.status };
}
