import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { applicationOrigin, evidenceIngestDeps } from "@/server/evidence/ingest-deps";
import { handleSubmissionRequest } from "@/server/evidence/submission-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// A student's submission of the revision they saw (B-12, docs/BACKEND.md 4.6):
// the database clock at the click, the reconstruction of that revision and,
// only when it matches, the submission and its signed receipt.
export async function POST(request: NextRequest): Promise<Response> {
  return handleSubmissionRequest(request, {
    withActor,
    ...evidenceIngestDeps(),
    expectedOrigin: applicationOrigin(),
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}
