import { NextResponse, type NextRequest } from "next/server";

import { issuerOriginOf, newNonce, pageContentSecurityPolicy } from "@/server/http/content-security-policy";

// DAN-489 (M1.6b): a new nonce and Content-Security-Policy for every page
// request. Next.js reads the nonce from the request header and puts it on its
// own scripts; the browser enforces the response header.
export function middleware(request: NextRequest) {
  const policy = pageContentSecurityPolicy({
    nonce: newNonce(),
    development: process.env.NODE_ENV === "development",
    issuerOrigin: issuerOriginOf(process.env.OIDC_ISSUER),
  });
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  // /api/* stays out: the middleware would buffer request bodies, and API
  // responses get their own static policy from next.config.ts. Hashed static
  // files and the icon run no markup.
  matcher: ["/((?!api/|_next/static/|_next/image/|favicon\\.ico$).*)"],
};
