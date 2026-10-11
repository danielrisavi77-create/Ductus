export type AuthorizationResourceType =
  | "institution"
  | "course"
  | "assignment"
  | "project"
  | "document"
  | "submission"
  | "evidence_package"
  | "institution_policy"
  | "audit_record";

export type AuthorizationAction =
  | "manage_course"
  | "view_roster"
  | "manage_assignment"
  | "read_private_draft"
  | "read_shared_revision"
  | "write_document"
  | "comment"
  | "request_revision"
  | "mark_reviewed"
  | "submit"
  | "manage_sharing"
  | "read_submission"
  | "finalize_submission"
  | "review_submission"
  | "append_evidence"
  | "read_evidence"
  | "export_evidence"
  | "manage_policy"
  | "read_policy"
  | "read_audit";

export type AuthorizationConsistency =
  | "minimize-latency"
  | "higher-consistency";

export type AuthorizationResource = {
  type: AuthorizationResourceType;
  id: string;
};

export type AuthorizationContext = {
  /**
   * Request-time instant used for conditional relationships such as
   * short-lived break-glass grants. ISO-8601/RFC3339 instant.
   */
  currentTime?: string;
};

export type AuthorizationCheck = {
  principalId: string;
  action: AuthorizationAction;
  resource: AuthorizationResource;
  consistency: AuthorizationConsistency;
  context?: AuthorizationContext;
};

export type AuthorizationDecision =
  | { status: "allow" }
  | { status: "deny" }
  | { status: "unavailable"; reason: string };

/**
 * Provider-neutral authorization decision boundary.
 *
 * Identity providers do not implement this contract. They establish a
 * principal; this port decides what that principal may do to a Pisač resource.
 *
 * A resource that does not exist is answered exactly like one the principal
 * may not touch: `deny`. Callers ask this port before they look the resource
 * up, so an adapter that told the two apart would let anyone probe which ids
 * exist.
 */
export interface AuthorizationPort {
  check(request: AuthorizationCheck): Promise<AuthorizationDecision>;
}

const HIGH_CONSISTENCY_ACTIONS = new Set<AuthorizationAction>([
  "read_private_draft",
  "read_shared_revision",
  "write_document",
  "comment",
  "request_revision",
  "mark_reviewed",
  "submit",
  "manage_sharing",
  "read_submission",
  "finalize_submission",
  "review_submission",
  "append_evidence",
  "read_evidence",
  "export_evidence",
  "manage_policy",
  "read_policy",
  "read_audit",
  "view_roster",
]);

const STEP_UP_ACTIONS = new Set<AuthorizationAction>([
  "finalize_submission",
  "export_evidence",
  "manage_policy",
]);

export function requiredAuthorizationConsistency(
  action: AuthorizationAction,
): AuthorizationConsistency {
  return HIGH_CONSISTENCY_ACTIONS.has(action)
    ? "higher-consistency"
    : "minimize-latency";
}

export function requiresStepUpAuthentication(
  action: AuthorizationAction,
): boolean {
  return STEP_UP_ACTIONS.has(action);
}
