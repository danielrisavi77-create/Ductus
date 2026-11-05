import type { NextRequest } from "next/server";

import { expectedOrigin } from "@/server/auth/config";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { evidencePayloadReader } from "@/server/evidence/payload-reader";
import { handleReplayRequest } from "@/server/evidence/replay-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unavailable(): Response {
  return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
}

// One page of the replay of a document (DAN-344, R3). POST, so the document id
// never lands in a URL; the origin comes from the configured OIDC callback.
// Payloads come from the storage domain of the institution the read RPC names.
export async function POST(request: NextRequest): Promise<Response> {
  const origin = expectedOrigin();
  if (!origin) return unavailable();
  return handleReplayRequest(request, {
    withActor,
    payloads: evidencePayloadReader(),
    expectedOrigin: origin,
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}
