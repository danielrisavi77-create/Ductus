import type { NextConfig } from "next";

import { API_CONTENT_SECURITY_POLICY } from "./src/server/http/content-security-policy";

// Pages get their Content-Security-Policy, with a nonce per request, from
// middleware.ts (DAN-489); the headers here are the same for every response.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Ignored over plain http (RFC 6797 §8.1); it acts behind TLS on staging.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), display-capture=(), clipboard-write=(self)",
  },
] as const;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The demo runs on `next dev` (the fake provider needs it, D-09), where the
  // dev tools button sat over the account name in the sidebar on every demo
  // screenshot. Build and runtime errors still open the overlay.
  devIndicators: false,
  async headers() {
    return [
      { source: "/:path*", headers: [...SECURITY_HEADERS] },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: API_CONTENT_SECURITY_POLICY }] },
    ];
  },
};

export default nextConfig;
