import type { NextRequest } from "next/server";

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
  const callback = process.env.OIDC_REDIRECT_URI;
  if (!callback) return unavailable();
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(callback).origin;
    if (expectedOrigin === "null") throw new Error("invalid application origin");
  } catch {
    return unavailable();
  }
  return handleFastPathRequest(request, {
    withActor,
    payloads: evidencePayloadReader(),
    thresholds: loadProcessSummaryThresholds(),
    expectedOrigin,
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}
