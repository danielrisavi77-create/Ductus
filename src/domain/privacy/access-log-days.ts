import { zagrebWall } from "@/lib/i18n/zagreb";

/**
 * DAN-294 (M10.4, S-42; contract on #1836, c.6814737263): the rows of
 * `app.read_my_access_log` as the student reads them, who opened her work
 * and when, in days of Europe/Zagreb, the newest first (PRODUCT §5 rule 17).
 * Each stored opening is one row of five minutes; rows are never merged and
 * nothing is counted or timed (D-274 MQ10): the model has no total of visits
 * and no duration. A row whose role or surface this code does not know stays
 * in the log, marked unknown, since hiding it would hide an opening. A row
 * that is not what the read returns (an id, a time off the five-minute grid,
 * half a name) fails the whole read rather than being guessed.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WINDOW_MS = 5 * 60_000;
const NAME_MAX = 255;
const ROLES = new Set(["teacher", "mentor", "seminar_teacher"]);
const SURFACES = new Set(["live_view", "process_summary", "fast_path", "replay", "submitted_text"]);

export type AccessLogRole = "teacher" | "mentor" | "seminar_teacher" | "unknown";
export type AccessLogSurface = "live_view" | "process_summary" | "fast_path" | "replay" | "submitted_text" | "unknown";

export interface AccessLogEntry {
  id: string;
  /** Epoch milliseconds of the window's start; for order only, never shown. */
  at: number;
  role: AccessLogRole;
  surface: AccessLogSurface;
  /** Null when the reader has no name pair; never a stand-in. */
  reader: { givenName: string; familyName: string } | null;
}

export interface AccessLogRow {
  id: string;
  /** Epoch milliseconds of the window's start, for an unambiguous `datetime`. */
  at: number;
  /** Zagreb wall clock of the window, `14:10` and `14:15`. */
  from: string;
  to: string;
  role: AccessLogRole;
  surface: AccessLogSurface;
  reader: AccessLogEntry["reader"];
}

export interface AccessLogDay {
  /** Zagreb date, `2026-11-10`. */
  key: string;
  year: number;
  /** 1-based. */
  month: number;
  day: number;
  /** 0 is Sunday. */
  weekday: number;
  entries: AccessLogRow[];
}

type Row = Record<string, unknown>;

function isName(value: unknown): value is string {
  // Code points, as length() in the database counts.
  return typeof value === "string" && value.length >= 1 && [...value].length <= NAME_MAX;
}

const ZONED_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

/**
 * Milliseconds of an ISO instant that names its zone (Z or an offset), else
 * NaN. Date.parse would read a string without a zone in the host's zone.
 */
export function zonedInstantOf(value: string): number {
  return ZONED_INSTANT.test(value) ? Date.parse(value) : Number.NaN;
}

function epochOf(value: unknown): number | null {
  const ms = value instanceof Date ? value.getTime() : typeof value === "string" ? zonedInstantOf(value) : Number.NaN;
  // The writer bins to five minutes (date_bin from 2000-01-01 UTC, a multiple of five minutes since the epoch).
  return Number.isFinite(ms) && ms % WINDOW_MS === 0 ? ms : null;
}

/** One row of the read as an entry, or null when it is not what the read returns. */
export function accessLogEntryOf(row: Row): AccessLogEntry | null {
  const { entry_id: id, reader_role: role, surface } = row;
  if (typeof id !== "string" || !UUID.test(id)) return null;
  const at = epochOf(row.opened_at);
  if (at === null) return null;
  let reader: AccessLogEntry["reader"];
  if (isName(row.reader_given_name) && isName(row.reader_family_name)) {
    reader = { givenName: row.reader_given_name, familyName: row.reader_family_name };
  } else if (row.reader_given_name === null && row.reader_family_name === null) {
    reader = null;
  } else {
    return null;
  }
  return {
    id,
    at,
    role: typeof role === "string" && ROLES.has(role) ? (role as AccessLogRole) : "unknown",
    surface: typeof surface === "string" && SURFACES.has(surface) ? (surface as AccessLogSurface) : "unknown",
    reader,
  };
}

/**
 * The rows of a continuation appended to those already shown. A continuation
 * holds only windows older than the oldest shown, so a row with an id already
 * shown, or one not older, is left out: an opening written after the first
 * page appears on a fresh read, never twice and never in the middle.
 */
export function mergeAccessLogPages(shown: readonly Row[], next: readonly Row[]): Row[] {
  const ids = new Set(shown.map((r) => r.entry_id));
  // A loop, not Math.min(...): a spread of a long page overflows the stack.
  let oldest = Number.POSITIVE_INFINITY;
  for (const r of shown) oldest = Math.min(oldest, epochOf(r.opened_at) ?? Number.POSITIVE_INFINITY);
  return [...shown, ...next.filter((r) => !ids.has(r.entry_id) && (epochOf(r.opened_at) ?? Number.NEGATIVE_INFINITY) < oldest)];
}

const pad2 = (value: number) => String(value).padStart(2, "0");
const clock = (ms: number) => {
  const wall = zagrebWall(ms);
  return `${pad2(wall.hour)}:${pad2(wall.minute)}`;
};

/** The rows as Zagreb days, newest first; null when any row is malformed. A repeated id is shown once. */
export function accessLogDaysOf(rows: readonly Row[]): AccessLogDay[] | null {
  const entries = new Map<string, AccessLogEntry>();
  for (const row of rows) {
    const entry = accessLogEntryOf(row);
    if (entry === null) return null;
    if (!entries.has(entry.id)) entries.set(entry.id, entry);
  }
  const sorted = [...entries.values()].sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const days: AccessLogDay[] = [];
  for (const entry of sorted) {
    const wall = zagrebWall(entry.at);
    const key = `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}`;
    let day = days.at(-1);
    if (day?.key !== key) {
      day = { key, year: wall.year, month: wall.month, day: wall.day,
        weekday: new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay(), entries: [] };
      days.push(day);
    }
    day.entries.push({ id: entry.id, at: entry.at, from: clock(entry.at), to: clock(entry.at + WINDOW_MS),
      role: entry.role, surface: entry.surface, reader: entry.reader });
  }
  return days;
}
