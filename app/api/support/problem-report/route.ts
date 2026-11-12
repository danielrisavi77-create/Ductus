import type { NextRequest } from "next/server";

import { counted } from "@/server/auth/activity";
import { expectedOrigin } from "@/server/auth/config";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { handleProblemReport } from "@/server/support/problem-report-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unavailable(): Response {
  return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
}

// DAN-431 (M11.10-P01). The origin is derived from the configured OIDC
// callback, not Request.url.
async function post(request: NextRequest): Promise<Response> {
  const origin = expectedOrigin();
  if (!origin) return unavailable();
  return handleProblemReport(request, {
    withActor,
    expectedOrigin: origin,
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}

export const POST = counted(post);
