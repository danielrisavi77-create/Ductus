import { checkCapabilities } from "@/server/ready";
import { readinessCapabilities } from "@/server/ready-capabilities";
import { publicStatusCache, publicStatusResponse } from "@/server/public-status";
import { processShutdown } from "@/server/shutdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One check per PUBLIC_STATUS_TTL_MS for all callers of this process (DAN-429).
// Faults are logged by /api/ready, which the deployment probes; this public
// route logs nothing of its own.
const current = publicStatusCache(() => checkCapabilities(readinessCapabilities()));

/** Public status for /stanje: three parts, closed words, no session and nothing about a person. */
export function GET(): Promise<Response> {
  return publicStatusResponse(current, processShutdown().state() === "running");
}
