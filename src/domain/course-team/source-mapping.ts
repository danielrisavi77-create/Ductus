/**
 * Synthetic contract for mapping teaching-team source data into candidates
 * (DAN-351, M2.7-P05; ISVU adapter is a separate ticket, D-205 t. 2). The
 * format `ductus-teaching-team-source-v0` is invented: it is not the format
 * of any real source system.
 *
 * Pure: nothing is written, nothing is merged. Every candidate needs an
 * administrator's confirmation through the existing RPCs (#1302). A person
 * matches an account only by the exact (issuer, uniqueId) pair; the format
 * carries no name, so nothing can match on one (D-104).
 */

export const TEACHING_TEAM_SOURCE_FORMAT_V0 = "ductus-teaching-team-source-v0";
export const TEACHING_TEAM_SOURCE_MAX_ROWS = 2000;
export const GROUP_NAME_MAX_LENGTH = 120;

export type TeachingTeamRole = "holder" | "group_teacher";

export interface TeachingTeamSourceRowV0 {
  readonly courseKey: string;
  readonly role: TeachingTeamRole;
  readonly groupName?: string;
  readonly issuer: string;
  readonly uniqueId: string;
}

export interface TeachingTeamMappingContext {
  readonly institutionKey: string;
  /** The only issuer whose identifiers can match an account. */
  readonly issuer: string;
  /** Source course key → course id of the actor's institution. */
  readonly courses: ReadonlyMap<string, string>;
  /** Exact uniqueId under `issuer` → account id. */
  readonly accounts: ReadonlyMap<string, string>;
}

export type TeachingTeamCandidate =
  | { readonly kind: "course_holder"; readonly courseId: string; readonly accountId: string; readonly confirmation: "required" }
  | {
      readonly kind: "group_teacher";
      readonly courseId: string;
      readonly groupName: string;
      readonly accountId: string;
      readonly confirmation: "required";
    };

export type TeachingTeamIssueCode =
  | "unknown_course"
  | "unknown_account"
  | "foreign_issuer"
  | "holder_conflict"
  | "duplicate"
  | "invalid_group_name";

export interface TeachingTeamIssue {
  readonly row: number;
  readonly code: TeachingTeamIssueCode;
}

export type TeachingTeamMappingResult =
  | { readonly ok: true; readonly candidates: readonly TeachingTeamCandidate[]; readonly issues: readonly TeachingTeamIssue[] }
  | { readonly ok: false; readonly reason: "invalid_input" | "wrong_institution" | "too_many_rows" };

const TOP_KEYS = ["format", "institutionKey", "rows"];
const ROW_KEYS = ["courseKey", "role", "groupName", "issuer", "uniqueId"];
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Only own, enumerable data properties from `allowed`, all `required` present. */
function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean {
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  for (const key of Object.getOwnPropertyNames(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!allowed.includes(key) || !d || !d.enumerable || !("value" in d)) return false;
  }
  return required.every((key) => Object.hasOwn(value, key));
}

/**
 * Values of a plain array read from its own data descriptors, so no accessor
 * runs: `Array.prototype`, no own symbols (so no own iterator), no holes and
 * no names other than `length` and the indices. Otherwise null.
 */
function plainArrayValues(value: readonly unknown[], count: number): unknown[] | null {
  if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) return null;
  if (Object.getOwnPropertyNames(value).length !== count + 1) return null;
  const values: unknown[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !d.enumerable || !("value" in d)) return null;
    values.push(d.value);
  }
  return values;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 512;

function parseRow(value: unknown): TeachingTeamSourceRowV0 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ROW_KEYS, ["courseKey", "role", "issuer", "uniqueId"])) return null;
  const { courseKey, role, groupName, issuer, uniqueId } = value;
  if (!isNonEmptyString(courseKey) || !isNonEmptyString(issuer) || !isNonEmptyString(uniqueId)) return null;
  if (role !== "holder" && role !== "group_teacher") return null;
  if (groupName !== undefined && typeof groupName !== "string") return null;
  return { courseKey, role, issuer, uniqueId, ...(groupName === undefined ? {} : { groupName }) };
}

function isValidGroupName(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= GROUP_NAME_MAX_LENGTH &&
    name === name.trim() &&
    name === name.normalize("NFC") &&
    !CONTROL.test(name)
  );
}

const candidateKey = (c: TeachingTeamCandidate): string =>
  JSON.stringify([c.courseId, c.kind, c.kind === "group_teacher" ? c.groupName : "", c.accountId]);

/** Maps the source into candidates and issues; see docs/contracts/teaching-team-source-v0.md. */
export function mapTeachingTeamSource(input: unknown, context: TeachingTeamMappingContext): TeachingTeamMappingResult {
  if (!isPlainRecord(input) || !hasExactKeys(input, TOP_KEYS, TOP_KEYS)) return { ok: false, reason: "invalid_input" };
  if (input.format !== TEACHING_TEAM_SOURCE_FORMAT_V0 || !Array.isArray(input.rows)) {
    return { ok: false, reason: "invalid_input" };
  }
  if (input.institutionKey !== context.institutionKey) return { ok: false, reason: "wrong_institution" };
  const rawRows: readonly unknown[] = input.rows;
  // The bound comes from `length`; rows are read by index, never by an iterator.
  const count = rawRows.length;
  if (count > TEACHING_TEAM_SOURCE_MAX_ROWS) return { ok: false, reason: "too_many_rows" };
  const rawValues = plainArrayValues(rawRows, count);
  if (!rawValues) return { ok: false, reason: "invalid_input" };

  const rows: TeachingTeamSourceRowV0[] = [];
  for (const raw of rawValues) {
    const row = parseRow(raw);
    if (!row) return { ok: false, reason: "invalid_input" };
    rows.push(row);
  }

  const issues: TeachingTeamIssue[] = [];
  const resolved: { row: number; candidate: TeachingTeamCandidate }[] = [];
  // R5: holders per course by source identity (issuer, uniqueId), counted
  // before R7, unknown accounts and foreign issuers drop a row.
  const holderRows: { row: number; courseId: string }[] = [];
  const holders = new Map<string, Set<string>>();
  rows.forEach((row, index) => {
    const courseId = context.courses.get(row.courseKey);
    if (row.role === "holder" && courseId !== undefined) {
      const set = holders.get(courseId) ?? new Set<string>();
      set.add(JSON.stringify([row.issuer, row.uniqueId]));
      holders.set(courseId, set);
      holderRows.push({ row: index, courseId });
    }
    const needsGroup = row.role === "group_teacher";
    if (needsGroup !== (row.groupName !== undefined) || (row.groupName !== undefined && !isValidGroupName(row.groupName))) {
      issues.push({ row: index, code: "invalid_group_name" });
      return;
    }
    if (courseId === undefined) return void issues.push({ row: index, code: "unknown_course" });
    if (row.issuer !== context.issuer) return void issues.push({ row: index, code: "foreign_issuer" });
    const accountId = context.accounts.get(row.uniqueId);
    if (accountId === undefined) return void issues.push({ row: index, code: "unknown_account" });
    const candidate: TeachingTeamCandidate =
      row.groupName === undefined
        ? { kind: "course_holder", courseId, accountId, confirmation: "required" }
        : { kind: "group_teacher", courseId, groupName: row.groupName, accountId, confirmation: "required" };
    resolved.push({ row: index, candidate });
  });

  const inConflict = (courseId: string) => (holders.get(courseId)?.size ?? 0) > 1;
  for (const { row, courseId } of holderRows) {
    if (inConflict(courseId)) issues.push({ row, code: "holder_conflict" });
  }

  const seen = new Map<string, TeachingTeamCandidate>();
  for (const { row, candidate } of resolved) {
    if (candidate.kind === "course_holder" && inConflict(candidate.courseId)) continue;
    const key = candidateKey(candidate);
    if (seen.has(key)) issues.push({ row, code: "duplicate" });
    else seen.set(key, candidate);
  }

  const candidates = [...seen.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, candidate]) => candidate);
  issues.sort((a, b) => a.row - b.row || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return { ok: true, candidates, issues };
}
