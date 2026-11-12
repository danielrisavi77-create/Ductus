/**
 * The browser side of "Prijavi problem" (Z-10, DAN-431): what the form may
 * send, the exact bytes it sends, and how each answer from
 * `POST /api/support/problem-report` (#1919) reads. Pure, so every input
 * class is tested without a browser.
 */
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import {
  PROBLEM_REPORT_DESCRIPTION_MAX,
  isProblemDescription,
  problemReportRoute,
  type BrowserFamily,
  type ProblemReportCategory,
} from "@/domain/support/problem-report";
import type { SyncState } from "@/domain/sync/states";

/** The app's release, sent with each report; no build source exists yet. */
export const APP_VERSION = "0.1.0";

export const PROBLEM_REPORT_ENDPOINT = "/api/support/problem-report";

export type DescriptionCheck = "ok" | "empty" | "tooLong" | "invalid";

/** Length as the server counts it: code points, so 😀 is one. */
export function descriptionLength(text: string): number {
  return [...text].length;
}

// Same as the domain's VISIBLE: anything but White_Space and zero width.
const VISIBLE =
  /[^\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]/u;

/** Why the description cannot be sent yet; "ok" exactly when the server accepts it. */
export function checkDescription(text: string): DescriptionCheck {
  if (isProblemDescription(text)) return "ok";
  if (!/[\uD800-\uDFFF]/u.test(text) && descriptionLength(text) > PROBLEM_REPORT_DESCRIPTION_MAX) return "tooLong";
  if (!VISIBLE.test(text)) return "empty";
  return "invalid";
}

const BROWSER_MAJOR_MAX = 999;

/** Family and major version only; the rest of the user agent stays here. */
export function browserFromUserAgent(userAgent: string): { family: BrowserFamily; major: number | null } {
  const match = (pattern: RegExp): number | null => {
    const major = Number(pattern.exec(userAgent)?.[1]);
    return Number.isInteger(major) && major >= 0 && major <= BROWSER_MAJOR_MAX ? major : null;
  };
  if (/Firefox\/\d/.test(userAgent)) return { family: "firefox", major: match(/Firefox\/(\d+)/) };
  if (/(?:Chrome|Chromium|CriOS)\/\d/.test(userAgent)) {
    return { family: "chromium", major: match(/(?:Chrome|Chromium|CriOS)\/(\d+)/) };
  }
  if (/Safari\/\d/.test(userAgent) && /Version\/\d/.test(userAgent)) {
    return { family: "safari", major: match(/Version\/(\d+)/) };
  }
  return { family: "other", major: null };
}

export type ProblemReportInput = {
  category: ProblemReportCategory;
  description: string;
  pathname: string;
  syncState: SyncState | null;
  userAgent: string;
};

/**
 * The canonical JCS bytes the route accepts, or null for a description
 * outside its class. The page goes as its template, without identifiers.
 */
export function buildProblemReportBody(input: ProblemReportInput): string | null {
  if (checkDescription(input.description) !== "ok") return null;
  return canonicalizeJcs({
    appVersion: APP_VERSION,
    browser: browserFromUserAgent(input.userAgent),
    category: input.category,
    description: input.description,
    route: problemReportRoute(input.pathname),
    syncState: input.syncState,
  });
}

export type FailureReason = "network" | "signedOut" | "tooLarge" | "invalid" | "tooMany" | "unavailable" | "unknown";

export type SendOutcome = { kind: "sent"; reference: string } | { kind: "failed"; reason: FailureReason };

// As the route and the table write it: upper-case hex (#1919).
const REFERENCE = /^PR-[0-9A-F]{10}$/;

const FAILURE_BY_STATUS: Readonly<Record<number, FailureReason>> = {
  401: "signedOut",
  413: "tooLarge",
  422: "invalid",
  429: "tooMany",
  503: "unavailable",
};

/** What a status and its parsed body mean for the person sending. */
export function outcomeFromResponse(status: number, json: unknown): SendOutcome {
  if (status === 201) {
    const reference = (json as { reference?: unknown } | null)?.reference;
    return typeof reference === "string" && REFERENCE.test(reference)
      ? { kind: "sent", reference }
      : { kind: "failed", reason: "unknown" };
  }
  return { kind: "failed", reason: FAILURE_BY_STATUS[status] ?? "unknown" };
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Posts the bytes once; never throws, a lost connection is "network". */
export async function sendProblemReport(body: string, fetcher: Fetcher = fetch): Promise<SendOutcome> {
  let response: Response;
  try {
    response = await fetcher(PROBLEM_REPORT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      credentials: "same-origin",
    });
  } catch {
    return { kind: "failed", reason: "network" };
  }
  const json: unknown = await response.json().catch(() => null);
  return outcomeFromResponse(response.status, json);
}

/**
 * One run at a time: a call while one is in flight gets that same promise
 * (its own arguments unused), so a double click or a resend makes no second
 * request. Once it settles,
 * the next call starts a new run.
 */
export function singleFlight<A extends unknown[], T>(task: (...args: A) => Promise<T>): (...args: A) => Promise<T> {
  let running: Promise<T> | null = null;
  return (...args: A) => {
    if (running) return running;
    const run = task(...args).finally(() => {
      if (running === run) running = null;
    });
    running = run;
    return run;
  };
}
