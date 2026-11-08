// Readiness per capability (DAN-299, DAN-585): the database, evidence storage,
// signing and the worker queue are probed in parallel, each with its own time
// limit inside one total limit. The probes are injected, so the rules below
// are testable without any of them; the route passes the real ones.

export type CapabilityName = "database" | "storage" | "signing" | "queue";
export type CapabilityStatus = "ok" | "nedostupno" | "nije_konfigurirano";

/**
 * A probe answers "ok" or "nije_konfigurirano"; anything else it returns, a
 * throw, a rejection or no answer in time reads "nedostupno". The signal is
 * aborted at the limit so the probe can let go of what it holds.
 */
export type Probe = (signal: AbortSignal) => Promise<"ok" | "nije_konfigurirano">;

export type Capability = { name: CapabilityName; required: boolean; timeoutMs: number; probe: Probe };

export type CapabilityReport = {
  /** False exactly when a required capability is not "ok". */
  ready: boolean;
  capabilities: Partial<Record<CapabilityName, CapabilityStatus>>;
  /** Closed codes of the failed capabilities, for the log only: never a message. */
  codes: Partial<Record<CapabilityName, string>>;
};

/** Longest wait for the whole check. A readiness check that hangs is worse than a refusal. */
export const READY_TIMEOUT_MS = 3_000;

/** Each capability's own limit; the total limit still applies over all of them. */
export const CAPABILITY_TIMEOUT_MS: Readonly<Record<CapabilityName, number>> = Object.freeze({
  database: 1_500,
  storage: 2_500,
  signing: 1_500,
  queue: 1_500,
});

const CODE = /^[A-Za-z0-9_]{1,32}$/;

/** The error's code when it is a short identifier, else a fixed word: never its message. */
function closedCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && CODE.test(code) ? code : "ERROR";
}

type Outcome = { status: CapabilityStatus; code?: string };

async function runProbe(capability: Capability, totalMs: number): Promise<Outcome> {
  const controller = new AbortController();
  const limitMs = Math.max(0, Math.min(capability.timeoutMs, totalMs));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), limitMs);
  });
  // The probe's own promise is observed even after the limit, so a late
  // rejection is never unhandled.
  const answer = Promise.resolve()
    .then(() => capability.probe(controller.signal))
    .then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
  try {
    const result = await Promise.race([answer, expired]);
    if (result === "timeout") return { status: "nedostupno", code: "TIMEOUT" };
    if ("error" in result) return { status: "nedostupno", code: closedCode(result.error) };
    if (result.value === "ok" || result.value === "nije_konfigurirano") return { status: result.value };
    return { status: "nedostupno", code: "ERROR" };
  } finally {
    clearTimeout(timer);
    // Aborting after an answer is harmless; after the limit it releases the probe.
    controller.abort(Object.assign(new Error("readiness limit"), { code: "TIMEOUT" }));
  }
}

/**
 * Runs every probe in parallel and reports each capability. Never throws and
 * keeps no state between calls: each call has its own controllers and
 * timers, so concurrent calls share no result and no probe outlives its call.
 */
export async function checkCapabilities(
  capabilities: readonly Capability[],
  totalMs: number = READY_TIMEOUT_MS,
): Promise<CapabilityReport> {
  const outcomes = await Promise.all(capabilities.map((capability) => runProbe(capability, totalMs)));
  const report: CapabilityReport = { ready: true, capabilities: {}, codes: {} };
  capabilities.forEach((capability, i) => {
    const { status, code } = outcomes[i];
    report.capabilities[capability.name] = status;
    if (code !== undefined) report.codes[capability.name] = code;
    if (capability.required && status !== "ok") report.ready = false;
  });
  return report;
}

/** The queue row of the route's query: only the two closed words pass, anything else is a fault. */
export function classifyQueue(row: unknown): "ok" | "nije_konfigurirano" {
  const queue = (row as { queue?: unknown } | null | undefined)?.queue;
  if (queue === "ok" || queue === "nije_konfigurirano") return queue;
  throw Object.assign(new Error("queue worker not connected"), { code: "QUEUE_WORKER" });
}

/**
 * Storage domains as the router reports them: no domain is not configured,
 * every domain verified is ok, and a domain not (yet) verified or disabled
 * is a fault.
 */
export function classifyStorage(states: "not_configured" | Readonly<Record<string, string>>): "ok" | "nije_konfigurirano" {
  if (states === "not_configured") return "nije_konfigurirano";
  const values = Object.values(states);
  if (values.length === 0) return "nije_konfigurirano";
  if (values.every((state) => state === "verified")) return "ok";
  throw Object.assign(new Error("storage domain not verified"), { code: "STORAGE_DOMAIN" });
}

/** Signer refusals that mean "no key is meant to be here", not "the key is broken". */
const SIGNING_NOT_CONFIGURED = new Set(["signing_key_production", "signing_key_not_configured"]);

/** Ok when the signer gives its public key; a refusal by deployment is not configured; anything else is rethrown. */
export async function signingOutcome(publicKey: () => Promise<unknown>): Promise<"ok" | "nije_konfigurirano"> {
  try {
    await publicKey();
    return "ok";
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === "string" && SIGNING_NOT_CONFIGURED.has(code)) return "nije_konfigurirano";
    throw error;
  }
}

/**
 * One call of `fn` at a time: while it is unsettled, later callers get the
 * same promise; once it settles, the next caller starts a new one. A database
 * probe that cannot be cancelled (withActor takes no signal) may hold a pool
 * connection until the pool's own query limit; this keeps readiness to one
 * such connection per probe instead of one per call.
 */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= Promise.resolve()
      .then(fn)
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
