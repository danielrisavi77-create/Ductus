import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { createAssignmentResponse } from "@/server/institution/create-assignment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ courseId: string }> },
): Promise<Response> {
  const redirectUri = process.env.OIDC_REDIRECT_URI;
  let expectedOrigin: string;
  try {
    if (!redirectUri) throw new Error("missing redirect URI");
    const redirect = new URL(redirectUri);
    if (redirect.protocol !== "https:" && redirect.protocol !== "http:") throw new Error("invalid redirect URI");
    expectedOrigin = redirect.origin;
  } catch {
    console.error("assignment creation unavailable", "origin_config");
    return new Response(JSON.stringify({ error: "assignment_unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const { courseId } = await context.params;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  return createAssignmentResponse(request, token, withActor, expectedOrigin, courseId);
}
