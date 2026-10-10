import { expect, test } from "@playwright/test";

// D-09 in the build that is deployed. `next build` fixes NODE_ENV to
// "production" in the server code, so the fake provider ("Demo prijava") is
// refused whatever NODE_ENV `next start` is given: unset (the deployed case),
// test or development (playwright.config.ts starts the same build three
// times). The login route answers with the neutral page and never sends the
// browser to the fake provider. The full login through the fake provider is
// covered by tests/unit/auth/flow.test.ts against an in-process provider and
// by e2e/login/login.spec.ts against `next dev` (pnpm test:e2e:login).
const SERVERS = [
  { nodeEnv: "unset", origin: "http://localhost:3000" },
  { nodeEnv: "test", origin: "http://localhost:3001" },
  { nodeEnv: "development", origin: "http://localhost:3002" },
] as const;

for (const { nodeEnv, origin } of SERVERS) {
  test(`the production build refuses the fake provider with NODE_ENV ${nodeEnv} at start`, async ({ page }) => {
    const providerRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).port === "8090") providerRequests.push(request.url());
    });
    const response = await page.goto(`${origin}/api/auth/login`);
    expect(response?.status()).toBe(503);
    await expect(page.locator("html")).toHaveAttribute("lang", "hr");
    await expect(page.getByRole("heading", { level: 1, name: "Prijava nije dovršena" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pokušaj ponovno" })).toHaveAttribute("href", "/api/auth/login");
    expect(page.url()).toBe(`${origin}/api/auth/login`);
    expect(providerRequests).toEqual([]);
    expect(await page.context().cookies()).toEqual([]);
  });
}
