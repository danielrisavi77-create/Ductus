import type { NextRequest } from "next/server";

import { expectedOrigin } from "@/server/auth/config";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import type { WithActor } from "@/server/db/with-actor";
import { createAssignmentResponse } from "@/server/institution/create-assignment";

type AssignmentPostDependencies = {
  withActor?: WithActor;
  getRedirectUri?: () => string | undefined;
};

export function createAssignmentPostHandler(
  dependencies: AssignmentPostDependencies = {},
): (
  request: NextRequest,
  context: { params: Promise<{ courseId: string }> },
) => Promise<Response> {
  const actor = dependencies.withActor ?? withActor;
  const getRedirectUri = dependencies.getRedirectUri ?? (() => process.env.OIDC_REDIRECT_URI);

  return async (request, context) => {
    const origin = expectedOrigin({ NODE_ENV: process.env.NODE_ENV, OIDC_REDIRECT_URI: getRedirectUri() });
    if (!origin) {
      console.error("assignment creation unavailable", "origin_config");
      return new Response(JSON.stringify({ error: "assignment_unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
    const { courseId } = await context.params;
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
    return createAssignmentResponse(request, token, actor, origin, courseId);
  };
}
