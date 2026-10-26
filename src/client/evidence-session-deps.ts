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
 * `not_accepting` (the package was closed by a submission, DAN-289 A1) to the
 * same drain outcome as a 404, so this wrapper tells the session apart before
 * the response goes on, unread, to the commit client. Only the commit route
 * counts: a `not_accepting` from the open route is an assignment not open yet.
 */
export function watchClosedBySubmission(fetchImpl: FetchLike): {
  fetchImpl: FetchLike;
  watch: NonNullable<EvidenceSessionDeps["watchSubmission"]>;
} {
  const listeners = new Set<() => void>();
  const wrapped: FetchLike = async (input, init) => {
    const response = await fetchImpl(input, init);
    if (input === COMMIT_PATH && response.status === 409) {
      const body: unknown = await response.clone().json().catch(() => undefined);
      if (typeof body === "object" && body !== null && (body as { status?: unknown }).status === "not_accepting") {
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
  const closed = watchClosedBySubmission(fetchImpl);
  return {
    journal: input.journal,
    documentId: input.documentId,
    open: () => openWork(input.assignmentId, fetchImpl),
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
