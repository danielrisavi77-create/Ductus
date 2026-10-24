import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { handleLivePublishRequest, handleLiveReadRequest } from "@/server/collaboration/live-route";
import { withActor } from "@/server/db";
import { applicationOrigin } from "@/server/evidence/ingest-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Context = { params: Promise<{ documentId: string }> };

// The live view (B-LIVE, docs/BACKEND.md 4.12 point 6): the last state of one
// document. PUT publishes it (the student owner only), GET reads it (the same
// bytes for the owner and the teacher). The database decides who may do which.
export async function PUT(request: NextRequest, context: Context): Promise<Response> {
  const { documentId } = await context.params;
  return handleLivePublishRequest(request, documentId, {
    withActor,
    expectedOrigin: applicationOrigin(),
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}

export async function GET(request: NextRequest, context: Context): Promise<Response> {
  const { documentId } = await context.params;
  return handleLiveReadRequest(request, documentId, {
    withActor,
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}
