// DAN-310 (M2.4-P02): a new version of a published assignment. The browser
// sends the content and the version it was read from; the route and the RPC
// decide who may, refuse a widening (PRODUCT rule 14) and a stale version
// (409). Here the same rules only decide what the form offers and says.
import { AI_PURPOSES, parseWordRange, type AiPurpose } from "./assignment-create";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** The version now in force, as the server read it. */
export interface CurrentVersion {
  assignmentId: string;
  versionNo: number;
  title: string;
  instructions: string;
  workType: string;
  evidenceProfile: "basic" | "extended";
  importAllowed: boolean;
  opensAt: string;
  dueAt: string;
  aiPolicy: string;
  aiPurposes: AiPurpose[];
  wordMin: number | null;
  wordMax: number | null;
}

/** The form's text; times as `datetime-local` on the teacher's own clock. */
export interface VersionDraft {
  title: string;
  instructions: string;
  opensAt: string;
  dueAt: string;
  aiPurposes: AiPurpose[];
  wordMin: string;
  wordMax: string;
}

export interface VersionContent {
  title: string;
  instructions: string;
  workType: string;
  opensAt: string;
  dueAt: string;
  aiPolicy: string;
  aiPurposes: AiPurpose[];
  evidenceProfile: "basic" | "extended";
  importAllowed: boolean;
  wordMin: number | null;
  wordMax: number | null;
}

export type VersionBody = VersionContent & { expectedVersion: number };

export type ChangedField = "title" | "instructions" | "opensAt" | "dueAt" | "aiPurposes" | "wordRange";

export type VersionCheck =
  | { kind: "ready"; body: VersionBody; changes: ChangedField[] }
  | { kind: "invalid" | "widening" | "unchanged" };

export type VersionPublish =
  | { kind: "published"; versionNo: number }
  | { kind: "invalid" | "unauthorized" | "forbidden" | "conflict" | "unavailable" };

const pad = (n: number) => String(n).padStart(2, "0");

/** An instant as `datetime-local` text on this device's clock, to the minute. */
export function localMinute(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function draftOf(current: CurrentVersion): VersionDraft {
  return {
    title: current.title,
    instructions: current.instructions,
    opensAt: localMinute(current.opensAt),
    dueAt: localMinute(current.dueAt),
    aiPurposes: [...current.aiPurposes],
    wordMin: current.wordMin === null ? "" : String(current.wordMin),
    wordMax: current.wordMax === null ? "" : String(current.wordMax),
  };
}

/** An untouched time keeps the stored instant, seconds and all; an edited one is read on this clock. */
function instant(local: string, stored: string): string | null {
  if (local === localMinute(stored)) return stored;
  if (!LOCAL_MINUTE.test(local)) return null;
  const at = new Date(local);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** Rule 14: a bound may be dropped or relaxed, never added or tightened (as the RPC). */
export function widensWords(current: CurrentVersion, wordMin: number | null, wordMax: number | null): boolean {
  return (wordMin !== null && (current.wordMin === null || wordMin > current.wordMin))
    || (wordMax !== null && (current.wordMax === null || wordMax < current.wordMax));
}

/**
 * The body of the next version, or why there is none. Work type, evidence
 * profile and import travel unchanged: the form has no field for them. A
 * purpose the current version does not allow is never sent, and with none
 * left the version prohibits use; otherwise it keeps the current rule.
 */
export function checkVersion(current: CurrentVersion, draft: VersionDraft): VersionCheck {
  const title = draft.title.trim();
  const opensAt = instant(draft.opensAt, current.opensAt);
  const dueAt = instant(draft.dueAt, current.dueAt);
  const range = parseWordRange(draft.wordMin, draft.wordMax);
  if (!title || Array.from(title).length > 200 || Array.from(draft.instructions).length > 20_000) return { kind: "invalid" };
  if (!opensAt || !dueAt || Date.parse(dueAt) <= Date.parse(opensAt) || !range) return { kind: "invalid" };
  if (widensWords(current, range.wordMin, range.wordMax)) return { kind: "widening" };
  const aiPurposes = AI_PURPOSES.filter((p) => draft.aiPurposes.includes(p) && current.aiPurposes.includes(p));
  const body: VersionBody = {
    expectedVersion: current.versionNo,
    title,
    instructions: draft.instructions,
    workType: current.workType,
    opensAt,
    dueAt,
    aiPolicy: aiPurposes.length === 0 ? "prohibited" : current.aiPolicy,
    aiPurposes,
    evidenceProfile: current.evidenceProfile,
    importAllowed: current.importAllowed,
    wordMin: range.wordMin,
    wordMax: range.wordMax,
  };
  const changes = changedFields(current, body);
  return changes.length === 0 ? { kind: "unchanged" } : { kind: "ready", body, changes };
}

export function changedFields(current: CurrentVersion, next: VersionContent): ChangedField[] {
  const changes: ChangedField[] = [];
  if (next.title !== current.title) changes.push("title");
  if (next.instructions !== current.instructions) changes.push("instructions");
  if (Date.parse(next.opensAt) !== Date.parse(current.opensAt)) changes.push("opensAt");
  if (Date.parse(next.dueAt) !== Date.parse(current.dueAt)) changes.push("dueAt");
  if (next.aiPurposes.join() !== current.aiPurposes.join() || next.aiPolicy !== current.aiPolicy) changes.push("aiPurposes");
  if (next.wordMin !== current.wordMin || next.wordMax !== current.wordMax) changes.push("wordRange");
  return changes;
}

/** Success only on 201 with the next version number; the server's text is never shown. */
export async function publishVersion(
  assignmentId: string, body: VersionBody, send: typeof fetch = fetch,
): Promise<VersionPublish> {
  if (!UUID.test(assignmentId)) return { kind: "invalid" };
  try {
    const response = await send(`/api/institution/assignments/${assignmentId}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      body: JSON.stringify(body),
    });
    if (response.status === 401) return { kind: "unauthorized" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 409) return { kind: "conflict" };
    if ([400, 413, 415, 422].includes(response.status)) return { kind: "invalid" };
    if (response.status !== 201) return { kind: "unavailable" };
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("versionNo" in data) || data.versionNo !== body.expectedVersion + 1) {
      return { kind: "unavailable" };
    }
    return { kind: "published", versionNo: body.expectedVersion + 1 };
  } catch {
    return { kind: "unavailable" };
  }
}
