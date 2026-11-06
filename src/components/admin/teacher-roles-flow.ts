// DAN-581 (A-02, plan #1592): the one action in flight on the screen. A
// dialog asks first; "send" is taken once, so a second click while a request
// runs sends nothing. Every event that does not fit the step is ignored.
import type { TeacherRoleAction, TeacherRoleOutcome } from "./teacher-role-action";

type Kind = TeacherRoleOutcome["kind"];
type Target = { action: TeacherRoleAction; personId: string; name: string };

export type RoleStep =
  | { kind: "idle" }
  | ({ kind: "asking" | "working" } & Target)
  | ({ kind: "done"; outcome: Kind } & Target);

export type RoleEvent =
  | ({ type: "ask" } & Target)
  | { type: "cancel" | "send" | "close" }
  | { type: "settle"; outcome: Kind };

export const IDLE: RoleStep = { kind: "idle" };

export function nextRoleStep(step: RoleStep, event: RoleEvent): RoleStep {
  switch (event.type) {
    case "ask": {
      if (step.kind === "asking" || step.kind === "working") return step;
      const { action, personId, name } = event;
      return { kind: "asking", action, personId, name };
    }
    case "cancel": return step.kind === "asking" ? IDLE : step;
    case "send": return step.kind === "asking" ? { ...step, kind: "working" } : step;
    case "settle": return step.kind === "working" ? { ...step, kind: "done", outcome: event.outcome } : step;
    case "close": return step.kind === "done" ? IDLE : step;
  }
}

/** Only the two proven changes are announced as done; everything else is an alert. */
export const outcomeRole = (kind: Kind): "status" | "alert" =>
  kind === "confirmed" || kind === "revoked" ? "status" : "alert";

/**
 * The dialog stays open while it asks or works, and for an unknown outcome,
 * which offers "Provjeri stanje". Any other outcome closes it and the page
 * reads the lists again, so the line beside them matches what they show.
 */
export const dialogOpen = (step: RoleStep): boolean =>
  step.kind === "asking" || step.kind === "working" || (step.kind === "done" && step.outcome === "unknown");

export const refreshAfter = (kind: Kind): boolean => kind !== "unknown";
