import { counted } from "@/server/auth/activity";
import { createAssignmentPostHandler } from "@/server/institution/assignment-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = counted(createAssignmentPostHandler());
