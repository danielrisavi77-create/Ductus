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
export async function register(exit: (code: number) => never = process.exit): Promise<void> {
  // A block, not an early return: webpack drops a dead branch with its
  // imports, so the edge bundle never tries to resolve node:http.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ environmentProblems }, { logEvent }] = await Promise.all([
      import("@/server/env"),
      import("@/server/log/logger"),
    ]);
    const problems = environmentProblems();
    if (problems.length > 0) {
      logEvent("error", "Ductus cannot start", { problems });
      exit(1);
      return;
    }
    const [{ ServerResponse }, { installSecurityHeaderFloor }] = await Promise.all([
      import("node:http"),
      import("@/server/http/security-headers"),
    ]);
    installSecurityHeaderFloor(ServerResponse.prototype);
  }
}
