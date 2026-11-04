import type { NextConfig } from "next";

import { loginDevEntries } from "./scripts/demo/login-e2e-https.mjs";

import { API_CONTENT_SECURITY_POLICY, STATIC_CONTENT_SECURITY_POLICY } from "./src/server/http/content-security-policy";
import { SECURITY_HEADERS } from "./src/server/http/security-headers";

// Pages get their Content-Security-Policy, with a nonce per request, from
// middleware.ts (DAN-489); SECURITY_HEADERS are the same for every response,
// and instrumentation.ts puts them on the answers Next.js sends before this
// config applies (DAN-498).

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The demo runs on `next dev` (the fake provider needs it, D-09), where the
  // dev tools button sat over the account name in the sidebar on every demo
  // screenshot. Build and runtime errors still open the overlay.
  devIndicators: false,
  // The HTTPS login test launcher precompiles all pages before browser HMR.
  // Keep them through the full bounded demo; normal dev and production are unchanged.
  onDemandEntries: loginDevEntries(process.env),
  async headers() {
    return [
      { source: "/:path*", headers: [...SECURITY_HEADERS] },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: API_CONTENT_SECURITY_POLICY }] },
      // The paths middleware.ts leaves out: their HTML errors need a policy too.
      { source: "/_next/static/:path*", headers: [{ key: "Content-Security-Policy", value: STATIC_CONTENT_SECURITY_POLICY }] },
      { source: "/favicon.ico", headers: [{ key: "Content-Security-Policy", value: STATIC_CONTENT_SECURITY_POLICY }] },
    ];
  },
};

export default nextConfig;
