import type { NextRequest } from "next/server";

import { expectedOrigin } from "@/server/auth/config";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { handleCommentRequest, type CommentAction } from "@/server/collaboration/comments";
import { withActor } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set<string>(["create", "reply", "resolve", "reopen", "list"]);

function unavailable(status = 503): Response {
  return Response.json({ error: status === 404 ? "not_found" : "unavailable" }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

// Reads are POST too, so a document id never lands in a URL or access log.
// The origin is derived from the configured OIDC callback, not Request.url.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
): Promise<Response> {
  const { action } = await context.params;
  if (!ACTIONS.has(action)) return unavailable(404);
  const origin = expectedOrigin();
  if (!origin) return unavailable();
  return handleCommentRequest(action as CommentAction, request, {
    withActor,
    expectedOrigin: origin,
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}
