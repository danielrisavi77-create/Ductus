import type { SignalTarget } from "@/server/shutdown";

// Next.js calls register() once when a server process starts, before any
// request (DAN-299). Only the Node runtime reaches the database; the edge
// runtime has nothing to check here.
//
// Next.js 15 does not stop when register() throws: it logs "Failed to prepare
// server" and answers every request with 500. So a refused environment ends
// the process here, with only the variable names in the message.
//
// DAN-498: register() also puts the security header floor on every Node
// response, before the server takes its first request. The router answers
// some requests (a 308 for `//` or a trailing slash, a 400 for a path it
// cannot decode) before next.config.ts headers() and the middleware run.
//
// DAN-587: on SIGTERM or SIGINT Next.js closes its server and exits 0 once the
// requests in flight are done, with no deadline. register() adds the deadline
// (exit 1 past SHUTDOWN_GRACE_MS) and the draining state /api/ready answers.
export async function register(
  exit: (code: number) => never = process.exit,
  signals?: SignalTarget,
): Promise<void> {
  // A block, not an early return: webpack drops a dead branch with its
  // imports, so the edge bundle never tries to resolve node:http.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { environmentProblems } = await import("@/server/env");
    const problems = environmentProblems();
    if (problems.length > 0) {
      console.error(`Ductus cannot start: ${problems.join("; ")}`);
      exit(1);
      return;
    }
    const [{ ServerResponse }, { installSecurityHeaderFloor }, { installProcessShutdownSignals }] = await Promise.all([
      import("node:http"),
      import("@/server/http/security-headers"),
      import("@/server/shutdown"),
    ]);
    installSecurityHeaderFloor(ServerResponse.prototype);
    installProcessShutdownSignals(signals ?? process, exit);
  }
}
