import type { NextRequest } from "next/server";

import { expectedOrigin } from "@/server/auth/config";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { handleEvidenceOpenRequest } from "@/server/evidence/open-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// The student's work for one assignment and its current state (B-8, docs/BACKEND.md 4.13 t. 6).
export async function POST(request: NextRequest): Promise<Response> {
  return handleEvidenceOpenRequest(request, {
    withActor,
    expectedOrigin: expectedOrigin(),
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}
