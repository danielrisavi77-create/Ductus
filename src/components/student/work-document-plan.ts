import type { OpenOutcome } from "@/client/evidence-ingest";
import { LOCAL_DEMO_DOCUMENT_ID } from "@/lib/journal/local-scope";

import type { WorkContextRead } from "./work-context-read";

// #711 step F1 (contract 6391402093 §2, §5, §8): which document `/rad`
// writes into. Pure: the page reads the session, the work context and the
// work document, and this decides the one plan the sheet, the comments, the
// live view and the submission link follow. Nothing here reads or writes.

/**
 * Mirrors B1 #712 `WorkDocumentRead` (`src/server/evidence/work-document-read.ts`)
 * verbatim; replace with the import once #712 is merged.
 */
export type WorkDocumentRead =
  /** The session's own work for the assignment, the id the evidence path uses. */
  | { kind: "document"; documentId: string }
  /** The session may write, but its work does not exist yet: open it through POST /api/evidence/open. */
  | { kind: "notOpened" }
  /** An active student, but the current version is not acknowledged or not open yet. */
  | { kind: "notAccepting" }
  | { kind: "none" };

export type WorkDocumentPlanInput = {
  /** `searchParams.zadatak` as it came, before any check. */
  rawParam: string | string[] | undefined;
  /** `assignmentParam(rawParam)`. */
  assignmentId: string | null;
  signedIn: boolean;
  /** A session cookie that could not be checked (`journalFor`). */
  signInAgain: boolean;
  /** The journal scope `journalFor` gave, or null. */
  scope: string | null;
  context: WorkContextRead;
  doc: WorkDocumentRead;
};

/** The journal the sheet opens: a person's scope and one document in it. */
export type PlanJournal = { scope: string; documentId: string };

export type WorkDocumentPlan =
  | {
      kind: "assignment";
      journal: PlanJournal;
      assignmentId: string;
      /** ISO due date of the acknowledged current version, for `pastDue`. */
      dueAt: string;
      comments: true; live: true; submission: true;
    }
  | { kind: "opening"; journal: null; assignmentId: string; comments: false; live: false; submission: false }
  | { kind: "notYetOpen"; journal: null; opensAt: string; comments: false; live: false; submission: false }
  /** Carries nothing about the assignment: one answer for every case (A2). */
  | { kind: "unavailable"; journal: null; comments: false; live: false; submission: false }
  | { kind: "free"; journal: PlanJournal; comments: false; live: false; submission: false }
  | { kind: "localDemo"; journal: PlanJournal | null; comments: false; live: false; submission: false }
  | { kind: "signInAgain"; journal: null; comments: false; live: false; submission: false };

const OFF = { comments: false, live: false, submission: false } as const;
const UNAVAILABLE: WorkDocumentPlan = { kind: "unavailable", journal: null, ...OFF };

/** The journal's own rule for a document id (`validDocumentId`). */
function usableDocumentId(id: string): boolean {
  return id.length > 0 && id.length <= 128 && id.trim() !== "" && id !== LOCAL_DEMO_DOCUMENT_ID;
}

/**
 * The plan of one `/rad` render (contract §2 table). The document id of an
 * assignment comes only from `doc.kind === "document"`; with `zadatak` in the
 * address a signed-in person never gets `LOCAL_DEMO_DOCUMENT_ID`, and a
 * parameter that is not one well-formed UUID is `unavailable`, not `free`.
 * The two reads are not one snapshot: any pair other than the three below is
 * `unavailable`, never an editor.
 */
export function workDocumentPlan(input: WorkDocumentPlanInput): WorkDocumentPlan {
  const { rawParam, assignmentId, signedIn, signInAgain, scope, context, doc } = input;
  if (signInAgain) return { kind: "signInAgain", journal: null, ...OFF };
  if (!signedIn) {
    // No session cookie: the local demo journal as before F1 (A18); it sends
    // nothing to the server, with or without `zadatak`.
    return {
      kind: "localDemo",
      journal: scope === null ? null : { scope, documentId: LOCAL_DEMO_DOCUMENT_ID },
      ...OFF,
    };
  }
  // Signed in without a journal cannot happen through journalFor: fail closed.
  if (scope === null) return UNAVAILABLE;
  if (rawParam === undefined) {
    return { kind: "free", journal: { scope, documentId: LOCAL_DEMO_DOCUMENT_ID }, ...OFF };
  }
  if (assignmentId === null || rawParam !== assignmentId) return UNAVAILABLE;
  if (context.kind !== "ready" || context.notice.assignmentId !== assignmentId) return UNAVAILABLE;
  switch (doc.kind) {
    case "document":
      if (!usableDocumentId(doc.documentId)) return UNAVAILABLE;
      return {
        kind: "assignment",
        journal: { scope, documentId: doc.documentId },
        assignmentId,
        dueAt: context.notice.dueAt,
        comments: true, live: true, submission: true,
      };
    case "notOpened":
      return { kind: "opening", journal: null, assignmentId, ...OFF };
    case "notAccepting":
      return { kind: "notYetOpen", journal: null, opensAt: context.notice.opensAt, ...OFF };
    default:
      return UNAVAILABLE;
  }
}

/** What the opening sheet does with one answer of `openWork` (contract §2). */
export type OpenWorkStep =
  /** `router.refresh()`: the server render reads the document again. */
  | { kind: "refresh" }
  /** The notice changed or the assignment takes no work: link to `/zadatak/<id>`. */
  | { kind: "notAccepting" }
  /** The neutral `unavailable` message; `signIn` also offers to sign in again. */
  | { kind: "unavailable"; signIn: boolean }
  /** The existing reload text. */
  | { kind: "reload" }
  /** "Za prvo otvaranje rada potrebna je veza."; retry on the `online` event. */
  | { kind: "offline" }
  /** A message with "Pokušaj ponovno"; never an editor without a document. */
  | { kind: "error" };

/**
 * `refreshed`: this sheet already refreshed after an `opened` answer, so the
 * server render still said `notOpened`; a second refresh would loop.
 * `online`: `navigator.onLine`.
 */
export function openWorkStep(outcome: OpenOutcome, refreshed: boolean, online: boolean): OpenWorkStep {
  switch (outcome.status) {
    case "opened":
      return refreshed ? { kind: "error" } : { kind: "refresh" };
    case "not_accepting":
      return { kind: "notAccepting" };
    case "not_found":
      return { kind: "unavailable", signIn: false };
    case "unauthenticated":
      return { kind: "unavailable", signIn: true };
    case "upgrade_required":
      return { kind: "reload" };
    default:
      return online === false ? { kind: "offline" } : { kind: "error" };
  }
}

/**
 * True only once `nowMs` is strictly after the due date (contract §5). The
 * date must be the canonical ISO form the server sends (`toISOString`);
 * anything else, a rolled-over date included, is false.
 */
export function pastDue(dueAtIso: string, nowMs: number): boolean {
  if (typeof dueAtIso !== "string" || !Number.isFinite(nowMs)) return false;
  const due = Date.parse(dueAtIso);
  if (!Number.isFinite(due) || new Date(due).toISOString() !== dueAtIso) return false;
  return nowMs > due;
}
