// Readiness (DAN-299, DAN-585): the process can serve a request only if its
// database answers, and readiness names each capability it depends on with
// a closed state. Probes are injected so the rules below are testable
// without a database; the route passes real ones (ready-probes.ts).

/** Longest wait for the probe. A readiness check that hangs is worse than a refusal. */
export const READY_TIMEOUT_MS = 3_000;

export type Readiness = { ready: true } | { ready: false; reason: string };

type Settled = { ok: true; value: unknown } | { ok: false; code: string };

/** A code that is a closed word; anything else, a message above all, is "ERROR". */
function closedCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code) ? code : "ERROR";
}

async function settle(probe: () => Promise<unknown>, timeoutMs: number): Promise<Settled> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "TIMEOUT" })), timeoutMs);
  });
  try {
    return { ok: true, value: await Promise.race([Promise.resolve().then(probe), timeout]) };
  } catch (error) {
    return { ok: false, code: closedCode(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `probe` and reports whether it finished in time. Never throws and
 * never returns the probe's message: only an error code, or a fixed word, so
 * a connection string cannot reach a response or a log.
 */
export async function checkReadiness(probe: () => Promise<unknown>, timeoutMs: number = READY_TIMEOUT_MS): Promise<Readiness> {
  const settled = await settle(probe, timeoutMs);
  return settled.ok ? { ready: true } : { ready: false, reason: settled.code };
}

/** The capabilities readiness reports, in the order of the answer. */
export const CAPABILITIES = ["database", "storage", "signing", "worker_queue"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * `not_configured`: the process has no adapter or no configuration for it,
 * which is the case for storage and KMS until suppliers are chosen (Q-2).
 */
export type CapabilityState = "ready" | "unavailable" | "not_configured";

/** Resolves a state, or rejects with a coded error that makes it unavailable. */
export type CapabilityProbe = () => Promise<CapabilityState>;

export type CapabilityReadiness = {
  ready: boolean;
  capabilities: Record<Capability, CapabilityState>;
  /** For the log only: one closed code per unavailable capability. */
  faults: { capability: Capability; code: string }[];
};

/**
 * Longest wait per capability, from the measurements in the DAN-585 PR. The
 * slowest bounds the whole check, as the probes run side by side.
 */
export const CAPABILITY_TIMEOUT_MS: Readonly<Record<Capability, number>> = Object.freeze({
  database: 3_000,
  storage: 3_000,
  signing: 1_000,
  worker_queue: 1_000,
});

/**
 * Runs every probe at once, each under its own timeout. Ready when the
 * database is ready and no capability is unavailable: one that is not
 * configured does not hold the process back, one that is configured and
 * fails does. A value outside the closed states is unavailable.
 */
export async function checkCapabilities(
  probes: Readonly<Record<Capability, CapabilityProbe>>,
  timeouts: Readonly<Record<Capability, number>> = CAPABILITY_TIMEOUT_MS,
): Promise<CapabilityReadiness> {
  const settled = await Promise.all(CAPABILITIES.map((name) => settle(() => probes[name](), timeouts[name])));
  const capabilities = {} as Record<Capability, CapabilityState>;
  const faults: CapabilityReadiness["faults"] = [];
  CAPABILITIES.forEach((name, i) => {
    const result = settled[i];
    if (result.ok && (result.value === "ready" || result.value === "not_configured")) {
      capabilities[name] = result.value;
      return;
    }
    capabilities[name] = "unavailable";
    const code = !result.ok ? result.code : result.value === "unavailable" ? "UNAVAILABLE" : "UNEXPECTED";
    faults.push({ capability: name, code });
  });
  const ready = capabilities.database === "ready" && faults.length === 0;
  return { ready, capabilities, faults };
}
