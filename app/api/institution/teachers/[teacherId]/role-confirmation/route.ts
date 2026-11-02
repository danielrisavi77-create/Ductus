import type { NextRequest } from "next/server";

import { expectedOrigin } from "@/server/auth/config";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { respond } from "@/server/institution/mutation-route";
import { handleTeacherRoleConfirmationRequest } from "@/server/institution/teacher-role-confirmation-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: NextRequest, context: { params: Promise<{ teacherId: string }> },
): Promise<Response> {
  const origin = expectedOrigin();
  if (!origin) return respond(503, { error: "unavailable" });
  // The segment is shared with role-revocation; here it names the candidate.
  const { teacherId: candidateId } = await context.params;
  return handleTeacherRoleConfirmationRequest(request, candidateId, {
    withActor, expectedOrigin: origin, sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}
