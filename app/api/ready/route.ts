import { readinessAlarms } from "@/server/alarms/readiness-store";
import { logEvent } from "@/server/log/logger";
import { checkCapabilities } from "@/server/ready";
import { readinessCapabilities } from "@/server/ready-capabilities";
import { processShutdown } from "@/server/shutdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store" };

/**
 * Readiness per capability (DAN-585). The body carries only closed words per
 * capability, never a message, URL or host; the log carries only closed codes.
 * 503 when a required capability is not "ok", or "draining" while shutting down.
 * A change of a capability raises or resolves its alarm (DAN-184).
 */
export async function GET(): Promise<Response> {
  // DAN-587: once the process is shutting down it leaves traffic and takes no
  // pool connection for a probe.
  if (processShutdown().state() !== "running") {
    return Response.json({ status: "draining" }, { status: 503, headers: HEADERS });
  }
  const report = await checkCapabilities(readinessCapabilities());
  // DAN-184: the alarm writes run after the answer and never change it, even
  // if the channel throws, rejects or hangs.
  void Promise.resolve()
    .then(() => readinessAlarms.observe(report.capabilities))
    .catch(() => {});
  const body = { status: report.ready ? "ready" : "unavailable", capabilities: report.capabilities };
  if (Object.keys(report.codes).length > 0) logEvent("error", "readiness", { codes: report.codes });
  return Response.json(body, { status: report.ready ? 200 : 503, headers: HEADERS });
}
