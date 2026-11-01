// Next.js calls register() once when a server process starts, before any
// request (DAN-299). Only the Node runtime reaches the database; the edge
// runtime has nothing to check here.
//
// Next.js 15 does not stop when register() throws: it logs "Failed to prepare
// server" and answers every request with 500. So a refused environment ends
// the process here, with only the variable names in the message.
export async function register(exit: (code: number) => never = process.exit): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { environmentProblems } = await import("@/server/env");
  const problems = environmentProblems();
  if (problems.length === 0) return;
  console.error(`Ductus cannot start: ${problems.join("; ")}`);
  exit(1);
}
