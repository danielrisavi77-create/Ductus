/**
 * The wire contract between the client and `public.pisac_commit_document`
 * as defined in pisac-editor. Ductus rewrites the SQL side (docs/BACKEND.md §2);
 * this contract is the shape the rewritten RPC must keep.
 *
 * Pure TypeScript: no Supabase, Next.js or React imports, so every branch is
 * unit-testable without a database. The RPC answers with a jsonb object; the
 * network, a proxy or a future migration can all hand us something else, so
 * nothing here trusts the shape it is given.
 *
 * INVARIANT (constitution) — no silent last-write-wins. `stale_base` is a
 * first-class outcome, not an error to be retried by overwriting: it carries
 * the server's current revision so the caller can rebase or discard
 * explicitly (F1-5a).
 *
 * INVARIANT (dossier §7) — the idempotency key is
 * `(document_id, actor_id, client_transaction_id)`. The actor is taken from
 * the session by the RPC itself and is deliberately absent from the request:
 * a client that could name the actor could replay someone else's key.
 */

import { validateDocument, type CanonicalDocument, type DocumentTransaction } from "../document";
import { isPlainObject, ownProperty } from "../json";

/** Every status `pisac_commit_document` can return, and nothing else. */
export const COMMIT_STATUSES = [
  "committed",
  "duplicate",
  "txid_reused",
  "stale_base",
  "too_large",
  "not_found",
  "unauthenticated",
  "invalid_document",
  "invalid_client_transaction_id",
] as const;

/**
 * 1 MiB, mirrored by the `pg_column_size` guard in the RPC. Checked here
 * first so an oversized document never leaves the machine, and there so a
 * direct call cannot plant one in the revision log forever.
 */
export const MAX_DOCUMENT_BYTES = 1_048_576;

/** UTF-8 byte length of a document as it would be sent, not its character count. */
export function documentByteLength(document: unknown): number {
  return new TextEncoder().encode(JSON.stringify(document) ?? "").length;
}

export function exceedsDocumentSizeLimit(document: unknown): boolean {
  return documentByteLength(document) > MAX_DOCUMENT_BYTES;
}

export type CommitStatus = (typeof COMMIT_STATUSES)[number];

/**
 * A parsed answer from the RPC.
 *
 * `committed` and `duplicate` both carry the revision the payload occupies —
 * a replay of a lost response is indistinguishable from the original commit
 * on purpose, and the caller may treat both as an ACK for that revision.
 */
export type CommitOutcome =
  | { status: "committed"; revision: number }
  | { status: "duplicate"; revision: number }
  /** The same idempotency key was sent with different content: a client bug. */
  | { status: "txid_reused" }
  | { status: "stale_base"; currentRevision: number }
  | { status: "too_large" }
  | { status: "not_found" }
  | { status: "unauthenticated" }
  | { status: "invalid_document" }
  | { status: "invalid_client_transaction_id" };

/** Returned when the payload is not a recognisable outcome at all. */
export type InvalidCommitOutcome = { status: "invalid" };

/**
 * What `pisac_ensure_document` answers. The document stays `unknown`: it is
 * canonical server state, but it is still untrusted bytes until
 * `validateDocument` has seen it.
 */
export type EnsureOutcome =
  | { status: "ok"; documentId: string; revision: number; document: unknown }
  | { status: "not_found" }
  | { status: "unauthenticated" };

/** Arguments of the RPC, named exactly as the SQL function declares them. */
export type CommitRequest = {
  p_document_id: string;
  p_base_revision: number;
  p_document: CanonicalDocument;
  p_client_transaction_id: string;
};

/**
 * Codes for the failures the server action reports back, with one Croatian
 * message each — the same shape as `ACTION_ERROR_MESSAGES` in
 * `@/domain/workspace/types`.
 *
 * There is deliberately no code for a successful commit: durability is stated
 * by the sync state chip (`@/domain/sync/labels`), and the constitution
 * forbids a generic "Saved" label. `stale_base` is likewise absent — it is an
 * outcome the caller resolves explicitly, not an error message.
 */
export type ServerSyncErrorCode =
  | "zapis-neispravan"
  | "prevelik"
  | "rad-nepoznat"
  | "citanje"
  | "slanje"
  | "odgovor-neispravan";

export const SERVER_SYNC_ERROR_MESSAGES: Record<ServerSyncErrorCode, string> = {
  "zapis-neispravan": "Zapis rada nije u ispravnom obliku, pa nije poslan.",
  prevelik: "Dokument je prevelik za spremanje.",
  "rad-nepoznat": "Rad nije pronađen na poslužitelju.",
  citanje: "Rad trenutačno nije moguće dohvatiti s poslužitelja.",
  slanje: "Promjena nije poslana na poslužitelj. Pokušat ćemo ponovno.",
  "odgovor-neispravan": "Poslužitelj je vratio odgovor koji nije moguće pročitati.",
};

/**
 * Narrows an untrusted code (a query parameter, a serialised error) to a
 * known one. `in` would walk the prototype chain, so only own keys count.
 */
export function parseServerSyncErrorCode(raw: unknown): ServerSyncErrorCode | null {
  if (typeof raw !== "string") {
    return null;
  }
  return Object.prototype.hasOwnProperty.call(SERVER_SYNC_ERROR_MESSAGES, raw)
    ? (raw as ServerSyncErrorCode)
    : null;
}

/**
 * A revision as Postgres `bigint` is serialised by PostgREST: a JSON number.
 * Anything fractional, negative, non-finite or beyond `Number.MAX_SAFE_INTEGER`
 * is refused rather than rounded — a silently rounded revision would make the
 * next compare-and-set lie.
 */
function isRevision(value: unknown, minimum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum
  );
}

/**
 * Narrows an untrusted RPC payload to a `CommitOutcome`.
 *
 * Strict about what it reads: an unknown status or a missing, fractional or
 * unsafe revision all yield `{ status: 'invalid' }`, because guessing here
 * would mean guessing about an author's document. Keys it does not know are
 * ignored rather than rejected, so adding a field to the RPC's answer in a
 * later migration does not break older clients.
 */
export function parseCommitOutcome(raw: unknown): CommitOutcome | InvalidCommitOutcome {
  if (!isPlainObject(raw)) {
    return { status: "invalid" };
  }

  const status = ownProperty(raw, "status");
  if (typeof status !== "string") {
    return { status: "invalid" };
  }

  switch (status) {
    case "committed":
    case "duplicate": {
      const revision = ownProperty(raw, "revision");
      // A commit always advances past 0, so revision 0 is not an ACK.
      if (!isRevision(revision, 1)) {
        return { status: "invalid" };
      }
      return { status, revision };
    }
    case "stale_base": {
      const currentRevision = ownProperty(raw, "currentRevision");
      // 0 is legitimate here: the document exists and holds no commit yet.
      if (!isRevision(currentRevision, 0)) {
        return { status: "invalid" };
      }
      return { status: "stale_base", currentRevision };
    }
    case "txid_reused":
    case "too_large":
    case "not_found":
    case "unauthenticated":
    case "invalid_document":
    case "invalid_client_transaction_id":
      return { status };
    default:
      return { status: "invalid" };
  }
}

/** Narrows an untrusted `pisac_ensure_document` payload. Same rules. */
export function parseEnsureOutcome(raw: unknown): EnsureOutcome | InvalidCommitOutcome {
  if (!isPlainObject(raw)) {
    return { status: "invalid" };
  }

  const status = ownProperty(raw, "status");

  if (status === "not_found" || status === "unauthenticated") {
    return { status };
  }
  if (status !== "ok") {
    return { status: "invalid" };
  }

  const documentId = ownProperty(raw, "documentId");
  const revision = ownProperty(raw, "revision");

  if (typeof documentId !== "string" || documentId === "") {
    return { status: "invalid" };
  }
  // 0 is the revision of a document that exists and holds no commit yet.
  if (!isRevision(revision, 0)) {
    return { status: "invalid" };
  }
  if (!Object.prototype.hasOwnProperty.call(raw, "document")) {
    return { status: "invalid" };
  }

  return { status: "ok", documentId, revision, document: raw.document };
}

/**
 * Builds the RPC arguments from a queued transaction.
 *
 * Only `REPLACE_DOCUMENT` exists in F1 (dossier §5); a transaction of any
 * other kind is refused rather than sent as if it were a replacement, because
 * the server would store its document wholesale.
 */
export function commitRequestFromTransaction(
  documentId: string,
  tx: DocumentTransaction,
): CommitRequest | null {
  if (tx.kind !== "REPLACE_DOCUMENT") {
    return null;
  }
  if (typeof documentId !== "string" || documentId === "") {
    return null;
  }
  // The column and the RPC both cap this at 128; refusing here means the
  // over-long key never becomes a round trip that can only fail.
  if (
    typeof tx.clientTransactionId !== "string" ||
    tx.clientTransactionId === "" ||
    tx.clientTransactionId.length > 128
  ) {
    return null;
  }
  if (!isRevision(tx.baseRevision, 0)) {
    return null;
  }
  const validation = validateDocument(tx.document);
  if (!validation.ok || exceedsDocumentSizeLimit(validation.doc)) {
    return null;
  }

  return {
    p_document_id: documentId,
    p_base_revision: tx.baseRevision,
    p_document: validation.doc,
    p_client_transaction_id: tx.clientTransactionId,
  };
}
