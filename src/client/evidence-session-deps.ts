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
  return {
    journal: input.journal,
    documentId: input.documentId,
    open: () => openWork(input.assignmentId, fetchImpl),
    replayer: createBrowserEditStepsV1Replayer,
    createRunner: (work) => createDrainRunner<QueuedTransaction>({
      journal: input.journal,
      transport: createEvidenceTransport(fetchImpl),
      verifyFor: evidenceVerifierFor(work),
    }),
    network: {
      online: () => readOnline(source),
      onOnline: (listener) => {
        source.addEventListener("online", listener);
        return () => source.removeEventListener("online", listener);
      },
    },
  };
}
