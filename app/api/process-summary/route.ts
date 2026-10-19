import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import {
  handleProcessSummaryRequest,
  loadProcessSummaryThresholds,
  PAYLOAD_READING_NOT_CONFIGURED,
} from "@/server/projection/process-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unavailable(): Response {
  return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
}

// The process summary of one document (B-13). POST, so the document id never
// lands in a URL; the origin comes from the configured OIDC callback.
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
  return handleProcessSummaryRequest(request, {
    withActor,
    payloads: PAYLOAD_READING_NOT_CONFIGURED,
    thresholds: loadProcessSummaryThresholds(),
    expectedOrigin,
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}
