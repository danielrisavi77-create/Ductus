/**
 * Quieter Playwright output in Claude Code sessions (DAN-213, #420). Claude Code
 * sets CLAUDECODE=1 in the shell of its tools; there Playwright prints one
 * updating line instead of a line per test, and failures in full. Humans and CI
 * keep the default output: any CI value except empty or "false" counts as CI.
 * vitest.config.ts applies the same rule (`vitestAgentOutput`).
 */
export function isAgentRun(env: Readonly<Record<string, string | undefined>>): boolean {
  const ci = env.CI;
  return env.CLAUDECODE === "1" && (ci === undefined || ci === "" || ci === "false");
}

/** Playwright console reporter: "line" for an agent run, "list" otherwise. */
export function playwrightConsoleReporter(env: Readonly<Record<string, string | undefined>>): "line" | "list" {
  return isAgentRun(env) ? "line" : "list";
}
