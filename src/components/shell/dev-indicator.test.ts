import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";
import { API_CONTENT_SECURITY_POLICY } from "@/server/http/content-security-policy";

// The demo runs on `next dev`, where the dev tools button sat bottom left over
// the account name of the shell on every demo screenshot (demo polish before
// the 29 Oct 2026 rehearsal, #476).
describe("next.config", () => {
  it("draws no dev tools button over the shell", () => {
    expect(nextConfig.devIndicators).toBe(false);
  });

  it("keeps the security headers and the hidden powered-by header", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = await nextConfig.headers!();
    expect(rules[0]!.source).toBe("/:path*");
    expect(rules[0]!.headers.map((h) => h.key)).toEqual([
      "X-Frame-Options",
      "Referrer-Policy",
      "X-Content-Type-Options",
      "Strict-Transport-Security",
      "Permissions-Policy",
    ]);
    // DAN-489: pages get their policy from middleware.ts, API responses this one.
    expect(rules[1]).toEqual({
      source: "/api/:path*",
      headers: [{ key: "Content-Security-Policy", value: API_CONTENT_SECURITY_POLICY }],
    });
  });
});
