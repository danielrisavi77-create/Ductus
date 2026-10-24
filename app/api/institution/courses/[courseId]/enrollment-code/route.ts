import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { handleEnrollmentCodeRequest } from "@/server/institution/enrollment-code-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: NextRequest, context: { params: Promise<{ courseId: string }> },
): Promise<Response> {
  let expectedOrigin: string;
  try {
    const callback = process.env.OIDC_REDIRECT_URI;
    if (!callback) throw new Error("missing application origin");
    expectedOrigin = new URL(callback).origin;
    if (expectedOrigin === "null") throw new Error("invalid application origin");
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  return handleEnrollmentCodeRequest(request, (await context.params).courseId, {
    withActor, expectedOrigin, sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}
