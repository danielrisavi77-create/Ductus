import { counted } from "@/server/auth/activity";
import { createEnrollmentPostHandler } from "@/server/institution/enrollment-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = counted(createEnrollmentPostHandler());
