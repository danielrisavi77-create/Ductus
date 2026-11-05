// Readiness (DAN-299): 200 only when the database answers. Liveness is
// /api/health and reads nothing. The body never carries a reason; the log
// carries an error code only.
import { withActor } from "@/server/db";
import { checkReadiness } from "@/server/ready";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store" };

export async function GET(): Promise<Response> {
  // withActor(null) is anonymous: it reads no session and also checks that the
  // connection is the locked application role.
  const result = await checkReadiness(() => withActor(null, (tx) => tx.query("SELECT 1")));
  if (result.ready) return Response.json({ status: "ready" }, { headers: HEADERS });
  console.error("not ready", result.reason);
  return Response.json({ status: "unavailable" }, { status: 503, headers: HEADERS });
}
