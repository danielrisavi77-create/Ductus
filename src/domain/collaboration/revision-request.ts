import type { TextAnchor } from "./anchor";
import {
  applyRevisionToConditions,
  hasNeedsReReview,
  isConditionalValidityEnabled,
  type ValidityCondition,
  type CurrentConditionText,
} from "./conditional-validity";

export const REVISION_REQUEST_STATUSES = [
  "OPEN",
  "STUDENT_RESPONDED",
  "SHARED_FOR_REVIEW",
  "ACCEPTED_FOR_REVISION",
  "NEEDS_CLARIFICATION",
  "REREVIEW_REQUIRED",
] as const;
export type RevisionRequestStatus = (typeof REVISION_REQUEST_STATUSES)[number];

export type RevisionRequest = {
  id: string;
  documentId: string;
  createdBy: string;
  requestedRevision: number;
  target: TextAnchor;
  instruction: string;
  status: RevisionRequestStatus;
  /** Spike S-UV1: uvjeti valjanosti (JSONB). Opcionalno. */
  conditions?: ValidityCondition[];
};

export type StudentResponse = {
  requestId: string;
  authorId: string;
  responseRevision: number;
  explanation: string;
};

export type RevisionRequestState = {
  request: RevisionRequest;
  response: StudentResponse | null;
};

export type TransitionFailure =
  | "response-required"
  | "wrong-state"
  | "invalid-revision"
  | "empty-explanation"
  | "wrong-request";

export type TransitionResult =
  | { ok: true; value: RevisionRequestState }
  | { ok: false; reason: TransitionFailure };

export function createRevisionRequest(input: Omit<RevisionRequest, "status">): RevisionRequest {
  if (!input.id || !input.documentId || !input.createdBy || !input.instruction.trim()) {
    throw new Error("createRevisionRequest: required field missing");
  }
  if (!Number.isSafeInteger(input.requestedRevision) || input.requestedRevision < 0) {
    throw new Error("createRevisionRequest: invalid revision");
  }
  return { ...input, instruction: input.instruction.trim(), status: "OPEN" };
}

export function submitStudentResponse(
  state: RevisionRequestState,
  response: StudentResponse,
): TransitionResult {
  if (state.request.status !== "OPEN" && state.request.status !== "NEEDS_CLARIFICATION") {
    return { ok: false, reason: "wrong-state" };
  }
  if (response.requestId !== state.request.id) return { ok: false, reason: "wrong-request" };
  if (!Number.isSafeInteger(response.responseRevision) || response.responseRevision < state.request.requestedRevision) {
    return { ok: false, reason: "invalid-revision" };
  }
  if (!response.explanation.trim()) return { ok: false, reason: "empty-explanation" };
  return {
    ok: true,
    value: {
      request: { ...state.request, status: "STUDENT_RESPONDED" },
      response: { ...response, explanation: response.explanation.trim() },
    },
  };
}

export function shareResponseForReview(state: RevisionRequestState): TransitionResult {
  if (state.request.status !== "STUDENT_RESPONDED") return { ok: false, reason: "wrong-state" };
  if (state.response === null) return { ok: false, reason: "response-required" };
  return { ok: true, value: { ...state, request: { ...state.request, status: "SHARED_FOR_REVIEW" } } };
}

export function acceptForRevision(state: RevisionRequestState): TransitionResult {
  if (state.request.status !== "SHARED_FOR_REVIEW" || state.response === null) {
    return { ok: false, reason: state.response === null ? "response-required" : "wrong-state" };
  }
  return { ok: true, value: { ...state, request: { ...state.request, status: "ACCEPTED_FOR_REVISION" } } };
}

export function requestClarification(state: RevisionRequestState): TransitionResult {
  if (state.request.status !== "SHARED_FOR_REVIEW") return { ok: false, reason: "wrong-state" };
  return { ok: true, value: { ...state, request: { ...state.request, status: "NEEDS_CLARIFICATION" } } };
}

export function markRereviewRequired(state: RevisionRequestState): TransitionResult {
  if (state.request.status !== "ACCEPTED_FOR_REVISION") return { ok: false, reason: "wrong-state" };
  return { ok: true, value: { ...state, request: { ...state.request, status: "REREVIEW_REQUIRED" } } };
}

/**
 * Spike S-UV1: primijeni uvjetovanu valjanost na prihvaćeni zahtjev.
 * Ako flag nije uključen ili nema conditions, vraća stanje neizmijenjeno.
 * Ako se detektira promjena, postavlja REREVIEW_REQUIRED i ažurira conditions.
 */
export function applyConditionalValidity(
  state: RevisionRequestState,
  currentTextInRange: CurrentConditionText,
): RevisionRequestState {
  if (!isConditionalValidityEnabled()) return state;
  if (state.request.status !== "ACCEPTED_FOR_REVISION") return state;
  if (!state.request.conditions?.length) return state;

  const updatedConditions = applyRevisionToConditions(
    state.request.conditions,
    currentTextInRange,
  );

  if (!hasNeedsReReview(updatedConditions)) {
    return { ...state, request: { ...state.request, conditions: updatedConditions } };
  }

  return {
    ...state,
    request: {
      ...state.request,
      status: "REREVIEW_REQUIRED",
      conditions: updatedConditions,
    },
  };
}
