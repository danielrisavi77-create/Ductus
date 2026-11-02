/**
 * F-8 3d-2c2b: which saver writes the sheet of `/rad`. With an assignment the
 * evidence session records, chains and sends (3d-2c2); without one the local
 * saver writes the journal and nothing goes to `/api/evidence/*` (W6, D8).
 */

import type { FetchLike } from "@/client/evidence-ingest";
import { browserEvidenceSessionDeps } from "@/client/evidence-session-deps";
import type { OnlineSource } from "@/client/online-status";
import type { CanonicalDocument } from "@/domain/document";
import type { SyncState } from "@/domain/sync/states";
import type { AtomicDexieJournal } from "@/lib/journal/atomic-dexie-journal";
import {
  LocalDocumentSaver, type LoadResult, type SaverSnapshot,
} from "@/lib/journal/local-document-saver";

import { EvidenceSession, type EvidenceSnapshot } from "./evidence-session";

/** A snapshot of either saver; only the evidence session ever sets `closedBy`. */
export type DocumentSnapshot = SaverSnapshot & Partial<Pick<EvidenceSnapshot, "closedBy" | "refused">>;

/**
 * The notice of the evidence session, if any (3d-2c2 §3): the server's work
 * differs, or it refused the last step for good.
 */
export function evidenceNotice(snapshot: DocumentSnapshot | null): "conflict" | "refused" | null {
  // Only the evidence session sets `closedBy`: the local saver's own
  // RECOVERY_REQUIRED is the unreadable local record, not the server's work.
  if (!snapshot || snapshot.closedBy === undefined) return null;
  if (READ_ONLY_STATES.includes(snapshot.state) && snapshot.closedBy !== "submission") return "conflict";
  return snapshot.refused ? "refused" : null;
}

/**
 * Whether the saver's snapshot speaks for the sheet (chip and notice): a
 * ready sheet, or one the evidence session loaded in a sticky state, whose
 * local record was read and whose server work differs (3d-2c2 §3). Any other
 * recovery could not read the local record and says so instead.
 */
export function snapshotSpeaks(phase: string, stickyLoad: boolean): boolean {
  return phase === "ready" || (phase === "recovery" && stickyLoad);
}

/** What the provider asks of its saver (3d-2c2 §2, the shared surface). */
export type DocumentSaver = {
  load(): Promise<LoadResult>;
  edit(): void;
  propose(doc: CanonicalDocument): Promise<void>;
  settled(): Promise<void>;
  snapshot(): DocumentSnapshot;
  subscribe(listener: (snapshot: DocumentSnapshot) => void): () => void;
};

/** States after which the evidence session writes and sends nothing more (3d-2c2 §3). */
const READ_ONLY_STATES: readonly SyncState[] = ["CONFLICT", "RECOVERY_REQUIRED"];

/** Whether the sheet must stop taking text: a closed package or a sticky state. */
export function writingClosed(snapshot: DocumentSnapshot): boolean {
  return snapshot.closedBy === "submission" || READ_ONLY_STATES.includes(snapshot.state);
}

/** The saver of one held lock; `evidence` is set only with an assignment. */
export function createDocumentSaver(input: {
  journal: AtomicDexieJournal;
  documentId: string;
  assignmentId: string | null;
  /** Whether this tab's sign-in is still the browser's (F-154); asked before each evidence request. */
  current: () => boolean;
  fetchImpl?: FetchLike;
  source?: OnlineSource;
}): { saver: DocumentSaver; evidence: EvidenceSession | null } {
  const { journal, documentId, assignmentId, current } = input;
  if (!assignmentId) return { saver: new LocalDocumentSaver(journal, documentId), evidence: null };
  const evidence = new EvidenceSession(browserEvidenceSessionDeps({
    journal, documentId, assignmentId, current,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.source ? { source: input.source } : {}),
  }));
  return { saver: evidence, evidence };
}
