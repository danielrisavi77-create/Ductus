import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { applicationOrigin, respond } from "@/server/institution/mutation-route";
import { handleEnrollmentCodeRevocationRequest } from "@/server/institution/enrollment-code-revocation-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: NextRequest, context: { params: Promise<{ courseId: string }> },
): Promise<Response> {
  const expectedOrigin = applicationOrigin();
  if (!expectedOrigin) return respond(503, { error: "unavailable" });
  return handleEnrollmentCodeRevocationRequest(request, (await context.params).courseId, {
    withActor, expectedOrigin, sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}
