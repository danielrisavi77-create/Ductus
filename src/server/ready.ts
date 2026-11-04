// Readiness (DAN-299): the process can serve a request only if its database
// answers. The probe is injected so the rules below are testable without a
// database; the route passes a real one.

/** Longest wait for the probe. A readiness check that hangs is worse than a refusal. */
export const READY_TIMEOUT_MS = 3_000;

export type Readiness = { ready: true } | { ready: false; reason: string };

/**
 * Runs `probe` and reports whether it finished in time. Never throws and
 * never returns the probe's message: only an error code, or a fixed word, so
 * a connection string cannot reach a response or a log.
 */
export async function checkReadiness(probe: () => Promise<unknown>, timeoutMs: number = READY_TIMEOUT_MS): Promise<Readiness> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "TIMEOUT" })), timeoutMs);
  });
  try {
    await Promise.race([Promise.resolve().then(probe), timeout]);
    return { ready: true };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return { ready: false, reason: typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code) ? code : "ERROR" };
  } finally {
    clearTimeout(timer);
  }
}
