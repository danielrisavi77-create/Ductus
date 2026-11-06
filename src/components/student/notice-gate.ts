// F-7 (#336, C-3): the student's acknowledgment of the S3 notice is the only
// request the notice screen makes, and only after an explicit confirmation
// of a ticked box. Until the server returns its time, `mayRecord` is false:
// no evidence for this assignment may leave the browser before it.
//
// DAN-306 (#1502 B1): the request carries the fingerprint of the notice this
// screen showed, computed here with the template version of this bundle. The
// server records the acknowledgment only if its own fingerprint of the
// stored version is the same, so a student never confirms a text they did
// not see.
import { NOTICE_TEMPLATE_VERSION, noticeFingerprint, type NoticeFingerprintInput } from "@/domain/notice/fingerprint";

export type AckError = "stale" | "unauthorized" | "forbidden" | "invalid" | "unavailable";

export type Acknowledgment = { kind: "acknowledged"; at: string } | { kind: AckError };

export type NoticeState =
  | { phase: "reading"; checked: boolean; error?: AckError }
  | { phase: "sending" }
  | { phase: "acknowledged"; at: string };

export type NoticeEvent =
  | { type: "toggle" }
  | { type: "confirm" }
  | { type: "settled"; result: Acknowledgment };

/** The next state, and whether this step sends the acknowledgment. */
export function noticeStep(state: NoticeState, event: NoticeEvent): { state: NoticeState; send: boolean } {
  if (state.phase === "reading" && event.type === "toggle") {
    return { state: { phase: "reading", checked: !state.checked }, send: false };
  }
  if (state.phase === "reading" && event.type === "confirm" && state.checked) {
    return { state: { phase: "sending" }, send: true };
  }
  if (state.phase === "sending" && event.type === "settled") {
    const { result } = event;
    return result.kind === "acknowledged"
      ? { state: { phase: "acknowledged", at: result.at }, send: false }
      : { state: { phase: "reading", checked: true, error: result.kind }, send: false };
  }
  return { state, send: false };
}

export function initialNotice(acknowledgedAt: string | null): NoticeState {
  return acknowledgedAt ? { phase: "acknowledged", at: acknowledgedAt } : { phase: "reading", checked: false };
}

/** The gate for any evidence transport of this assignment. */
export function mayRecord(state: NoticeState): boolean {
  return state.phase === "acknowledged";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

// A shape match is not enough: Date.parse rolls 2026-02-31 over into March.
function isInstant(value: string): boolean {
  const ms = Date.parse(value);
  return ISO.test(value) && !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19);
}

/** The notice as the screen shows it: the version and every field that enters its fingerprint. */
export type ShownNotice = Omit<NoticeFingerprintInput, "templateVersion"> & { assignmentId: string; versionNo: number };

/**
 * Success only for HTTP 200 with a server time; server error bodies are
 * ignored. Both answers 409 (another version, or the notice changed under the
 * same version) are `stale`: either way the screen holds an old text.
 */
export async function acknowledgeNotice(notice: ShownNotice, send: typeof fetch = fetch): Promise<Acknowledgment> {
  const { assignmentId, versionNo } = notice;
  if (!UUID.test(assignmentId) || !Number.isInteger(versionNo) || versionNo < 1) return { kind: "invalid" };
  try {
    // Only the fields of the fingerprint, so that nothing else of the view
    // can change it. Without Web Crypto it fails and nothing is sent.
    const fingerprint = await noticeFingerprint({
      templateVersion: NOTICE_TEMPLATE_VERSION,
      title: notice.title,
      instructions: notice.instructions,
      workType: notice.workType,
      opensAt: notice.opensAt,
      dueAt: notice.dueAt,
      aiPolicy: notice.aiPolicy,
      aiPurposes: notice.aiPurposes,
      evidenceProfile: notice.evidenceProfile,
      wordMin: notice.wordMin,
      wordMax: notice.wordMax,
    });
    const response = await send(`/api/institution/assignments/${assignmentId}/acknowledgment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      body: JSON.stringify({ versionNo, fingerprint }),
    });
    if (response.status === 401) return { kind: "unauthorized" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 409) return { kind: "stale" };
    if ([400, 413, 415, 422].includes(response.status)) return { kind: "invalid" };
    if (response.status !== 200) return { kind: "unavailable" };
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data) || !("acknowledgedAt" in data) ||
        typeof data.acknowledgedAt !== "string" || !isInstant(data.acknowledgedAt)) {
      return { kind: "unavailable" };
    }
    return { kind: "acknowledged", at: data.acknowledgedAt };
  } catch {
    return { kind: "unavailable" };
  }
}
