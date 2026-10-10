import { authRoute } from "@/server/auth/deps";
import { logout } from "@/server/auth/flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST only: a GET (a link, an image, a prefetch) never logs anyone out.
export const POST = authRoute(logout);
