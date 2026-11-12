/**
 * DAN-431, M11.10-P01: what a problem report may carry (contract on #1836,
 * c.6788234570). A report is the user's own description plus a closed
 * technical context; no field can hold the text of a work, a paragraph, a
 * title or a journal entry, not even indirectly: every context value is a
 * member of a fixed set or matches a pattern that has no room for words, and
 * any other key is refused (D-69, PRODUCT §5).
 *
 * The same limits are CHECKs on identity.problem_report (migration
 * 20261112110000); the database stays the authority. Lengths are code
 * points, like char_length.
 */
import { SYNC_STATES, type SyncState } from "@/domain/sync/states";

export const PROBLEM_REPORT_DESCRIPTION_MAX = 1000;
/** Reports per user in a sliding hour; the database counts them under a lock. */
export const PROBLEM_REPORT_HOURLY_LIMIT = 5;

/** Who answers (D-69): the maintainer, the AAI administrator, the pilot coordinator. */
export const PROBLEM_REPORT_CATEGORIES = ["technical", "account", "course"] as const;
export type ProblemReportCategory = (typeof PROBLEM_REPORT_CATEGORIES)[number];

export const BROWSER_FAMILIES = ["chromium", "firefox", "safari", "other"] as const;
export type BrowserFamily = (typeof BROWSER_FAMILIES)[number];

/**
 * The page a report was sent from, as its route template: never the path
 * itself, whose segments are ids, and never a query or a hash. The same list
 * is the route CHECK of the migration (problem-report-routes.test.ts).
 */
export const PROBLEM_REPORT_ROUTES = [
  "/",
  "/nastavnik",
  "/nastavnik/brz-put",
  "/nastavnik/kolegiji",
  "/nastavnik/mentorstva",
  "/nastavnik/rad/[id]",
  "/nastavnik/rad/[id]/reprodukcija",
  "/nastavnik/zadatak/[assignmentId]/uredi",
  "/nastavnik/zadatak/novi",
  "/prijava",
  "/rad",
  "/rad/[assignmentId]/predaja",
  "/rad/[assignmentId]/reprodukcija",
  "/upis",
  "/upis/kolegij/[courseId]",
  "/ustanova",
  "/ustanova/kolegiji",
  "/ustanova/korisnici",
  "/ustanova/pravila",
  "/zadaci",
  "/zadaci/kolegiji",
  "/zadaci/radovi",
  "/zadatak/[id]",
] as const;
export type ProblemReportRoute = (typeof PROBLEM_REPORT_ROUTES)[number];

/** The wire keys, sorted; `browser` holds exactly `family` and `major`. */
export const PROBLEM_REPORT_KEYS = ["appVersion", "browser", "category", "description", "route", "syncState"] as const;
const BROWSER_KEYS = ["family", "major"] as const;

export interface ProblemReport {
  category: ProblemReportCategory;
  description: string;
  route: ProblemReportRoute | null;
  appVersion: string;
  browserFamily: BrowserFamily;
  browserMajor: number | null;
  syncState: SyncState | null;
}

// A release (1.2.3, optionally +commit) or a bare commit: digits and hex only.
const APP_VERSION = /^(?:(?:0|[1-9][0-9]{0,3})\.(?:0|[1-9][0-9]{0,3})\.(?:0|[1-9][0-9]{0,3})(?:\+[0-9a-f]{7,40})?|[0-9a-f]{7,40})$/;
const BROWSER_MAJOR_MAX = 999;
// C0, DEL and C1; newline and tab are removed first.
const CONTROL = /\p{Cc}/u;
const BIDI = /[\u202A-\u202E\u2066-\u2069]/u;
// Under /u a surrogate pair is one code point, so this finds only a lone one.
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;
// Anything but White_Space and zero width, as the migration's CHECK.
const VISIBLE =
  /[^\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]/u;

function member<T extends string>(set: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (set as readonly string[]).includes(value);
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Object.keys(value).sort();
  return own.length === keys.length && own.every((key, i) => key === keys[i]);
}

export function isProblemDescription(value: unknown): value is string {
  if (typeof value !== "string" || LONE_SURROGATE.test(value)) return false;
  const length = [...value].length;
  if (length < 1 || length > PROBLEM_REPORT_DESCRIPTION_MAX) return false;
  if (CONTROL.test(value.replace(/[\n\t]/g, "")) || BIDI.test(value)) return false;
  return VISIBLE.test(value);
}

export function isAppVersion(value: unknown): value is string {
  return typeof value === "string" && APP_VERSION.test(value);
}

function browserMajor(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= BROWSER_MAJOR_MAX
    && !Object.is(value, -0)
    ? value
    : undefined;
}

/** The report, or null when any key or value is outside its class. */
export function parseProblemReport(value: unknown): ProblemReport | null {
  if (!exactKeys(value, PROBLEM_REPORT_KEYS)) return null;
  const { appVersion, browser, category, description, route, syncState } = value;
  if (!member(PROBLEM_REPORT_CATEGORIES, category)) return null;
  if (!isProblemDescription(description)) return null;
  if (route !== null && !member(PROBLEM_REPORT_ROUTES, route)) return null;
  if (!isAppVersion(appVersion)) return null;
  if (syncState !== null && !member(SYNC_STATES, syncState)) return null;
  if (!exactKeys(browser, BROWSER_KEYS) || !member(BROWSER_FAMILIES, browser.family)) return null;
  const major = browserMajor(browser.major);
  if (major === undefined) return null;
  return {
    category,
    description,
    route: route as ProblemReportRoute | null,
    appVersion,
    browserFamily: browser.family,
    browserMajor: major,
    syncState: syncState as SyncState | null,
  };
}

/**
 * The route template of a page path, for the client to send instead of the
 * path: a query and a hash are dropped, an id segment becomes its bracket
 * name, and a path that is no known page gives null.
 */
export function problemReportRoute(pathname: string): ProblemReportRoute | null {
  const path = pathname.split(/[?#]/, 1)[0] ?? "";
  if (!path.startsWith("/")) return null;
  const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (member(PROBLEM_REPORT_ROUTES, trimmed)) return trimmed;
  const segments = trimmed.split("/");
  for (const template of PROBLEM_REPORT_ROUTES) {
    const parts = template.split("/");
    if (parts.length !== segments.length) continue;
    const matches = parts.every((part, i) => {
      const segment = segments[i] ?? "";
      return part.startsWith("[") ? segment !== "" : part === segment;
    });
    if (matches) return template;
  }
  return null;
}
