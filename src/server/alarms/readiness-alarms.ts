import {
  OPS_ALARM_KINDS,
  readinessAlarmTargets,
  type OpsAlarmKind,
  type OpsAlarmTarget,
} from "@/domain/ops/alarm";

/**
 * Where alarms are delivered: the in-app channel, identity.ops_alarm. The
 * store is shared by every replica. resolve answers true when the alarm is
 * closed (or none was open) and false when it stays open because another
 * replica still reports the fault.
 */
export type AlarmStore = {
  raise(kind: OpsAlarmKind): Promise<void>;
  resolve(kind: OpsAlarmKind): Promise<boolean>;
};

/**
 * How often a write that holds in the store is repeated. While this replica
 * sees a fault, its raise is refreshed at most this often, so its fault record
 * (fresh for 120 s in the store) does not go stale and let a healthy replica
 * close the alarm. A resolve the store refused because another replica holds
 * the alarm is tried again at most this often.
 */
export const REFRESH_MS = 30_000;

/** Told the kind and the write that failed, never why: the error stays here. */
export type AlarmStoreError = (op: "raise" | "resolve", kind: OpsAlarmKind) => void;

/**
 * Whether a report says the store can be reached. While it cannot, reports are
 * still remembered but nothing is written, so an outage borrows no connection
 * beyond the readiness probes' own; the owed writes go out on the first report
 * that says the store answers again.
 */
export type StoreReachable = (capabilities: unknown) => boolean;

type KindState = {
  // What the store last confirmed for this replica: "held" is a resolve that
  // was refused because another replica still reports the fault.
  stored: OpsAlarmTarget | "held" | undefined;
  // When stored was last written (this process's clock).
  writtenAt: number;
  wanted: OpsAlarmTarget | undefined;
  // A fault was seen that no stored raise covers yet. It survives an "ok"
  // that comes before the store works again, so an outage that is over by
  // the time the database answers is still written, then resolved.
  owedRaise: boolean;
  // A resolve of this kind is in the store. A fault reported meanwhile is owed
  // too: the resolve was decided before the fault and will not cover it.
  resolving: boolean;
  // A resolve failed, and the store may still have applied it: a COMMIT can
  // succeed and its reply be lost. Until a resolve is confirmed, a raise is
  // preceded by one, so it opens a new episode instead of landing on the old
  // one or on nothing. A repeated resolve changes nothing in the store; a
  // repeated raise lands on the open episode and only counts it again.
  endUnsure: boolean;
};

/**
 * Turns readiness reports into alarm writes for one process (DAN-184). Only
 * transitions are written, plus a refresh of a held fault or a refused resolve
 * at most every REFRESH_MS; a write the store throws on is retried on the next
 * report. Writes run one at a time, and reports that arrive
 * meanwhile join the run in progress, so a store that hangs holds at most one
 * write. State is one fixed entry per kind, so no number of reports grows it.
 * observe() never rejects and never changes what the caller answers. Only the
 * report that starts a run waits for it; one that joins a run, or comes while
 * the store is unreachable, gets a settled promise, so however many reports
 * arrive during a run that does not end, at most one caller waits on it.
 */
export function createAlarmTracker(
  store: AlarmStore,
  onError: AlarmStoreError = () => {},
  reachable: StoreReachable = () => true,
  now: () => number = Date.now,
) {
  const state = new Map<OpsAlarmKind, KindState>(
    OPS_ALARM_KINDS.map((kind) => [
      kind,
      { stored: undefined, writtenAt: 0, wanted: undefined, owedRaise: false, resolving: false, endUnsure: false },
    ]),
  );
  const settled = Promise.resolve();
  let running: Promise<void> | null = null;
  let again = false;
  // What the latest report said of the store. A run in progress checks it
  // before every write, so a report of an outage stops the writes left in it.
  let up = true;

  // null when the write failed; otherwise true, except a resolve the store
  // refused, which is false. Anything but true from resolve counts as refused,
  // so a doubtful answer is tried again rather than taken as closed.
  async function write(op: "raise" | "resolve", kind: OpsAlarmKind): Promise<boolean | null> {
    try {
      if (op === "raise") {
        await store.raise(kind);
        return true;
      }
      return (await store.resolve(kind)) === true;
    } catch {
      try {
        onError(op, kind);
      } catch {
        // The hook is only a report; its failure changes nothing.
      }
      return null;
    }
  }

  // Whether the resolve reached the store, closed or held.
  async function end(kind: OpsAlarmKind, s: KindState): Promise<boolean> {
    s.resolving = true;
    const closed = await write("resolve", kind);
    s.resolving = false;
    s.endUnsure = closed === null;
    s.stored = closed === null ? undefined : closed ? "resolved" : "held";
    s.writtenAt = now();
    return closed !== null;
  }

  async function flush(): Promise<void> {
    for (const [kind, s] of state) {
      if (!up) return;
      const due = now() - s.writtenAt >= REFRESH_MS;
      if (s.owedRaise || (s.wanted === "raised" && (s.stored !== "raised" || due))) {
        if (s.endUnsure && !(await end(kind, s))) continue;
        if (!up) return;
        if (!(await write("raise", kind))) continue;
        s.stored = "raised";
        s.writtenAt = now();
        s.owedRaise = false;
      }
      if (
        s.wanted === "resolved" &&
        (s.stored === undefined || s.stored === "raised" || (s.stored === "held" && due))
      ) {
        if (!up) return;
        await end(kind, s);
      }
    }
  }

  function run(): Promise<void> {
    if (running) {
      again = true;
      return settled;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await flush();
        } while (again && up);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    observe(capabilities: unknown): Promise<void> {
      for (const [kind, target] of Object.entries(readinessAlarmTargets(capabilities)) as Array<
        [OpsAlarmKind, OpsAlarmTarget]
      >) {
        const s = state.get(kind)!;
        s.wanted = target;
        if (target === "raised" && (s.stored !== "raised" || s.resolving)) s.owedRaise = true;
      }
      up = reachable(capabilities);
      if (!up) return settled;
      return run();
    },
  };
}
