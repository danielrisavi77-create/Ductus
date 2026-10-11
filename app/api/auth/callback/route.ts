import { authRoute } from "@/server/auth/deps";
import { finishLogin } from "@/server/auth/flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = authRoute(finishLogin);
