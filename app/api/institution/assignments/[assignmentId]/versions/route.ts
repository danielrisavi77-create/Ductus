import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { handleAssignmentVersionRequest } from "@/server/institution/assignment-version-route";
import { applicationOrigin, respond } from "@/server/institution/mutation-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: NextRequest, context: { params: Promise<{ assignmentId: string }> },
): Promise<Response> {
  const expectedOrigin = applicationOrigin();
  if (!expectedOrigin) return respond(503, { error: "unavailable" });
  const { assignmentId } = await context.params;
  return handleAssignmentVersionRequest(request, assignmentId, {
    withActor, expectedOrigin, sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}
