import { expect, test } from "@playwright/test";

// Proves the Playwright setup runs against the production build; the editor
// suites from M0.3 replace it.
test("home page renders in Croatian", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  // Without a session "/" is the public home page (FE-H1, #476); the brand stays in its header.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Ductura" })).toBeVisible();
});

// #732 item 3: an unknown address gets the Croatian not-found page, not the Next.js default.
test("unknown address shows the Croatian not-found page", async ({ page }) => {
  const response = await page.goto("/ova-adresa-ne-postoji");
  expect(response?.status()).toBe(404);
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  await expect(page.getByRole("heading", { level: 1, name: "Stranica ne postoji" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Na početnu" })).toHaveAttribute("href", "/");
  await expect(page).toHaveTitle(/Stranica ne postoji/);
});
