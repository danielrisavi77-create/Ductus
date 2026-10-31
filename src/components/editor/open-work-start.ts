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

/**
 * Waits for the network after an offline attempt and calls `go` once. The
 * listener goes on first and the network is checked after it, so an `online`
 * event that came before the listener is not lost (DAN-330). Returns the
 * cleanup.
 */
export function whenOnline(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  isOnline: () => boolean,
  go: () => void,
): () => void {
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    target.removeEventListener("online", fire);
    go();
  };
  target.addEventListener("online", fire);
  if (isOnline()) fire();
  return () => { done = true; target.removeEventListener("online", fire); };
}
