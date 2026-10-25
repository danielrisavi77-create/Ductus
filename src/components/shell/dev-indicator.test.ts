import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

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
    expect(rules[0]!.headers.map((h) => h.key)).toEqual(
      ["X-Frame-Options", "Referrer-Policy", "X-Content-Type-Options"],
    );
  });
});
