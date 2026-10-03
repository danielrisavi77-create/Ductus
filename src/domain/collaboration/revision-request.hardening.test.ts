import { describe, expect, it } from "vitest";

import { newNodeId } from "../document";
import { createTextAnchor } from "./anchor";
import { createRevisionRequest, submitStudentResponse } from "./revision-request";

// Ductus addition on top of the ported revision-request.test.ts (Codex review, PR #21).

const nodeId = newNodeId(() => "11111111-1111-4111-8111-111111111111");
const quote = "važna tvrdnja";
const target = createTextAnchor({ nodeId, nodeText: quote, start: 0, end: quote.length });

describe("submitStudentResponse — request identity", () => {
  it("rejects a response that belongs to another request", () => {
    const state = {
      request: createRevisionRequest({
        id: "r1",
        documentId: "d1",
        createdBy: "mentor",
        requestedRevision: 2,
        target,
        instruction: "Preciziraj tvrdnju.",
      }),
      response: null,
    };
    const response = { requestId: "r2", authorId: "student", responseRevision: 3, explanation: "Odgovor." };
    expect(submitStudentResponse(state, response)).toEqual({ ok: false, reason: "wrong-request" });
  });
});
