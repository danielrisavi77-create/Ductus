import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { handleTeacherCoursesRequest } from "@/server/institution/teacher-courses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// The teacher's courses and assignments for the Z3 entry (DAN-230); the
// database decides which courses through the session.
export async function GET(request: NextRequest): Promise<Response> {
  return handleTeacherCoursesRequest(request, {
    withActor,
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}
