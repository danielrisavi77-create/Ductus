import { expect, test } from "@playwright/test";

// Proves the Playwright setup runs against the production build; the editor
// suites from M0.3 replace it.
test("home page renders in Croatian", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  await expect(page.getByRole("heading", { level: 1, name: "Ductus" })).toBeVisible();
});
