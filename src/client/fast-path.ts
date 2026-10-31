/**
 * The browser side of the teacher's fast path (F-11; route: B-11c,
 * POST /api/teacher/fast-path; contract #757 and its F-11 comment). The body
 * names the assignment and nothing else: who asks comes only from the
 * session cookie.
 *
 * A 200 body is shown only when it is exactly the shape of #757: every
 * object has exactly its keys, the work state is one of three, a time is a
 * whole UTC minute and the summary passes `parseProcessSummaryV1`. Anything
 * else, including a revision or declaration field the demo must not show
 * (#757 O2, O3), is `unavailable` for the whole answer, never shown in part.
 *
 * Timing (PLAN-DEMO B-11, P-03): the next request starts no sooner than
 * P-03 after the start of the previous one, whatever happens in between: a
 * slow answer, a failure, a hidden tab. There is no faster retry.
 */

import { TEXT_BLOCK_KINDS, type FastPathLoad, type FastPathRecord, type FastPathStudent, type WorkState } from "@/components/teacher/fast-path";
import { isEvidenceMinuteV2 } from "@/domain/forensics/evidence-segment-v2";

import { parseProcessSummaryV1 } from "./process-summary";
import type { VisibilitySource } from "./live-reader";

/** P-03 (docs/DECISIONS.md): at most one new state per five minutes. The route holds it too (#757 D3). */
export const FAST_PATH_REFRESH_MS = 300_000;

export type FastPathRead = { kind: "ok"; students: FastPathStudent[] } | { kind: "signedOut" | "unavailable" };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function exactly(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

const WORK: readonly WorkState[] = ["notice_pending", "writing", "submitted"];

function record(value: unknown): FastPathRecord | null {
  if (!exactly(value, ["pastesWithoutSource", "blocks", "summary"])) return null;
  const { pastesWithoutSource: pastes, blocks } = value;
  if (typeof pastes !== "number" || !Number.isSafeInteger(pastes) || pastes < 0 || !Array.isArray(blocks)) return null;
  const checked = blocks.every((b) => exactly(b, ["kind", "text"])
    && (TEXT_BLOCK_KINDS as readonly unknown[]).includes(b.kind) && typeof b.text === "string");
  const summary = parseProcessSummaryV1(value.summary);
  if (!checked || summary === null) return null;
  return { pastesWithoutSource: pastes, blocks: blocks as FastPathRecord["blocks"], summary };
}

function student(value: unknown): FastPathStudent | null {
  if (!exactly(value, ["id", "givenName", "surname", "work", "lastChangeAt", "record"])) return null;
  const { id, givenName, surname, work, lastChangeAt } = value;
  if (typeof id !== "string" || id === "" || !WORK.includes(work as WorkState)) return null;
  // D1: a name is a pair; either both parts are there or neither.
  const named = typeof givenName === "string" && typeof surname === "string" && givenName !== "" && surname !== "";
  if (!named && !(givenName === null && surname === null)) return null;
  if (lastChangeAt !== null && !isEvidenceMinuteV2(lastChangeAt)) return null;
  // Before the notice is confirmed there is no record (#757).
  const checked = value.record === null ? null : record(value.record);
  if ((value.record !== null && checked === null) || (work === "notice_pending" && checked !== null)) return null;
  return { id, givenName: givenName as string | null, surname: surname as string | null, work: work as WorkState, lastChangeAt, record: checked };
}

/** The students when `value` is exactly the fast path answer, otherwise null. */
export function parseFastPath(value: unknown): FastPathStudent[] | null {
  if (!exactly(value, ["kind", "students"]) || value.kind !== "ok" || !Array.isArray(value.students)) return null;
  const out: FastPathStudent[] = [];
  const ids = new Set<string>();
  for (const entry of value.students) {
    const checked = student(entry);
    if (checked === null || ids.has(checked.id)) return null;
    ids.add(checked.id);
    out.push(checked);
  }
  return out;
}

/**
 * One read of the works of `assignmentId`. `current()` is asked right before
 * the request: once the session has ended in this browser nothing is sent (F-093).
 */
export async function fetchFastPath(
  assignmentId: string,
  current: () => boolean = () => true,
  fetcher: typeof fetch = fetch,
): Promise<FastPathRead> {
  if (!current()) return { kind: "signedOut" };
  let response: Response;
  try {
    response = await fetcher("/api/teacher/fast-path", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assignmentId }),
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (response.status === 401) return { kind: "signedOut" };
  if (response.status !== 200) return { kind: "unavailable" };
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer()));
  } catch {
    return { kind: "unavailable" };
  }
  const students = parseFastPath(value);
  return students === null ? { kind: "unavailable" } : { kind: "ok", students };
}

export type FastPathReaderOptions = {
  readonly assignmentId: string;
  readonly onChange: (load: FastPathLoad) => void;
  readonly current?: () => boolean;
  readonly fetcher?: typeof fetch;
  readonly visibility?: VisibilitySource;
  readonly now?: () => number;
  readonly timers?: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };
};

const documentVisibility: VisibilitySource = {
  isVisible: () => document.visibilityState === "visible",
  subscribe(onChange) {
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  },
};

const windowTimers = {
  set: (run: () => void, ms: number): unknown => setTimeout(run, ms),
  clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Reads now and then at most once per P-03; returns the function that stops it for good. */
export function startFastPathReader(options: FastPathReaderOptions): () => void {
  const current = options.current ?? (() => true);
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const visibility = options.visibility ?? documentVisibility;
  const timers = options.timers ?? windowTimers;
  const now = options.now ?? Date.now;

  let load: FastPathLoad = { state: "loading" };
  let stopped = false;
  let inFlight = false;
  let lastStart: number | null = null;
  let timer: unknown = null;

  const publish = (next: FastPathLoad) => {
    load = next;
    options.onChange(load);
  };

  // Always measured from the start of the last request, so nothing in between can bring it forward.
  const scheduleNext = () => {
    if (stopped || inFlight || load.state === "signedOut") return;
    if (timer !== null) timers.clear(timer);
    const wait = lastStart === null ? 0 : Math.max(0, lastStart + FAST_PATH_REFRESH_MS - now());
    timer = timers.set(() => {
      timer = null;
      void tick();
    }, wait);
  };

  async function tick(): Promise<void> {
    if (stopped || inFlight || load.state === "signedOut") return;
    // A hidden tab sends nothing; becoming visible schedules the rest of the wait.
    if (!visibility.isVisible()) return;
    if (lastStart !== null && now() - lastStart < FAST_PATH_REFRESH_MS) return scheduleNext();
    if (!current()) return publish({ state: "signedOut" });
    inFlight = true;
    lastStart = now();
    const read = await fetchFastPath(options.assignmentId, current, fetcher);
    inFlight = false;
    if (stopped) return;
    if (read.kind === "signedOut") return publish({ state: "signedOut" });
    if (read.kind === "ok") publish({ state: "ready", students: read.students, stale: false });
    // A failed refresh keeps the last accepted state and says it is not fresh.
    else publish(load.state === "ready" ? { ...load, stale: true } : { state: "unavailable" });
    scheduleNext();
  }

  const unsubscribe = visibility.subscribe(() => {
    if (visibility.isVisible()) scheduleNext();
  });
  void tick();

  return () => {
    stopped = true;
    unsubscribe();
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
}
