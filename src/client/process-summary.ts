/**
 * The browser side of the process summary route (F-10 PR1, contract on #476;
 * route: B-13, POST /api/process-summary). The body names the document and
 * nothing else: who asks comes only from the session cookie, so the student
 * and the teacher send the same request and get the same bytes (PRODUCT §5
 * rule 5, D-80 point 6).
 *
 * A 200 body is shown only when it is exactly `ProcessSummaryV1`: every
 * object has exactly its keys, every number is a whole number in range, every
 * time is a whole UTC minute, the counts agree with their lists and the
 * record state agrees with the gaps. Anything else, including a key the
 * client does not know, is `unavailable` and never reaches the screen, so
 * `ProcessSummaryView` only ever draws a checked summary.
 */

import {
  PROCESS_SUMMARY_FORMAT_V1,
  type MinuteSpan,
  type ProcessSummaryV1,
} from "@/domain/projection/process-summary";
import { isEvidenceMinuteV2 } from "@/domain/forensics/evidence-segment-v2";

export type SummaryOutcome =
  | { kind: "ok"; summary: ProcessSummaryV1 }
  | { kind: "signedOut" | "notFound" | "unavailable" };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function exactly(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

const whole = (value: unknown, min: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min;

function minuteSpan(value: unknown): MinuteSpan | null {
  if (!exactly(value, ["from", "to"])) return null;
  const { from, to } = value;
  if (!isEvidenceMinuteV2(from) || !isEvidenceMinuteV2(to) || from > to) return null;
  return { from, to };
}

function list<T>(value: unknown, item: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  for (const entry of value) {
    const checked = item(entry);
    if (checked === null) return null;
    out.push(checked);
  }
  return out;
}

/** The summary when `value` is exactly `ProcessSummaryV1`, otherwise null. */
export function parseProcessSummaryV1(value: unknown): ProcessSummaryV1 | null {
  if (!exactly(value, ["summaryFormat", "sessions", "pastes", "gaps", "recordState"])) return null;
  if (value.summaryFormat !== PROCESS_SUMMARY_FORMAT_V1) return null;

  const { sessions, pastes, gaps, recordState } = value;
  if (!exactly(sessions, ["evidenceKind", "breakAboveMinutes", "count", "items"])
    || sessions.evidenceKind !== "observed" || !whole(sessions.breakAboveMinutes, 1)) return null;
  const sessionItems = list(sessions.items, minuteSpan);
  if (sessionItems === null || sessions.count !== sessionItems.length) return null;

  if (!exactly(pastes, ["evidenceKind", "listedAboveCharacters", "listed", "smallerCount"])
    || pastes.evidenceKind !== "observed" || !whole(pastes.listedAboveCharacters, 0)
    || !whole(pastes.smallerCount, 0)) return null;
  const above = pastes.listedAboveCharacters;
  const listed = list(pastes.listed, (entry) => {
    if (!exactly(entry, ["at", "characters", "origin"]) || entry.origin !== "not_observed") return null;
    const at = minuteSpan(entry.at);
    // Listed only above P-02, as the server decides it.
    if (at === null || !whole(entry.characters, above + 1)) return null;
    return { at, characters: entry.characters, origin: "not_observed" as const };
  });
  if (listed === null) return null;

  if (!exactly(gaps, ["evidenceKind", "items"]) || gaps.evidenceKind !== "observed") return null;
  const gapItems = list(gaps.items, (entry) => {
    if (!exactly(entry, ["previousEndedAt", "nextStartedAt"])) return null;
    const { previousEndedAt, nextStartedAt } = entry;
    if (!isEvidenceMinuteV2(previousEndedAt) || !isEvidenceMinuteV2(nextStartedAt)) return null;
    return { previousEndedAt, nextStartedAt };
  });
  if (gapItems === null) return null;

  // The state the record shows must be the one its gap list says.
  const expectedState: ProcessSummaryV1["recordState"] = gapItems.length === 0 ? "complete" : "has_gaps";
  if (recordState !== expectedState) return null;

  return {
    summaryFormat: PROCESS_SUMMARY_FORMAT_V1,
    sessions: { evidenceKind: "observed", breakAboveMinutes: sessions.breakAboveMinutes, count: sessions.count, items: sessionItems },
    pastes: { evidenceKind: "observed", listedAboveCharacters: above, listed, smallerCount: pastes.smallerCount },
    gaps: { evidenceKind: "observed", items: gapItems },
    recordState: expectedState,
  };
}

/**
 * Asks for the summary of `documentId`. `current()` is asked right before the
 * request: once the session has ended in this browser nothing is sent (F-093).
 */
export async function fetchProcessSummary(
  documentId: string,
  current: () => boolean = () => true,
  fetcher: typeof fetch = fetch,
): Promise<SummaryOutcome> {
  if (!current()) return { kind: "signedOut" };
  let response: Response;
  try {
    response = await fetcher("/api/process-summary", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documentId }),
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (response.status === 401) return { kind: "signedOut" };
  if (response.status === 404) return { kind: "notFound" };
  if (response.status !== 200) return { kind: "unavailable" };
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer()));
  } catch {
    return { kind: "unavailable" };
  }
  const summary = parseProcessSummaryV1(value);
  return summary === null ? { kind: "unavailable" } : { kind: "ok", summary };
}
