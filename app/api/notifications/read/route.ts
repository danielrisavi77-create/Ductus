import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { applicationOrigin } from "@/server/institution/mutation-route";
import { handleMarkNotificationReadRequest } from "@/server/notifications/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest): Promise<Response> {
  const expectedOrigin = applicationOrigin();
  if (!expectedOrigin || !["http:", "https:"].includes(new URL(expectedOrigin).protocol)) {
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  return handleMarkNotificationReadRequest(request, {
    withActor, expectedOrigin, sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}
