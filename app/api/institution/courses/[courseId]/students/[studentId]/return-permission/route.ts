import type { NextRequest } from "next/server";

import { expectedOrigin } from "@/server/auth/config";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { respond } from "@/server/institution/mutation-route";
import { handleStudentReturnRequest } from "@/server/institution/student-return-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: NextRequest, context: { params: Promise<{ courseId: string; studentId: string }> },
): Promise<Response> {
  const origin = expectedOrigin();
  if (!origin) return respond(503, { error: "unavailable" });
  const { courseId, studentId } = await context.params;
  return handleStudentReturnRequest(request, courseId, studentId, {
    withActor, expectedOrigin: origin, sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}
