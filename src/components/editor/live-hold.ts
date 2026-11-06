/**
 * What a change of the `/rad` view does to the live view's publisher (#882,
 * DAN-215). While the page shows how the teacher sees the work, this tab
 * sends nothing to `/api/live/*`; the editor stays mounted, so the publisher
 * is held, not dropped. Back to writing, it starts again only for a run that
 * still holds the lock and may write: never after the sign-out dialog's
 * quiesce, a submission or the end of the session. A halt (401 or 404) is
 * final, so no change of view undoes it.
 */

export type LivePublishAction = "start" | "stop" | "none";

export function livePublishAction(input: {
  held: boolean;
  writable: boolean;
  halted: "signedOut" | "notFound" | null;
}): LivePublishAction {
  if (input.halted !== null) return "none";
  if (input.held) return "stop";
  return input.writable ? "start" : "none";
}
