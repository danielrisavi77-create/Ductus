/**
 * The browser side of the revision request route (DAN-314, docs/backend/
 * suradnja.md 4.14). Every read and write goes through POST
 * /api/revision-requests/<action> with exactly the JCS form of the input;
 * the client never names an author, a role or a state, the database takes
 * them from the session. A `list` body that is not exactly the documented
 * shape is treated as unavailable as a whole, never shown in part. This
 * step only reads; the student's answer comes in a later step.
 */

import { isTextAnchorInput, type TextAnchor } from "@/domain/collaboration";
import {
  isExpectedSeq, isRangeHash, isRequestId, isRevisionKind, isRevisionNumber, REVISION_TEXT_MAX,
  type RevisionKind,
} from "@/domain/collaboration/revision-input";
import { canonicalizeJcs } from "@/domain/forensics/jcs";

export type RevisionState = "open" | "responded" | "accepted" | "reopened" | "withdrawn";
export type RevisionClosing = "accepted" | "reopened" | "withdrawn";

export type RevisionResponse = {
  readonly kind: RevisionKind;
  readonly explanation: string;
  readonly revision: number;
  readonly isOwn: boolean;
  /** Start of the 5-minute window (P-03) the response was given in. */
  readonly window: string;
};

export type RevisionClosed = {
  readonly as: RevisionClosing;
  readonly isOwn: boolean;
  readonly window: string;
  /** The revision the teacher accepted; null unless `as` is accepted. */
  readonly acceptedRevision: number | null;
};

export type RevisionVersion = {
  readonly version: number;
  readonly instruction: string;
  readonly requestedRevision: number;
  readonly openedIsOwn: boolean;
  readonly openedWindow: string;
  readonly response: RevisionResponse | null;
  readonly closed: RevisionClosed | null;
};

export type RevisionRequest = {
  readonly id: string;
  /** 1, 2, 3… in the order the requests were opened. */
  readonly number: number;
  readonly state: RevisionState;
  /** The counter a transition must carry back unchanged. */
  readonly rowSeq: number;
  readonly anchor: TextAnchor;
  /** Every version, oldest first; the last one is current. */
  readonly versions: readonly RevisionVersion[];
};

export type RevisionListOutcome =
  | { kind: "ok"; requests: RevisionRequest[] }
  | { kind: "signedOut" | "forbidden" | "unavailable" };

const STATES: ReadonlySet<string> = new Set(["open", "responded", "accepted", "reopened", "withdrawn"]);
const CLOSINGS: ReadonlySet<string> = new Set(["accepted", "reopened", "withdrawn"]);
const VERSION_MAX = 1000;
const ROW_KEYS = [
  "accepted_range_hash", "accepted_revision", "anchor", "closed_as", "closed_is_own", "closed_window", "instruction",
  "opened_is_own", "opened_window", "request_id", "request_row_seq", "request_state", "request_version",
  "requested_revision", "response_explanation", "response_is_own", "response_kind", "response_revision",
  "response_window", "version",
].sort();

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isTime = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isVersion = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= VERSION_MAX;
/** Stored text: the database already holds it to its CHECK; only the shape is read here. */
const isStoredText = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const length = [...value].length;
  return length >= 1 && length <= REVISION_TEXT_MAX;
};

function responseOf(row: Record<string, unknown>): RevisionResponse | null | undefined {
  const { response_kind: kind, response_explanation: explanation, response_revision: revision } = row;
  const { response_is_own: isOwn, response_window: window } = row;
  if ([kind, explanation, revision, isOwn, window].every((v) => v === null)) return null;
  if (!isRevisionKind(kind) || !isStoredText(explanation) || !isRevisionNumber(revision)
    || typeof isOwn !== "boolean" || !isTime(window)) return undefined;
  return { kind, explanation, revision, isOwn, window };
}

function closedOf(row: Record<string, unknown>): RevisionClosed | null | undefined {
  const { closed_as: as, closed_is_own: isOwn, closed_window: window } = row;
  const { accepted_revision: acceptedRevision, accepted_range_hash: rangeHash } = row;
  if ([as, isOwn, window, acceptedRevision, rangeHash].every((v) => v === null)) return null;
  if (typeof as !== "string" || !CLOSINGS.has(as) || typeof isOwn !== "boolean" || !isTime(window)) return undefined;
  if (as === "accepted") {
    if (!isRevisionNumber(acceptedRevision) || (rangeHash !== null && !isRangeHash(rangeHash))) return undefined;
  } else if (acceptedRevision !== null || rangeHash !== null) {
    return undefined;
  }
  return { as: as as RevisionClosing, isOwn, window, acceptedRevision: as === "accepted" ? acceptedRevision as number : null };
}

/** Does the last version agree with the request's state (suradnja.md 4.14 transitions)? */
function lastAgrees(state: RevisionState, version: number, last: RevisionVersion): boolean {
  switch (state) {
    case "open": return version === 1 && last.response === null && last.closed === null;
    case "reopened": return version >= 2 && last.response === null && last.closed === null;
    case "responded": return last.response !== null && last.closed === null;
    case "accepted": return last.response !== null && last.closed?.as === "accepted";
    case "withdrawn": return last.closed?.as === "withdrawn";
  }
}

type Building = {
  id: string; state: RevisionState; rowSeq: number; version: number; anchor: TextAnchor; versions: RevisionVersion[];
};

/**
 * Requests from the body of `list`, whose rows come ordered by request and
 * version (one row per version). Null for any row out of shape or out of
 * order, or any request whose versions disagree with its state.
 */
export function requestsFromList(value: unknown): RevisionRequest[] | null {
  if (!isObject(value) || !Array.isArray(value.requests)) return null;
  const requests: Building[] = [];
  for (const row of value.requests as unknown[]) {
    if (!isObject(row)) return null;
    const keys = Object.keys(row).sort();
    if (keys.length !== ROW_KEYS.length || keys.some((key, i) => key !== ROW_KEYS[i])) return null;
    const { request_id: id, request_state: state, request_version: head, request_row_seq: rowSeq } = row;
    const { version, instruction, requested_revision: requestedRevision } = row;
    const { opened_is_own: openedIsOwn, opened_window: openedWindow, anchor } = row;
    if (!isRequestId(id) || typeof state !== "string" || !STATES.has(state) || !isVersion(head)
      || !isExpectedSeq(rowSeq) || !isVersion(version) || version > head || !isStoredText(instruction)
      || !isRevisionNumber(requestedRevision) || typeof openedIsOwn !== "boolean" || !isTime(openedWindow)) {
      return null;
    }
    const response = responseOf(row);
    const closed = closedOf(row);
    if (response === undefined || closed === undefined) return null;
    const entry: RevisionVersion = {
      version, instruction, requestedRevision, openedIsOwn, openedWindow, response, closed,
    };
    const last = requests.at(-1);
    if (version === 1) {
      if (!isTextAnchorInput(anchor) || requests.some((r) => r.id === id)) return null;
      // The request before must be complete before another one starts.
      if (last && last.versions.length !== last.version) return null;
      requests.push({ id, state: state as RevisionState, rowSeq, version: head, anchor, versions: [entry] });
    } else if (anchor === null && last?.id === id && last.state === state && last.rowSeq === rowSeq
      && last.version === head && version === last.versions.length + 1) {
      last.versions.push(entry);
    } else {
      return null;
    }
  }
  for (const request of requests) {
    if (request.versions.length !== request.version) return null;
    const earlier = request.versions.slice(0, -1);
    // A version before the last was closed by reopening, or was answered,
    // accepted and then reopened: accept is allowed only from `responded`.
    const closedRight = (v: RevisionVersion) =>
      v.closed?.as === "reopened" || (v.closed?.as === "accepted" && v.response !== null);
    if (!earlier.every(closedRight)) return null;
    if (!lastAgrees(request.state, request.version, request.versions.at(-1)!)) return null;
  }
  return requests.map(({ id, state, rowSeq, anchor, versions }, index) => ({
    id, number: index + 1, state, rowSeq, anchor, versions,
  }));
}

async function post(action: "list", input: Record<string, unknown>): Promise<Response | null> {
  try {
    return await fetch(`/api/revision-requests/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: canonicalizeJcs(input),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

/** `current` is asked right before the request; false once the session has ended (F-093). */
export async function listRevisionRequests(
  documentId: string, current: () => boolean = () => true,
): Promise<RevisionListOutcome> {
  if (!current()) return { kind: "signedOut" };
  const response = await post("list", { documentId });
  if (response?.status === 401) return { kind: "signedOut" };
  if (response?.status === 403) return { kind: "forbidden" };
  if (!response || response.status !== 200) return { kind: "unavailable" };
  const requests = requestsFromList(await response.json().catch(() => null));
  return requests ? { kind: "ok", requests } : { kind: "unavailable" };
}
