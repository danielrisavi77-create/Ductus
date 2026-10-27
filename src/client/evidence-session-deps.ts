/**
 * F-8 3d-2c2: the browser adapters of `EvidenceSession`, joined here so that
 * `src/components/` imports no adapter directly (Backend #711 c.6392614020,
 * B2): the open route, the browser replayer, the drain runner over the
 * evidence transport with receipts verified only under the keys of the
 * opened work, and the browser's network signal.
 */

import type { EvidenceSessionDeps } from "@/components/editor/evidence-session";
import { createBrowserEditStepsV1Replayer } from "@/adapters/evidence/edit-steps-v1-browser-replayer";
import type { QueuedTransaction } from "@/domain/sync/journal-types";
import { createDrainRunner, type DrainJournal } from "@/lib/sync/drain-runner";
import { createEvidenceTransport, evidenceVerifierFor } from "@/lib/sync/evidence-transport";

import { openWork, type FetchLike } from "./evidence-ingest";
import { readOnline, type OnlineSource } from "./online-status";

const COMMIT_PATH = "/api/evidence/commit";

/**
 * 3d-2c2a §4, O1 (a) (#476 c.6397490151): the commit client maps a 409
 * `not_accepting` to the same drain outcome as a 404, so this wrapper tells
 * the session apart before the response goes on, unread, to the commit
 * client. Only the commit route counts: a `not_accepting` from the open route
 * is an assignment not open yet.
 *
 * F-155: the commit route says `not_accepting` for three reasons (BACKEND
 * 4.13): a submission, a current version not acknowledged, or one not open
 * yet. So the 409 alone closes nothing: `isSubmitted` asks the server again,
 * and only its "submitted" closes the session by submission. An unknown
 * answer leaves the session as it is; nothing is ever offered for deletion on
 * a guess. The response waits for that answer, so the session knows before
 * the drain hears the outcome, as before, but never longer than
 * `confirmWithinMs` (Codex r4384309111): an open route that does not answer
 * counts as unknown, so the drain, and sign-out waiting on it, goes on.
 */
export const SUBMISSION_CONFIRM_MS = 5_000;

export function watchClosedBySubmission(
  fetchImpl: FetchLike,
  isSubmitted: () => Promise<boolean>,
  confirmWithinMs: number = SUBMISSION_CONFIRM_MS,
): {
  fetchImpl: FetchLike;
  watch: NonNullable<EvidenceSessionDeps["watchSubmission"]>;
} {
  const listeners = new Set<() => void>();
  const confirmed = async (): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), confirmWithinMs); });
    try {
      return await Promise.race([isSubmitted().then((yes) => yes === true, () => false), late]);
    } finally {
      clearTimeout(timer);
    }
  };
  const wrapped: FetchLike = async (input, init) => {
    const response = await fetchImpl(input, init);
    if (input === COMMIT_PATH && response.status === 409) {
      const body: unknown = await response.clone().json().catch(() => undefined);
      if (typeof body === "object" && body !== null && (body as { status?: unknown }).status === "not_accepting"
        && await confirmed()) {
        for (const listener of [...listeners]) listener();
      }
    }
    return response;
  };
  return {
    fetchImpl: wrapped,
    watch: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export type BrowserEvidenceInput = {
  journal: EvidenceSessionDeps["journal"] & DrainJournal;
  documentId: string;
  assignmentId: string;
  fetchImpl?: FetchLike;
  source?: OnlineSource;
};

export function browserEvidenceSessionDeps(input: BrowserEvidenceInput): EvidenceSessionDeps {
  const fetchImpl = input.fetchImpl ?? ((url, init) => fetch(url, init));
  const source = input.source ?? window;
  const open = () => openWork(input.assignmentId, fetchImpl);
  // F-155: only the open route's own "submitted" closes the session by submission.
  const closed = watchClosedBySubmission(fetchImpl, async () => {
    const outcome = await open();
    return outcome.status === "opened" && outcome.work.submitted;
  });
  return {
    journal: input.journal,
    documentId: input.documentId,
    open,
    replayer: createBrowserEditStepsV1Replayer,
    createRunner: (work) => createDrainRunner<QueuedTransaction>({
      journal: input.journal,
      transport: createEvidenceTransport(closed.fetchImpl),
      verifyFor: evidenceVerifierFor(work),
    }),
    watchSubmission: closed.watch,
    storedProfile: (meta) => meta?.evidenceProfileId ?? null,
    network: {
      online: () => readOnline(source),
      onOnline: (listener) => {
        source.addEventListener("online", listener);
        return () => source.removeEventListener("online", listener);
      },
    },
  };
}
