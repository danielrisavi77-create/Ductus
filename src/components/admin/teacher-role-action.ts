// DAN-581 (A-02, plan #1592): the administrator confirms or revokes a
// person's teacher role through the existing routes. Who may do it is the
// server's alone (the SECURITY DEFINER RPC behind each route); this only
// reads the reply. One attempt per call and never a retry: a reply that does
// not prove the outcome is "unknown", and the screen asks to check the state.
import { messagesHr } from "@/lib/i18n/messages.hr";

export type TeacherRoleAction = "confirm" | "revoke";

export type TeacherRoleOutcome = {
  kind:
    | "confirmed" // 200 {confirmed: true}
    | "revoked" // 200 {revoked: true}
    | "notConfirmed" // 200 {revoked: false}: nothing to revoke any more
    | "notCandidate" // 404 on confirm: no longer waiting here
    | "unauthorized" // 401
    | "forbidden" // 403
    | "invalid" // 400, 413, 415, 422, or an id that is not a UUID (not sent)
    | "unknown"; // anything else: the change may or may not have happened
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH: Record<TeacherRoleAction, string> = { confirm: "role-confirmation", revoke: "role-revocation" };

/** The kind a 200 body proves, or "unknown": exactly one key of the action's own shape. */
function successOf(action: TeacherRoleAction, data: unknown): TeacherRoleOutcome["kind"] {
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== 1) return "unknown";
  if (action === "confirm") return "confirmed" in data && data.confirmed === true ? "confirmed" : "unknown";
  if (!("revoked" in data) || typeof data.revoked !== "boolean") return "unknown";
  return data.revoked ? "revoked" : "notConfirmed";
}

async function send(action: TeacherRoleAction, personId: string, post: typeof fetch): Promise<TeacherRoleOutcome> {
  if (!UUID.test(personId)) return { kind: "invalid" };
  try {
    const response = await post(`/api/institution/teachers/${personId}/${PATH[action]}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      body: "{}",
    });
    if (response.status === 401) return { kind: "unauthorized" };
    if (response.status === 403) return { kind: "forbidden" };
    if ([400, 413, 415, 422].includes(response.status)) return { kind: "invalid" };
    if (action === "confirm" && response.status === 404) return { kind: "notCandidate" };
    if (response.status !== 200) return { kind: "unknown" };
    return { kind: successOf(action, await response.json()) };
  } catch {
    return { kind: "unknown" };
  }
}

export const confirmTeacherRole = (personId: string, post: typeof fetch = fetch) => send("confirm", personId, post);
export const revokeTeacherRole = (personId: string, post: typeof fetch = fetch) => send("revoke", personId, post);

const OUTCOME = messagesHr.teacherRoles.outcome;

/**
 * The line shown in role="status" (done) or role="alert" (anything else). An
 * unknown outcome never claims either way; 401 and 403 send the screen back
 * to the server, which then shows the sign-in card or the 404.
 */
export function teacherRoleOutcomeText(action: TeacherRoleAction, kind: TeacherRoleOutcome["kind"]): string {
  switch (kind) {
    case "confirmed": return OUTCOME.confirmed;
    case "revoked": return OUTCOME.revoked;
    case "notCandidate": return OUTCOME.notCandidate;
    case "notConfirmed": return OUTCOME.notConfirmed;
    case "unauthorized":
    case "forbidden": return OUTCOME.ended;
    case "invalid": return OUTCOME.invalid;
    case "unknown": return action === "confirm" ? OUTCOME.unknownConfirm : OUTCOME.unknownRevoke;
  }
}
