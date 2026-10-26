import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { handleAssignmentSubmissionsRequest } from "@/server/evidence/assignment-submissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// DAN-332 R1 (#826): which students of an assignment submitted, for its
// teacher; the database decides through the session who gets rows.
export async function GET(request: NextRequest, context: { params: Promise<{ assignmentId: string }> }): Promise<Response> {
  const { assignmentId } = await context.params;
  return handleAssignmentSubmissionsRequest(request, assignmentId, {
    withActor,
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}
