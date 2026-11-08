import { backchannelRoute } from "@/server/auth/backchannel-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OpenID Connect Back-Channel Logout (DAN-474): the provider POSTs a signed
// logout token here. Only POST closes anything; every other method is 405.
export const POST = backchannelRoute;

function notAllowed(): Response {
  return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
}

export const GET = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
