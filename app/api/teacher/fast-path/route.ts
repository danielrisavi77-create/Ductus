import type { NextRequest } from "next/server";

import { expectedOrigin } from "@/server/auth/config";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { evidencePayloadReader } from "@/server/evidence/payload-reader";
import { loadProcessSummaryThresholds } from "@/server/projection/process-summary";
import { handleFastPathRequest } from "@/server/teacher/fast-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unavailable(): Response {
  return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
}

// The teacher's fast path through the works of one assignment (B-11, #757).
// POST, so the assignment id never lands in a URL; the origin comes from the
// configured OIDC callback, and the thresholds are the process summary's.
export async function POST(request: NextRequest): Promise<Response> {
  const origin = expectedOrigin();
  if (!origin) return unavailable();
  return handleFastPathRequest(request, {
    withActor,
    payloads: evidencePayloadReader(),
    thresholds: loadProcessSummaryThresholds(),
    expectedOrigin: origin,
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}
