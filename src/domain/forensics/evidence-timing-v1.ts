import { sha256WebCrypto } from "./crypto";
import type { VerifiedEvidencePayloadV2 } from "./evidence-chain-v2";
import { canonicalizeJcs } from "./jcs";

/**
 * `ductus-evidence-timing-v1` (DAN-344 P1, addendum c.6429779006 on #923):
 * when each step of a segment happened, as a record of its own beside the
 * segment. The segment, its hash, the chain, the receipt and its signature
 * stay byte for byte what they are; the timing names its segment by hash.
 *
 * The timing serves only to schedule the replay (D-143). Nothing here, and
 * nothing built on it, computes a speed, a duration, a count per time or a
 * pause with a length (PRODUCT §5 rules 2 and 4).
 *
 * Exact RFC 8785 JCS text in UTF-8:
 * `{"events":[{"sequence":17,"stepOffsetsMs":[0,100,300]}],"segmentHash":"<hex>","timingFormat":"ductus-evidence-timing-v1"}`
 * - one entry per event of the segment, in its order and with its sequence,
 *   and one offset per step of that event;
 * - an offset is whole milliseconds from the segment's `observedStartedAt`
 *   (the start of its minute, D-24), a multiple of 100 (D-56);
 * - offsets never fall across the whole segment, and each is below
 *   `observedEndedAt − observedStartedAt + 60 000`, so within the minutes the
 *   segment already carries; a segment whose minutes are more than one
 *   apart gets no timing (D-24: a segment lasts at most 30 s);
 * - no document, person, session, device or absolute time; any other field
 *   is refused.
 */

export const EVIDENCE_TIMING_FORMAT_V1 = "ductus-evidence-timing-v1";
/** One bound for the client (before it sends) and the server (before it parses). */
export const MAX_EVIDENCE_TIMING_BYTES = 1024 * 1024;
/** Offsets are rounded to this step before they are sent (D-56). */
export const EVIDENCE_TIMING_STEP_MS = 100;

const MINUTE_MS = 60_000;
/**
 * A segment closes within 30 s (D-24; `MAX_SEGMENT_SPAN_MS` in
 * src/editor/capture.ts), so its two minutes are the same or adjacent. A
 * segment that declares a longer span gets no timing: its steps are never
 * spread over more than two minutes, and it replays at a uniform rhythm.
 */
const MAX_TIMED_SEGMENT_SPAN_MS = MINUTE_MS;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type EvidenceTimingEventV1 = { sequence: number; stepOffsetsMs: number[] };

export type EvidenceTimingV1 = {
  timingFormat: typeof EVIDENCE_TIMING_FORMAT_V1;
  segmentHash: string;
  events: EvidenceTimingEventV1[];
};

export type EvidenceTimingFailureV1 =
  | "too_large"
  | "invalid"
  | "not_canonical"
  | "other_segment"
  | "long_segment"
  | "wrong_shape"
  | "wrong_offset";

export type EvidenceTimingVerificationV1 =
  | { ok: true; timing: EvidenceTimingV1; sha256: string; byteLength: number }
  | { ok: false; reason: EvidenceTimingFailureV1 };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** The shape alone, without a segment to hold it to. */
export function isEvidenceTimingV1(value: unknown): value is EvidenceTimingV1 {
  if (!isPlainObject(value) || !hasExactKeys(value, ["events", "segmentHash", "timingFormat"])) return false;
  if (value.timingFormat !== EVIDENCE_TIMING_FORMAT_V1) return false;
  if (typeof value.segmentHash !== "string" || !SHA256_HEX.test(value.segmentHash)) return false;
  if (!Array.isArray(value.events)) return false;
  return value.events.every(
    (event) =>
      isPlainObject(event) &&
      hasExactKeys(event, ["sequence", "stepOffsetsMs"]) &&
      Number.isSafeInteger(event.sequence) &&
      Array.isArray(event.stepOffsetsMs) &&
      event.stepOffsetsMs.every((offset) => Number.isSafeInteger(offset)),
  );
}

/** The exact text a client sends; throws on a value that is not the format. */
export function canonicalEvidenceTimingV1(timing: EvidenceTimingV1): string {
  if (!isEvidenceTimingV1(timing)) throw new Error("evidence-timing-v1: invalid timing");
  return canonicalizeJcs(timing);
}

/**
 * Accepts timing bytes only if they are, byte for byte, the JCS form of this
 * format and fit `segment`: its hash, its events in order with their
 * sequences, one offset per step, and offsets as described above. Pure; used
 * by the server on commit and on read and by the browser before a replay.
 */
export async function verifyEvidenceTimingV1(
  bytes: Uint8Array,
  segment: VerifiedEvidencePayloadV2,
): Promise<EvidenceTimingVerificationV1> {
  if (!(bytes instanceof Uint8Array)) return { ok: false, reason: "invalid" };
  if (!(bytes.byteLength <= MAX_EVIDENCE_TIMING_BYTES)) return { ok: false, reason: "too_large" };
  // Own copy: the bytes checked are the bytes hashed.
  const received = new Uint8Array(bytes);
  let text: string;
  let parsed: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(received);
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!isEvidenceTimingV1(parsed)) return { ok: false, reason: "wrong_shape" };
  if (canonicalizeJcs(parsed) !== text) return { ok: false, reason: "not_canonical" };
  if (parsed.segmentHash !== segment.sha256) return { ok: false, reason: "other_segment" };

  const events = segment.segment.events;
  if (parsed.events.length !== events.length) return { ok: false, reason: "wrong_shape" };
  const declared = Date.parse(segment.segment.observedEndedAt) - Date.parse(segment.segment.observedStartedAt);
  if (!(declared >= 0 && declared <= MAX_TIMED_SEGMENT_SPAN_MS)) return { ok: false, reason: "long_segment" };
  const span = declared + MINUTE_MS;
  let last = 0;
  for (const [index, event] of parsed.events.entries()) {
    if (event.sequence !== events[index].sequence || event.stepOffsetsMs.length !== events[index].steps.length) {
      return { ok: false, reason: "wrong_shape" };
    }
    for (const offset of event.stepOffsetsMs) {
      if (offset < last || offset >= span || offset % EVIDENCE_TIMING_STEP_MS !== 0) {
        return { ok: false, reason: "wrong_offset" };
      }
      last = offset;
    }
  }
  return { ok: true, timing: parsed, sha256: await sha256WebCrypto(text), byteLength: received.byteLength };
}
