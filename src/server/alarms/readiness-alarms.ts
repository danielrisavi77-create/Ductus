import {
  OPS_ALARM_KINDS,
  readinessAlarmTargets,
  type OpsAlarmKind,
  type OpsAlarmTarget,
} from "@/domain/ops/alarm";

/** Where alarms are delivered: the in-app channel, identity.ops_alarm. */
export type AlarmStore = {
  raise(kind: OpsAlarmKind): Promise<void>;
  resolve(kind: OpsAlarmKind): Promise<void>;
};

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
  stored: OpsAlarmTarget | undefined;
  wanted: OpsAlarmTarget | undefined;
  // A fault was seen that no stored raise covers yet. It survives an "ok"
  // that comes before the store works again, so an outage that is over by
  // the time the database answers is still written, then resolved.
  owedRaise: boolean;
  // A resolve of this kind is in the store. A fault reported meanwhile is owed
  // too: the resolve was decided before the fault and will not cover it.
  resolving: boolean;
};

/**
 * Turns readiness reports into alarm writes for one process (DAN-184). Only
 * transitions are written; a write the store refuses or throws on is retried
 * on the next report. Writes run one at a time, and reports that arrive
 * meanwhile join the run in progress, so a store that hangs holds at most one
 * write. State is one fixed entry per kind, so no number of reports grows it.
 * observe() never rejects and never changes what the caller answers.
 */
export function createAlarmTracker(
  store: AlarmStore,
  onError: AlarmStoreError = () => {},
  reachable: StoreReachable = () => true,
) {
  const state = new Map<OpsAlarmKind, KindState>(
    OPS_ALARM_KINDS.map((kind) => [kind, { stored: undefined, wanted: undefined, owedRaise: false, resolving: false }]),
  );
  let running: Promise<void> | null = null;
  let again = false;
  // What the latest report said of the store. A run in progress checks it
  // before every write, so a report of an outage stops the writes left in it.
  let up = true;

  async function write(op: "raise" | "resolve", kind: OpsAlarmKind): Promise<boolean> {
    try {
      await store[op](kind);
      return true;
    } catch {
      try {
        onError(op, kind);
      } catch {
        // The hook is only a report; its failure changes nothing.
      }
      return false;
    }
  }

  async function flush(): Promise<void> {
    for (const [kind, s] of state) {
      if (!up) return;
      if (s.owedRaise || (s.wanted === "raised" && s.stored !== "raised")) {
        if (!(await write("raise", kind))) continue;
        s.stored = "raised";
        s.owedRaise = false;
      }
      if (s.wanted === "resolved" && s.stored !== "resolved") {
        if (!up) return;
        s.resolving = true;
        const resolved = await write("resolve", kind);
        s.resolving = false;
        if (!resolved) continue;
        s.stored = "resolved";
      }
    }
  }

  function run(): Promise<void> {
    if (running) {
      again = true;
      return running;
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
      if (!up) return running ?? Promise.resolve();
      return run();
    },
  };
}
