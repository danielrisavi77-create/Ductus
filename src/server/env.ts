// DAN-299 (decision on the Linear contract, 1. 11. 2026., direction 1): the
// process refuses to start without the one variable every request needs, the
// application login APP_DATABASE_URL (src/server/db/index.ts). Login stays
// lazy on purpose: a production build with the fake provider must start and
// refuse sign-in on the page (D-09, e2e/auth.spec.ts), and the standard E2E
// server runs without AUTH_DATABASE_URL. A bad login setup is a readiness
// signal, not a crash. Messages name a variable, never its value.
type Env = Readonly<Record<string, string | undefined>>;

const PROTOCOLS = new Set(["postgres:", "postgresql:"]);

export class EnvironmentError extends Error {
  override name = "EnvironmentError";
}

/** The problems of the startup environment, by variable name only; empty when it can start. */
export function environmentProblems(env: Env = process.env): string[] {
  const value = env.APP_DATABASE_URL;
  if (value === undefined || value.trim() === "") return ["APP_DATABASE_URL is not set"];
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return ["APP_DATABASE_URL is not a URL"];
  }
  if (!PROTOCOLS.has(parsed.protocol)) return ["APP_DATABASE_URL is not a postgres URL"];
  if (parsed.hostname === "") return ["APP_DATABASE_URL names no host"];
  return [];
}

/** Throws before the server takes a request when the environment cannot work. */
export function assertEnvironment(env: Env = process.env): void {
  const problems = environmentProblems(env);
  if (problems.length > 0) throw new EnvironmentError(`Ductus cannot start: ${problems.join("; ")}`);
}
