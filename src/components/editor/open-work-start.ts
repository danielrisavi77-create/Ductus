import type { OpenOutcome } from "@/client/evidence-ingest";

/**
 * One attempt to start the work after the click on "Započni rad" (DAN-330).
 * `sessionEnded` is asked right before the request: once the session the page
 * was rendered under has ended, nothing is sent and the answer is
 * `sessionEnded`.
 */
export async function startWorkAttempt(
  assignmentId: string,
  deps: { sessionEnded: () => boolean; open: (assignmentId: string) => Promise<OpenOutcome> },
): Promise<OpenOutcome | { status: "sessionEnded" }> {
  if (deps.sessionEnded()) return { status: "sessionEnded" };
  return deps.open(assignmentId);
}
