import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { handleMentoredWorksRequest } from "@/server/institution/mentored-works";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// DAN-477 (#1091): the works the teacher mentors; the database decides
// through the session who gets rows.
export async function GET(request: NextRequest): Promise<Response> {
  return handleMentoredWorksRequest(request, {
    withActor,
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}

// Exported so Next.js does not answer OPTIONS itself with 204: the handler
// refuses every method but GET and HEAD with the same 405 (QA on #1278).
export const OPTIONS = GET;
