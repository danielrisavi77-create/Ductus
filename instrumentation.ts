// Next.js calls register() once when a server process starts, before any
// request (DAN-299). Only the Node runtime reaches the database; the edge
// runtime has nothing to check here.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertEnvironment } = await import("@/server/env");
  assertEnvironment();
}
