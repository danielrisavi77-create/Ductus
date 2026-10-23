import type { EditStepV1 } from "../document/edit-step";
import {
  verifyCanonicalEvidencePayloadV2,
  verifyEvidenceChainV2,
  type EvidenceChainFailureV2,
  type EvidenceChainHeadV2,
} from "../forensics/evidence-chain-v2";
import type { EvidenceSegmentV2, EvidenceSourceV2 } from "../forensics/evidence-segment-v2";

/**
 * Process summary, core of B-13 (PRODUCT §7, rule 5 of §5, D-80 point 6).
 *
 * One pure function builds the summary for everyone who may see it. Its input
 * is the stored evidence of one package and the faculty thresholds, nothing
 * about who asks: there is no parameter that could make two answers differ,
 * so two callers with the same evidence get the same bytes.
 *
 * The summary is built only from what the server accepted, after the chain is
 * verified against the recorded head. A chain that does not verify gives no
 * summary at all, never a partial one.
 *
 * Not computed, on purpose (PRODUCT §5 rules 2 and 4, §7 "Zabranjeno"): no
 * total of pasted text, no share of the work, no speed, no pause lengths, no
 * ordering by size. Lists follow the order of the chain.
 */

export const PROCESS_SUMMARY_FORMAT_V1 = "ductus-process-summary-v1" as const;

/** D-44: every item says what kind of evidence it is. */
export const EVIDENCE_KINDS = ["observed", "imported", "declared"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/**
 * Sources shown as a paste (P-02). Only `paste`: a `drop` can be a move of
 * the writer's own text inside the document, and `unattributed` is never a
 * paste (#384, owner question 3 is open; changing this list is the only edit).
 */
export const PASTE_SOURCES: readonly EvidenceSourceV2[] = ["paste"];

/** Faculty thresholds (P-01, P-02); configuration, never literals (PRODUCT §5 rule 12). */
export type ProcessSummaryThresholds = {
  /** P-01: a pause longer than this many minutes ends a session. */
  sessionBreakAboveMinutes: number;
  /** P-02: a paste with more characters than this is listed on its own. */
  pasteListedAboveCharacters: number;
};

export type ProcessSummaryInput = {
  /** Stored segments of one package, in chain order, as accepted. */
  payloads: readonly (string | Uint8Array)[];
  /** The head the server recorded for the package, `null` when empty. */
  head: EvidenceChainHeadV2 | null;
  thresholds: ProcessSummaryThresholds;
};

/** Two whole minutes in UTC, as the segment carries them (D-24). */
export type MinuteSpan = { from: string; to: string };

export type ProcessSummaryV1 = {
  summaryFormat: typeof PROCESS_SUMMARY_FORMAT_V1;
  sessions: {
    evidenceKind: "observed";
    breakAboveMinutes: number;
    count: number;
    items: MinuteSpan[];
  };
  pastes: {
    evidenceKind: "observed";
    listedAboveCharacters: number;
    listed: { at: MinuteSpan; characters: number; origin: "not_observed" }[];
    smallerCount: number;
  };
  gaps: {
    evidenceKind: "observed";
    items: { previousEndedAt: string; nextStartedAt: string }[];
  };
  recordState: "complete" | "has_gaps";
};

export type ProcessSummaryResult =
  | { ok: true; summary: ProcessSummaryV1 }
  | { ok: false; reason: EvidenceChainFailureV2 };

const INPUT_KEYS = new Set(["payloads", "head", "thresholds"]);
const THRESHOLD_KEYS = new Set(["sessionBreakAboveMinutes", "pasteListedAboveCharacters"]);
const MINUTE_MS = 60_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  const own = Object.keys(value);
  return own.length === keys.size && own.every((key) => keys.has(key));
}

/**
 * An unknown input field is a caller bug and throws: a field that names who
 * asks, or a switch for raw data, must not be silently accepted.
 */
function assertInput(input: unknown): asserts input is ProcessSummaryInput {
  if (!isPlainObject(input) || !hasExactKeys(input, INPUT_KEYS)) {
    throw new Error("process-summary: input must have exactly payloads, head and thresholds");
  }
  if (!Array.isArray(input.payloads)) {
    throw new Error("process-summary: payloads must be an array");
  }
  const thresholds = input.thresholds;
  if (
    !isPlainObject(thresholds) ||
    !hasExactKeys(thresholds, THRESHOLD_KEYS) ||
    !Number.isSafeInteger(thresholds.sessionBreakAboveMinutes) ||
    Number(thresholds.sessionBreakAboveMinutes) < 1 ||
    !Number.isSafeInteger(thresholds.pasteListedAboveCharacters) ||
    Number(thresholds.pasteListedAboveCharacters) < 0
  ) {
    throw new Error("process-summary: invalid thresholds");
  }
}

/**
 * Characters a step inserts, counted in Unicode code points: not bytes and
 * not UTF-16 units, so "č" and an emoji are one each. A combining mark is a
 * code point of its own. Block boundaries are not characters.
 */
function insertedCharacters(steps: readonly unknown[]): number {
  let count = 0;
  for (const step of steps as readonly EditStepV1[]) {
    if (step.stepType !== "replace" && step.stepType !== "replaceAround") continue;
    for (const node of step.slice?.content ?? []) {
      const texts = node.type === "text" ? [node] : (node.content ?? []);
      for (const text of texts) count += [...text.text].length;
    }
  }
  return count;
}

function span(segment: EvidenceSegmentV2): MinuteSpan {
  return { from: segment.observedStartedAt, to: segment.observedEndedAt };
}

/**
 * Sessions by P-01 from the minutes of the segments, never from the client's
 * `sessionId`. A segment joins the current session when the distance between
 * their spans is at most the threshold; a pause of exactly the threshold does
 * not end a session (PRODUCT §7: "prekida duljeg od praga"). Spans are only
 * widened, so a clock that moves back cannot make a negative duration, and
 * overlapping segments of two tabs are one session, not two.
 */
function sessionsOf(segments: readonly EvidenceSegmentV2[], breakAboveMinutes: number): MinuteSpan[] {
  const breakMs = breakAboveMinutes * MINUTE_MS;
  const sessions: { start: number; end: number }[] = [];
  for (const segment of segments) {
    const start = Date.parse(segment.observedStartedAt);
    const end = Date.parse(segment.observedEndedAt);
    const current = sessions.at(-1);
    const distance = current ? Math.max(0, start - current.end, current.start - end) : Infinity;
    if (current && distance <= breakMs) {
      current.start = Math.min(current.start, start);
      current.end = Math.max(current.end, end);
    } else {
      sessions.push({ start, end });
    }
  }
  return sessions.map(({ start, end }) => ({
    from: new Date(start).toISOString(),
    to: new Date(end).toISOString(),
  }));
}

/**
 * Builds the process summary of one package. Deterministic: the same input
 * gives the same output, and nothing outside the input is read.
 */
export async function projectProcessSummary(input: ProcessSummaryInput): Promise<ProcessSummaryResult> {
  assertInput(input);
  const { sessionBreakAboveMinutes, pasteListedAboveCharacters } = input.thresholds;
  // Own copies, so the bytes that are verified are the bytes that are read.
  const payloads = input.payloads.map((payload) =>
    payload instanceof Uint8Array ? new Uint8Array(payload) : payload,
  );

  const chain = await verifyEvidenceChainV2(payloads, input.head);
  if (!chain.ok) return { ok: false, reason: chain.reason };

  const segments: EvidenceSegmentV2[] = [];
  for (const payload of payloads) {
    const verified = await verifyCanonicalEvidencePayloadV2(payload);
    if (!verified.ok) throw new Error("process-summary: verified payload no longer verifies");
    segments.push(verified.segment);
  }

  const listed: ProcessSummaryV1["pastes"]["listed"] = [];
  let smallerCount = 0;
  for (const segment of segments) {
    for (const event of segment.events) {
      if (!PASTE_SOURCES.includes(event.source)) continue;
      const characters = insertedCharacters(event.steps);
      if (characters > pasteListedAboveCharacters) {
        listed.push({ at: span(segment), characters, origin: "not_observed" });
      } else {
        smallerCount += 1;
      }
    }
  }

  const gapItems = chain.discontinuities.map(({ index }) => ({
    previousEndedAt: segments[index - 1].observedEndedAt,
    nextStartedAt: segments[index].observedStartedAt,
  }));

  const sessionItems = sessionsOf(segments, sessionBreakAboveMinutes);
  return {
    ok: true,
    summary: {
      summaryFormat: PROCESS_SUMMARY_FORMAT_V1,
      sessions: {
        evidenceKind: "observed",
        breakAboveMinutes: sessionBreakAboveMinutes,
        count: sessionItems.length,
        items: sessionItems,
      },
      pastes: {
        evidenceKind: "observed",
        listedAboveCharacters: pasteListedAboveCharacters,
        listed,
        smallerCount,
      },
      gaps: { evidenceKind: "observed", items: gapItems },
      recordState: gapItems.length === 0 ? "complete" : "has_gaps",
    },
  };
}
