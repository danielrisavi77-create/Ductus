import type { NextRequest } from "next/server";

import { expectedOrigin } from "@/server/auth/config";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { handleEvidenceCommitRequest } from "@/server/evidence/commit-route";
import { evidenceIngestDeps } from "@/server/evidence/ingest-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// One evidence segment and the document after it (B-8, docs/BACKEND.md 4.13).
// The document id travels in the body, never in the URL.
export async function POST(request: NextRequest): Promise<Response> {
  return handleEvidenceCommitRequest(request, {
    withActor,
    ...evidenceIngestDeps(),
    expectedOrigin: expectedOrigin(),
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}
