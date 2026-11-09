import type { NextRequest } from "next/server";

import { counted } from "@/server/auth/activity";
import { expectedOrigin } from "@/server/auth/config";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import {
  REVISION_ACTIONS,
  handleRevisionRequest,
  type RevisionAction,
} from "@/server/collaboration/revision-requests";
import { withActor } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set<string>(REVISION_ACTIONS);

function unavailable(status = 503): Response {
  return Response.json({ error: status === 404 ? "not_found" : "unavailable" }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

// DAN-314 step 2f (docs/backend/suradnja.md 4.14). Reads are POST too, so a
// document or request id never lands in a URL or access log. The origin is
// derived from the configured OIDC callback, not Request.url.
async function post(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
): Promise<Response> {
  const { action } = await context.params;
  if (!ACTIONS.has(action)) return unavailable(404);
  const origin = expectedOrigin();
  if (!origin) return unavailable();
  return handleRevisionRequest(action as RevisionAction, request, {
    withActor,
    expectedOrigin: origin,
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}

export const POST = counted(post);
