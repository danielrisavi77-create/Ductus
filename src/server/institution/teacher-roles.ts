import type { WithActor } from "@/server/db/with-actor";

/**
 * DAN-581 (M2.11-P02, screen A-02; contract on #1091, comment 6674850230):
 * the teacher roles of an institution for its administrator. One read of
 * institution.teacher_roles(): the caller and the institution come only from
 * the session token bound into withActor. Only a confirmed, unrevoked
 * administrator gets an answer; anyone else gets notFound. Two lists: those
 * whom confirm_teacher_role would confirm (with the time of an earlier
 * revocation) and the confirmed teachers (with the time of confirmation and
 * the P7 mark, D-200). No time of the last login is read or returned. Any row
 * that is not what the function returns makes the whole read unavailable.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const NAME_MAX = 255;

export type PersonName = { givenName: string; familyName: string } | null;

export type PendingTeacherRow = {
  personId: string;
  name: PersonName;
  /** The latest earlier revocation of this person's teacher role, if any. */
  revokedAt: string | null;
};

export type ConfirmedTeacherRow = {
  personId: string;
  name: PersonName;
  confirmedAt: string;
  /** P7 (D-200): no current teacher right recorded at the last login. */
  forReview: boolean;
};

export type TeacherRoles = { pending: PendingTeacherRow[]; confirmed: ConfirmedTeacherRow[] };

export type TeacherRolesRead =
  | ({ kind: "ok" } & TeacherRoles)
  | { kind: "unauthorized" | "notFound" | "unavailable" };

type Row = Record<string, unknown>;

const QUERY = `SELECT user_id::text, list, given_name, family_name, confirmed_at, revoked_at, for_review
  FROM institution.teacher_roles()`;

function codeOf(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" ? code : undefined;
}

function isName(value: unknown): value is string {
  // Code points, as length() in the database counts (F-149).
  return typeof value === "string" && value.length >= 1 && [...value].length <= NAME_MAX && !CONTROL.test(value);
}

/** The name pair, null for no name, undefined for a half or malformed pair. */
function nameOf(given: unknown, family: unknown): PersonName | undefined {
  if (given === null && family === null) return null;
  if (isName(given) && isName(family)) return { givenName: given, familyName: family };
  return undefined;
}

function instant(value: unknown): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

const collator = new Intl.Collator("hr");

/** Surname, then given name (Croatian collation), then id; people without a name last, by id. */
export function compareByName(a: { personId: string; name: PersonName }, b: { personId: string; name: PersonName }): number {
  const byId = a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0;
  if (a.name === null || b.name === null) return a.name === b.name ? byId : a.name === null ? 1 : -1;
  return collator.compare(a.name.familyName, b.name.familyName)
    || collator.compare(a.name.givenName, b.name.givenName) || byId;
}

/** The rows as the two lists, or null when any row is not what the function returns. */
export function teacherRolesOf(rows: readonly Row[]): TeacherRoles | null {
  const pending: PendingTeacherRow[] = [];
  const confirmed: ConfirmedTeacherRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const { user_id: personId, list } = row;
    if (typeof personId !== "string" || !UUID.test(personId) || seen.has(personId)) return null;
    seen.add(personId);
    const name = nameOf(row.given_name, row.family_name);
    if (name === undefined) return null;
    if (list === "candidate") {
      if (row.confirmed_at !== null || row.for_review !== null) return null;
      const revokedAt = row.revoked_at === null ? null : instant(row.revoked_at);
      if (revokedAt === null && row.revoked_at !== null) return null;
      pending.push({ personId, name, revokedAt });
    } else if (list === "confirmed") {
      const confirmedAt = instant(row.confirmed_at);
      if (confirmedAt === null || row.revoked_at !== null || typeof row.for_review !== "boolean") return null;
      confirmed.push({ personId, name, confirmedAt, forReview: row.for_review });
    } else {
      return null;
    }
  }
  return { pending: pending.sort(compareByName), confirmed: confirmed.sort(compareByName) };
}

export async function readTeacherRoles(sessionToken: string | undefined, withActor: WithActor): Promise<TeacherRolesRead> {
  if (sessionToken === undefined || !TOKEN.test(sessionToken)) return { kind: "unauthorized" };
  let rows: Row[];
  try {
    rows = await withActor(sessionToken, async (tx) => (await tx.query<Row>(QUERY)).rows);
  } catch (error) {
    const code = codeOf(error);
    if (code === "ZD401") return { kind: "unauthorized" };
    if (code === "ZD403") return { kind: "notFound" };
    console.error("teacher roles read failed", code !== undefined && SQLSTATE.test(code) ? code : "unknown");
    return { kind: "unavailable" };
  }
  const roles = teacherRolesOf(rows);
  if (roles === null) {
    console.error("teacher roles read failed", "row_malformed");
    return { kind: "unavailable" };
  }
  return { kind: "ok", ...roles };
}
