// Direct module paths: the collaboration index also re-exports
// conditional-validity, which this boundary must never load (B5/D4/D6).
import { isDocumentId, isTextAnchorInput } from "@/domain/collaboration/comment";
import {
  isExpectedSeq,
  isRangeHash,
  isRequestId,
  isRevisionKind,
  isRevisionNumber,
  isRevisionText,
} from "@/domain/collaboration/revision-input";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import type { WithActor } from "@/server/db/with-actor";
import { checkMutationRequest, readBodyWithLimit } from "@/server/http/mutation-request";

/**
 * DAN-314 step 2f HTTP boundary (docs/backend/suradnja.md 4.14, #1506). The
 * SECURITY DEFINER RPCs of migrations 20261106160000, 20261106190000,
 * 20261106220000 (revision ceiling) and 20261109210000 (rereview) decide who
 * may read or write, which transition is allowed, which revision is too new
 * and whether an accepted range counts as changed; this only refuses
 * malformed requests before the database, in an order that needs no database
 * at all, so no answer tells whether a request or document exists.
 *
 * Identity, role, state, author and institution are never inputs. Output uses
 * the column names of the RPCs. A log line carries the action and one closed
 * code, never text, anchor, hash or id (H3).
 */

export const MAX_REVISION_BODY_BYTES = 16 * 1024;
const BODY_TIMEOUT_MS = 5_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const BIGINT = /^(0|[1-9][0-9]{0,15})$/;
const STATES = new Set(["open", "responded", "accepted", "reopened", "withdrawn"]);
const CLOSED = new Set(["accepted", "reopened", "withdrawn"]);
const VERSION_MAX = 1000;

export type RevisionAction = "create" | "respond" | "accept" | "reopen" | "rereview" | "withdraw" | "list";
export const REVISION_ACTIONS: readonly RevisionAction[] = [
  "create", "respond", "accept", "reopen", "rereview", "withdraw", "list",
];

export interface RevisionDeps {
  withActor: WithActor;
  expectedOrigin: string;
  sessionToken?: string;
}

type Input = Record<string, unknown>;
type Row = Record<string, unknown>;

interface Spec {
  /** Exactly these keys, sorted. */
  keys: readonly string[];
  /** The id key, checked before the values: a malformed id is answered as ZD403 (G7). */
  id: "documentId" | "requestId";
  valid(input: Input): boolean;
  sql: string;
  params(input: Input): unknown[];
}

// Each call is spelled out in full: the RPC/HTTP inventory looks for "collaboration.name(".
const TRANSITION = "SELECT outcome, row_seq, version, state FROM ";

const SPECS: Record<RevisionAction, Spec> = {
  create: {
    keys: ["anchor", "documentId", "instruction", "requestedRevision"],
    id: "documentId",
    valid: (i) => isTextAnchorInput(i.anchor) && isRevisionText(i.instruction) && isRevisionNumber(i.requestedRevision),
    sql: "SELECT request_id, row_seq, version, state"
      + " FROM collaboration.create_revision_request($1, $2::jsonb, $3, $4::bigint)",
    params: (i) => [i.documentId, JSON.stringify(i.anchor), i.instruction, i.requestedRevision],
  },
  respond: {
    keys: ["expectedSeq", "explanation", "kind", "requestId", "responseRevision"],
    id: "requestId",
    valid: (i) => isExpectedSeq(i.expectedSeq) && isRevisionKind(i.kind) && isRevisionText(i.explanation)
      && isRevisionNumber(i.responseRevision),
    sql: `${TRANSITION}collaboration.respond_revision_request($1::uuid, $2::bigint, $3, $4, $5::bigint)`,
    params: (i) => [i.requestId, i.expectedSeq, i.kind, i.explanation, i.responseRevision],
  },
  // The hash and the anchor it was computed under travel together (#1831 B):
  // both null, or both well formed. Anything else is refused before the
  // database, so an accepted anchor never lands without its hash.
  accept: {
    keys: ["acceptedAnchor", "acceptedRevision", "expectedSeq", "rangeHash", "requestId"],
    id: "requestId",
    valid: (i) => isExpectedSeq(i.expectedSeq) && isRevisionNumber(i.acceptedRevision)
      && ((i.rangeHash === null && i.acceptedAnchor === null)
        || (isRangeHash(i.rangeHash) && isTextAnchorInput(i.acceptedAnchor))),
    sql: `${TRANSITION}collaboration.accept_revision_request($1::uuid, $2::bigint, $3::bigint, $4, $5::jsonb)`,
    params: (i) => [i.requestId, i.expectedSeq, i.acceptedRevision, i.rangeHash,
      i.acceptedAnchor === null ? null : JSON.stringify(i.acceptedAnchor)],
  },
  reopen: {
    keys: ["expectedSeq", "instruction", "requestId", "requestedRevision"],
    id: "requestId",
    valid: (i) => isExpectedSeq(i.expectedSeq) && isRevisionText(i.instruction) && isRevisionNumber(i.requestedRevision),
    sql: `${TRANSITION}collaboration.reopen_revision_request($1::uuid, $2::bigint, $3, $4::bigint)`,
    params: (i) => [i.requestId, i.expectedSeq, i.instruction, i.requestedRevision],
  },
  // Only the request and its counter: the database reads the current work
  // itself and decides whether the accepted range changed. A hash, a revision
  // or text sent here is an extra key and is refused before the database.
  rereview: {
    keys: ["expectedSeq", "requestId"],
    id: "requestId",
    valid: (i) => isExpectedSeq(i.expectedSeq),
    sql: `${TRANSITION}collaboration.rereview_revision_request($1::uuid, $2::bigint)`,
    params: (i) => [i.requestId, i.expectedSeq],
  },
  withdraw: {
    keys: ["expectedSeq", "requestId"],
    id: "requestId",
    valid: (i) => isExpectedSeq(i.expectedSeq),
    sql: `${TRANSITION}collaboration.withdraw_revision_request($1::uuid, $2::bigint)`,
    params: (i) => [i.requestId, i.expectedSeq],
  },
  list: {
    keys: ["documentId"],
    id: "documentId",
    valid: () => true,
    sql: "SELECT request_id, request_state, request_version, request_row_seq, anchor, version, instruction,"
      + " requested_revision, opened_is_own, opened_window, response_kind, response_explanation, response_revision,"
      + " response_is_own, response_window, closed_as, closed_is_own, closed_window, accepted_revision,"
      + " accepted_range_hash FROM collaboration.list_revision_requests($1)",
    params: (i) => [i.documentId],
  },
};

function respond(status: number, payload: Record<string, unknown> = { error: "unavailable" }): Response {
  return Response.json(payload, { status, headers: { "cache-control": "no-store" } });
}

/** A bigint column as node-postgres returns it: a decimal string, read only into a safe integer. */
function bigint(value: unknown, min: number): number | undefined {
  if (typeof value !== "string" || !BIGINT.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min ? n : undefined;
}

function version(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= VERSION_MAX
    ? value as number
    : undefined;
}

function state(value: unknown): string | undefined {
  return typeof value === "string" && STATES.has(value) ? value : undefined;
}

function window(value: unknown): string | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : undefined;
}

class Malformed extends Error {}

/** A value, or null where the column may be null; anything else makes the row malformed. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Malformed();
  return value;
}

function nullable<T>(raw: unknown, read: (value: unknown) => T | undefined): T | null {
  return raw === null ? null : must(read(raw));
}

const bool = (value: unknown) => (typeof value === "boolean" ? value : undefined);
const text = (value: unknown) => (typeof value === "string" ? value : undefined);

/** Every row has the same keys, for the student and the teacher alike (H4). */
function listRow(row: Row): Row {
  const anchor = row.anchor;
  if (anchor !== null && (typeof anchor !== "object" || Array.isArray(anchor))) throw new Malformed();
  const view: Row = {
    request_id: must(isRequestId(row.request_id) ? row.request_id : undefined),
    request_state: must(state(row.request_state)),
    request_version: must(version(row.request_version)),
    request_row_seq: must(bigint(row.request_row_seq, 1)),
    anchor,
    version: must(version(row.version)),
    instruction: must(text(row.instruction)),
    requested_revision: must(bigint(row.requested_revision, 0)),
    opened_is_own: must(bool(row.opened_is_own)),
    opened_window: must(window(row.opened_window)),
    response_kind: nullable(row.response_kind, (v) => (isRevisionKind(v) ? v : undefined)),
    response_explanation: nullable(row.response_explanation, text),
    response_revision: nullable(row.response_revision, (v) => bigint(v, 0)),
    response_is_own: nullable(row.response_is_own, bool),
    response_window: nullable(row.response_window, window),
    closed_as: nullable(row.closed_as, (v) => (typeof v === "string" && CLOSED.has(v) ? v : undefined)),
    closed_is_own: nullable(row.closed_is_own, bool),
    closed_window: nullable(row.closed_window, window),
    accepted_revision: nullable(row.accepted_revision, (v) => bigint(v, 0)),
    accepted_range_hash: nullable(row.accepted_range_hash, (v) => (isRangeHash(v) ? v : undefined)),
  };
  // A response and a closing are each whole or absent.
  const groups = [
    ["response_kind", "response_explanation", "response_revision", "response_is_own", "response_window"],
    ["closed_as", "closed_is_own", "closed_window"],
  ];
  for (const group of groups) {
    if (new Set(group.map((key) => view[key] === null)).size !== 1) throw new Malformed();
  }
  if ((view.accepted_revision !== null) !== (view.closed_as === "accepted")) throw new Malformed();
  if (view.accepted_range_hash !== null && view.closed_as !== "accepted") throw new Malformed();
  return view;
}

function success(action: RevisionAction, rows: Row[]): Response {
  if (action === "list") return respond(200, { requests: rows.map(listRow) });
  const row = rows.length === 1 ? rows[0] : undefined;
  if (!row) throw new Malformed();
  const current = {
    row_seq: must(bigint(row.row_seq, 1)),
    version: must(version(row.version)),
    state: must(state(row.state)),
  };
  if (action === "create") {
    return respond(200, { request_id: must(isRequestId(row.request_id) ? row.request_id : undefined), ...current });
  }
  if (row.outcome === "applied") return respond(200, { outcome: "applied", ...current });
  if (row.outcome === "conflict") return respond(409, { outcome: "conflict", ...current });
  throw new Malformed();
}

/**
 * The exact JCS bytes of an object with exactly the keys of the action
 * (4.12 t. 6, 4.10 t. 2): this alone refuses a duplicate key, which
 * JSON.parse would silently resolve to the last one (G5), and every other
 * second spelling of the same value.
 */
function strictInput(text: string, value: unknown, spec: Spec): Input | null {
  let canonical: string;
  try {
    canonical = canonicalizeJcs(value);
  } catch {
    return null;
  }
  if (canonical !== text || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== spec.keys.length || keys.some((key, i) => key !== spec.keys[i])) return null;
  return value as Input;
}

export async function handleRevisionRequest(
  action: RevisionAction,
  request: Request,
  deps: RevisionDeps,
): Promise<Response> {
  const spec = SPECS[action];
  let allowed;
  try {
    allowed = checkMutationRequest(request, deps.expectedOrigin);
  } catch {
    return respond(503);
  }
  if (!allowed.ok) return respond(allowed.status, { error: allowed.reason });
  const token = deps.sessionToken;
  if (token === undefined || !TOKEN.test(token)) return respond(401, { error: "unauthorized" });
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return respond(415, { error: "unsupported_media_type" });
  }

  const raw = await readBodyWithLimit(request, MAX_REVISION_BODY_BYTES, BODY_TIMEOUT_MS);
  if (!raw.ok) return respond(raw.status, { error: raw.reason });
  let text: string;
  let value: unknown;
  try {
    // A byte order mark stays in the text, so it is refused like any other byte.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw.bytes);
    value = JSON.parse(text);
  } catch {
    return respond(400, { error: "invalid_json" });
  }
  const input = strictInput(text, value, spec);
  if (!input) return respond(422, { error: "invalid_input" });
  // A malformed id is answered like a foreign or missing one, before the database (G7).
  if (!(spec.id === "documentId" ? isDocumentId(input.documentId) : isRequestId(input.requestId))) {
    return respond(403, { error: "forbidden" });
  }
  if (!spec.valid(input)) return respond(422, { error: "invalid_input" });

  let rows: Row[];
  try {
    const result = await deps.withActor(token, async (tx) => tx.query<Row>(spec.sql, spec.params(input)));
    rows = result.rows;
  } catch (error) {
    // PostgreSQL raises documented ZD codes; its message, SQL and parameters never leave.
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ZD401") return respond(401, { error: "unauthorized" });
    if (code === "ZD403") return respond(403, { error: "forbidden" });
    // A transition the state does not allow; a stale counter is the outcome "conflict" instead.
    if (code === "ZD409") return respond(409, { error: "not_allowed" });
    if (code === "ZD422") return respond(422, { error: "invalid_input" });
    console.error("revision request failed", action, typeof code === "string" && SQLSTATE.test(code) ? code : "unknown");
    return respond(503);
  }
  try {
    return success(action, rows);
  } catch {
    console.error("revision request failed", action, "row_malformed");
    return respond(503);
  }
}
