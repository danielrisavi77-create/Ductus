import { withActor } from "@/server/db";
import { evidenceIngestDeps } from "@/server/evidence/ingest-deps";
import { checkCapabilities } from "@/server/ready";
import { databaseProbe, signingProbe, storageProbe, workerQueueProbe } from "@/server/ready-probes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store" };

/**
 * Readiness by capability (DAN-585). The body names each capability and its
 * closed state, nothing more: no reason, address, domain or message. The log
 * gets the capability and a closed code.
 */
export async function GET(): Promise<Response> {
  const result = await checkCapabilities({
    database: databaseProbe(withActor),
    storage: storageProbe(() => evidenceIngestDeps().payloads),
    signing: signingProbe(() => evidenceIngestDeps().signer),
    worker_queue: workerQueueProbe,
  });
  for (const fault of result.faults) console.error("not ready", fault.capability, fault.code);
  return Response.json(
    { status: result.ready ? "ready" : "unavailable", capabilities: result.capabilities },
    { status: result.ready ? 200 : 503, headers: HEADERS },
  );
}
