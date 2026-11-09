import type { NextRequest } from "next/server";

import { counted } from "@/server/auth/activity";
import { expectedOrigin } from "@/server/auth/config";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { handleAssignmentVersionRequest } from "@/server/institution/assignment-version-route";
import { respond } from "@/server/institution/mutation-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function post(
  request: NextRequest, context: { params: Promise<{ assignmentId: string }> },
): Promise<Response> {
  const origin = expectedOrigin();
  if (!origin) return respond(503, { error: "unavailable" });
  const { assignmentId } = await context.params;
  return handleAssignmentVersionRequest(request, assignmentId, {
    withActor, expectedOrigin: origin, sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}

export const POST = counted(post);
