import { expect, test } from "@playwright/test";

// D-09 in the build that is deployed: `next start` runs with
// NODE_ENV=production, where the fake provider ("Demo prijava") is refused.
// The login route answers with the neutral page and never sends the browser
// to the fake provider. The full login through the fake provider is covered
// by tests/unit/auth/flow.test.ts against an in-process provider.
test("the production build refuses the fake provider with the neutral page", async ({ page }) => {
  const providerRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).port === "8090") providerRequests.push(request.url());
  });
  const response = await page.goto("/api/auth/login");
  expect(response?.status()).toBe(503);
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  await expect(page.getByRole("heading", { level: 1, name: "Prijava nije dovršena" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pokušaj ponovno" })).toHaveAttribute("href", "/api/auth/login");
  expect(page.url()).toMatch(/\/api\/auth\/login$/);
  expect(providerRequests).toEqual([]);
  expect(await page.context().cookies()).toEqual([]);
});
