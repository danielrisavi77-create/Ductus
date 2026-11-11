import type { NextRequest } from "next/server";

import { liveSessionToken } from "@/server/auth/ended-mark";
import { withActor } from "@/server/db";
import { handleMentoredWorkRequest } from "@/server/institution/mentored-works";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// DAN-477 (#1091): one work the teacher mentors; anything else is the same 404.
export async function GET(request: NextRequest, context: { params: Promise<{ mentorshipId: string }> }): Promise<Response> {
  const { mentorshipId } = await context.params;
  return handleMentoredWorkRequest(request, {
    withActor,
    sessionToken: liveSessionToken(request.cookies),
  }, mentorshipId);
}

// Every other method goes through the same handler, which refuses all but
// GET and HEAD with the contract 405 and no-store. Left unexported, Next.js
// answers OPTIONS itself with 204 and the rest with an empty 405 (#1278).
export const OPTIONS = GET;
export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
