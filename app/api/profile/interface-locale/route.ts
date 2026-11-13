import type { NextRequest } from "next/server";

import { counted } from "@/server/auth/activity";
import { expectedOrigin } from "@/server/auth/config";
import { liveSessionToken } from "@/server/auth/ended-mark";
import { withActor } from "@/server/db";
import { handleInterfaceLocaleGet, handleInterfaceLocalePost } from "@/server/profile/interface-locale-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function unavailable(): Response {
  return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
}

// DAN-427 (M11.5-P02): the caller's interface language. A read is not
// activity; a save is (counted). The origin is derived from the configured
// OIDC callback, not Request.url.
export async function GET(request: NextRequest): Promise<Response> {
  return handleInterfaceLocaleGet(request, { withActor, sessionToken: liveSessionToken(request.cookies) });
}

async function post(request: NextRequest): Promise<Response> {
  const origin = expectedOrigin();
  if (!origin) return unavailable();
  return handleInterfaceLocalePost(request, {
    withActor,
    expectedOrigin: origin,
    sessionToken: liveSessionToken(request.cookies),
  });
}

export const POST = counted(post);
