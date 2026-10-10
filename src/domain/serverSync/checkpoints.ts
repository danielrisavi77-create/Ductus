/**
 * The wire contract for checkpoints (F1-5b), between the client and
 * `public.pisac_create_checkpoint`
 * as defined in pisac-editor. Ductus rewrites the SQL side (docs/BACKEND.md §2);
 * this contract is the shape the rewritten RPC must keep.
 *
 * Pure TypeScript: no Supabase, Next.js or React imports, so every branch is
 * unit-testable without a database. The RPC answers with a jsonb object; the
 * network, a proxy or a future migration can all hand us something else, so
 * nothing here trusts the shape it is given.
 *
 * What a checkpoint is, and is not:
 *
 *   - It is a NAME the author put on a revision the SERVER holds. The content
 *     is read inside the definer function from `pisac_documents`, so there is
 *     no request field for it here either — a client that could supply the
 *     bytes could name a checkpoint after something the server never held.
 *   - It is therefore NOT a snapshot of local durable state. Anything still in
 *     the pending queue is by definition not in it, and the UI is required to
 *     say so (`UNSYNCED_CHANGES_NOTE`) rather than let the author assume it.
 *     That is the same rule the eight sync states exist for: local durable
 *     state is not canonical server state, and one must never be shown as the
 *     other.
 *   - It is immutable. There is no rename, no delete and, in F1, no restore
 *     (that is F2+, see docs/F1_STATE.md). Nothing in this module produces a
 *     request that would change one.
 */

import { formatDateTimeHr } from "@/lib/i18n/hr";

import { isPlainObject, ownProperty } from "../json";

/** Every status `pisac_create_checkpoint` can return, and nothing else. */
export const CHECKPOINT_STATUSES = [
  "created",
  "not_found",
  "unauthenticated",
  "invalid_name",
] as const;

export type CheckpointStatus = (typeof CHECKPOINT_STATUSES)[number];

/**
 * The longest name the column, the RPC and the client all agree on. Counted
 * in code points, because `char_length` in Postgres counts characters and a
 * name that passes here must not be refused there.
 */
export const CHECKPOINT_NAME_MAX_LENGTH = 120;

export type CheckpointOutcome =
  /**
   * The checkpoint exists at `revision` under the name that was asked for.
   * Also the answer to a repeated call with the same name at the same
   * revision: the unique key is (document, revision, name) and the content is
   * server truth, so the second call names the very same immutable object.
   */
  | { status: "created"; checkpointId: string; revision: number }
  | { status: "not_found" }
  | { status: "unauthenticated" }
  | { status: "invalid_name" };

/** Returned when the payload is not a recognisable outcome at all. */
export type InvalidCheckpointOutcome = { status: "invalid" };

/** One checkpoint as the list shows it. Deliberately WITHOUT the document. */
export type CheckpointSummary = {
  id: string;
  name: string;
  revision: number;
  /** ISO-8601, as Postgres serialises timestamptz. */
  createdAt: string;
};

export type CheckpointNameFailure = "empty" | "too_long";

export type CheckpointNameResult =
  | { ok: true; value: string }
  | { ok: false; reason: CheckpointNameFailure };

/**
 * Trim + length only, counted in code points.
 *
 * Inner whitespace is deliberately preserved, exactly as project titles are:
 * the name is the author's, and collapsing it would silently rewrite their
 * text. `[...value].length` rather than `.length`, so an emoji or a combining
 * pair counts as what Postgres will count.
 *
 * Mirrors the `btrim` + `char_length` guard in the RPC. Both exist: this one
 * so an impossible name never becomes a round trip that can only fail, that
 * one so a direct call cannot plant a blank name in an immutable table.
 */
export function validateCheckpointName(input: unknown): CheckpointNameResult {
  if (typeof input !== "string") {
    return { ok: false, reason: "empty" };
  }
  const value = input.trim();
  if (value === "") {
    return { ok: false, reason: "empty" };
  }
  if ([...value].length > CHECKPOINT_NAME_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, value };
}

/**
 * Codes for the failures the server action reports back, with one Croatian
 * message each — the same shape as `SERVER_SYNC_ERROR_MESSAGES`.
 */
export type CheckpointErrorCode =
  | "naziv-prazan"
  | "naziv-dug"
  | "rad-nepoznat"
  | "spremanje"
  | "citanje"
  | "odgovor-neispravan";

/** The code a rejected name maps to. */
export function checkpointNameErrorCode(
  reason: CheckpointNameFailure,
): CheckpointErrorCode {
  return reason === "empty" ? "naziv-prazan" : "naziv-dug";
}


/**
 * A revision as PostgREST serialises a `bigint`. Fractional, negative,
 * non-finite or unsafe numbers are refused rather than rounded: a checkpoint
 * that named the wrong revision would be worse than no checkpoint at all.
 * 0 is legitimate — a document that exists and holds no commit yet.
 */
function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Narrows an untrusted RPC payload to a `CheckpointOutcome`.
 *
 * Strict about what it reads: an unknown status, a missing id or an unusable
 * revision all yield `{ status: 'invalid' }`. Keys it does not know are
 * ignored rather than rejected, so adding a field to the RPC's answer in a
 * later migration does not break older clients.
 */
export function parseCheckpointOutcome(
  raw: unknown,
): CheckpointOutcome | InvalidCheckpointOutcome {
  if (!isPlainObject(raw)) {
    return { status: "invalid" };
  }

  const status = ownProperty(raw, "status");
  if (typeof status !== "string") {
    return { status: "invalid" };
  }

  if (status === "not_found" || status === "unauthenticated" || status === "invalid_name") {
    return { status };
  }
  if (status !== "created") {
    return { status: "invalid" };
  }

  const checkpointId = ownProperty(raw, "checkpointId");
  const revision = ownProperty(raw, "revision");

  if (typeof checkpointId !== "string" || checkpointId === "") {
    return { status: "invalid" };
  }
  if (!isRevision(revision)) {
    return { status: "invalid" };
  }

  return { status: "created", checkpointId, revision };
}

/**
 * Narrows one untrusted row of the checkpoint list.
 *
 * Returns `null` for a row that cannot be read rather than a row with holes
 * in it: a list is allowed to be shorter than the table, but a checkpoint
 * shown without the revision it names would be a bookmark to nowhere.
 */
export function parseCheckpointRow(raw: unknown): CheckpointSummary | null {
  if (!isPlainObject(raw)) {
    return null;
  }

  const id = ownProperty(raw, "id");
  const name = ownProperty(raw, "name");
  const revision = ownProperty(raw, "revision");
  const createdAt = ownProperty(raw, "created_at");

  if (typeof id !== "string" || id === "") {
    return null;
  }
  if (typeof name !== "string" || name === "") {
    return null;
  }
  if (!isRevision(revision)) {
    return null;
  }
  if (typeof createdAt !== "string" || createdAt === "") {
    return null;
  }

  return { id, name, revision, createdAt };
}

/** The readable rows of an untrusted list, in the order they arrived. */
export function parseCheckpointList(raw: unknown): CheckpointSummary[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const rows: CheckpointSummary[] = [];
  for (const entry of raw) {
    const row = parseCheckpointRow(entry);
    if (row !== null) {
      rows.push(row);
    }
  }
  return rows;
}

/**
 * The date as the list shows it, in Croatian.
 *
 * Delegates to the shared formatter (F1-9b), which builds the string from its
 * own month table rather than from whatever locale data the host's ICU build
 * carries — so the checkpoint list reads the same in every runtime. It also
 * keeps the old promise: an unreadable timestamp is shown as it is rather than
 * as "Invalid Date", and is never silently replaced by "now".
 */
export function formatCheckpointDate(createdAt: string): string {
  return formatDateTimeHr(createdAt);
}
