import type { NextRequest } from "next/server";

import { counted } from "@/server/auth/activity";
import { expectedOrigin } from "@/server/auth/config";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { respond } from "@/server/institution/mutation-route";
import { handleWorkLanguageByDocumentRequest } from "@/server/institution/work-language-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// DAN-386 (#1986, QA c.6861733018): one work's language exception, keyed by
// the work's document id; the student's id stays on the server.
async function post(
  request: NextRequest, context: { params: Promise<{ assignmentId: string; documentId: string }> },
): Promise<Response> {
  const origin = expectedOrigin();
  if (!origin) return respond(503, { error: "unavailable" });
  const { assignmentId, documentId } = await context.params;
  return handleWorkLanguageByDocumentRequest(request, assignmentId, documentId, {
    withActor, expectedOrigin: origin, sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}

export const POST = counted(post);
