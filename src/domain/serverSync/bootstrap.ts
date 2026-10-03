/**
 * What the editor starts from, decided once, in one pure function.
 *
 * Pure TypeScript: no React, no Dexie, no Supabase — the honesty rule below
 * is the kind of thing that must be testable without mounting anything.
 *
 * INVARIANT (constitution) — local durable state is not canonical server
 * state, and neither may be invented. There are exactly three cases:
 *
 *   1. the local journal has a snapshot -> it wins, with ITS base revision.
 *      The snapshot is what the author last typed; the server copy is older
 *      by definition, and opening on it would show work as lost.
 *   2. no snapshot, but the server answered -> start from the canonical
 *      document at the canonical revision.
 *   3. neither -> `error`. NOT an empty document: mounting an editor on blank
 *      content at revision 0, when the server holds text this request simply
 *      failed to read, invites the author to commit over their own work.
 */

import type { CanonicalDocument } from "../document";

/** A document with the revision it is based on. */
export type RevisionedDocument = {
  document: CanonicalDocument;
  revision: number;
};

export type InitialDocument =
  | {
      mode: "edit";
      document: CanonicalDocument;
      revision: number;
      /** Which source won. Diagnostic only; never shown as a durability claim. */
      from: "journal" | "server";
    }
  | { mode: "error" };

export function resolveInitialDocument(
  journalSnapshot: RevisionedDocument | null | undefined,
  serverDocument: RevisionedDocument | null | undefined,
): InitialDocument {
  if (journalSnapshot) {
    return {
      mode: "edit",
      document: journalSnapshot.document,
      revision: journalSnapshot.revision,
      from: "journal",
    };
  }

  if (serverDocument) {
    return {
      mode: "edit",
      document: serverDocument.document,
      revision: serverDocument.revision,
      from: "server",
    };
  }

  return { mode: "error" };
}

/** Shown when neither source could supply a document. */
export const LOAD_FAILURE_MESSAGE = "Ne mogu učitati dokument. Osvježi stranicu.";
