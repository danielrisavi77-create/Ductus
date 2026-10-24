import { createAcknowledgmentPostHandler } from "@/server/institution/acknowledgment-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createAcknowledgmentPostHandler();
