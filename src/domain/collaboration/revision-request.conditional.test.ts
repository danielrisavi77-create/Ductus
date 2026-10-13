import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTextAnchor } from "./anchor";
import { newNodeId } from "../document";
import {
  acceptForRevision,
  applyConditionalValidity,
  createRevisionRequest,
  shareResponseForReview,
  submitStudentResponse,
  type RevisionRequestState,
} from "./revision-request";
import { simpleHash, normalizeForComparison, type ValidityCondition } from "./conditional-validity";

const nodeId = newNodeId(() => "11111111-1111-4111-8111-111111111111");
const quote = "važna tvrdnja";
const target = createTextAnchor({ nodeId, nodeText: quote, start: 0, end: quote.length });

function acceptedState(conditions?: ValidityCondition[]): RevisionRequestState {
  const initial: RevisionRequestState = {
    request: createRevisionRequest({
      id: "r1",
      documentId: "d1",
      createdBy: "mentor",
      requestedRevision: 2,
      target,
      instruction: "Preciziraj tvrdnju.",
      conditions,
    }),
    response: null,
  };
  const response = {
    requestId: "r1",
    authorId: "student",
    responseRevision: 3,
    explanation: "Dodao sam izvor.",
  };
  const a = submitStudentResponse(initial, response);
  if (!a.ok) throw new Error("setup failed");
  const b = shareResponseForReview(a.value);
  if (!b.ok) throw new Error("setup failed");
  const c = acceptForRevision(b.value);
  if (!c.ok) throw new Error("setup failed");
  return c.value;
}

describe("applyConditionalValidity integration (S-UV1)", () => {
  beforeEach(() => {
    process.env.CONDITIONAL_VALIDITY = "true";
  });
  afterEach(() => {
    delete process.env.CONDITIONAL_VALIDITY;
  });

  it("does nothing when flag is off", () => {
    delete process.env.CONDITIONAL_VALIDITY;
    const state = acceptedState([
      {
        kind: "text_range",
        revision_id: "rev-1",
        text_snapshot_hash: simpleHash(normalizeForComparison("original")),
        status: "valid",
        accepted_at: "2026-10-13T00:00:00Z",
        accepted_by: "t",
      },
    ]);
    const result = applyConditionalValidity(state, "changed text");
    expect(result.request.status).toBe("ACCEPTED_FOR_REVISION");
  });

  it("marks REREVIEW_REQUIRED when text changes", () => {
    const original = "broj sudionika je 42";
    const state = acceptedState([
      {
        kind: "text_range",
        revision_id: "rev-1",
        text_snapshot_hash: simpleHash(normalizeForComparison(original)),
        text_excerpt: original,
        status: "valid",
        accepted_at: "2026-10-13T00:00:00Z",
        accepted_by: "t",
      },
    ]);
    const result = applyConditionalValidity(state, "broj sudionika je 43");
    expect(result.request.status).toBe("REREVIEW_REQUIRED");
    expect(result.request.conditions?.[0]?.status).toBe("needs_re_review");
  });

  it("keeps ACCEPTED_FOR_REVISION on trivial change", () => {
    const original = "broj sudionika je 42";
    const state = acceptedState([
      {
        kind: "text_range",
        revision_id: "rev-1",
        text_snapshot_hash: simpleHash(normalizeForComparison(original)),
        status: "valid",
        accepted_at: "2026-10-13T00:00:00Z",
        accepted_by: "t",
      },
    ]);
    const result = applyConditionalValidity(state, "  broj sudionika je 42.  ");
    expect(result.request.status).toBe("ACCEPTED_FOR_REVISION");
  });

  it("reopens only the changed anchored range when multiple conditions are accepted", () => {
    const first = "tekst prvog odlomka";
    const second = "tekst drugog odlomka";
    const state = acceptedState([
      {
        kind: "text_range",
        revision_id: "rev-1",
        text_snapshot_hash: simpleHash(normalizeForComparison(first)),
        text_excerpt: first,
        status: "valid",
        accepted_at: "2026-10-13T00:00:00Z",
        accepted_by: "t",
      },
      {
        kind: "text_range",
        revision_id: "rev-1",
        text_snapshot_hash: simpleHash(normalizeForComparison(second)),
        text_excerpt: second,
        status: "valid",
        accepted_at: "2026-10-13T00:00:00Z",
        accepted_by: "t",
      },
    ]);
    const result = applyConditionalValidity(state, (condition) =>
      condition.text_excerpt === first ? "izmijenjen prvi odlomak" : second,
    );
    expect(result.request.status).toBe("REREVIEW_REQUIRED");
    expect(result.request.conditions?.map((c) => c.status)).toEqual(["needs_re_review", "valid"]);
    expect(result.request.conditions?.map((c) => c.text_excerpt)).toEqual([first, second]);
  });

  it("does nothing when there are no conditions", () => {
    const state = acceptedState();
    const result = applyConditionalValidity(state, "anything");
    expect(result.request.status).toBe("ACCEPTED_FOR_REVISION");
  });
});
