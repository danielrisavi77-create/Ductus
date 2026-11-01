import type { NextRequest } from "next/server";

import { expectedOrigin } from "@/server/auth/config";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { handleCreateCourse } from "@/server/institution/create-course";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The origin is derived from the configured OIDC callback, not Request.url
// (whose host/proxy headers must not select the expected security origin).
export async function POST(request: NextRequest): Promise<Response> {
  const origin = expectedOrigin();
  if (!origin) {
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  return handleCreateCourse(request, {
    withActor,
    expectedOrigin: origin,
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}
