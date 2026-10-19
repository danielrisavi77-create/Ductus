import { expect, test } from "@playwright/test";

import { appCookie, SESSION_COOKIE } from "./support";

// FE-D3 (DAN-222): the sign-in from /prijava through the fake provider
// against `next dev` (playwright.login.config.ts).

test("a student signs in from /prijava and a signed-in visit of /prijava goes to /rad", async ({
  page,
  context,
}) => {
  await page.goto("/prijava");
  await page.getByRole("link", { name: "Prijava sustavom AAI@EduHr" }).click();
  await expect(page).toHaveURL(/^http:\/\/localhost:8090\/interaction\//);
  await expect(page.getByRole("heading", { level: 1, name: "Demo prijava" })).toBeVisible();
  await page.getByRole("button", { name: "Demo studentica" }).click();
  await page.waitForURL("http://localhost:3000/rad");
  expect(await appCookie(context, SESSION_COOKIE)).toBeDefined();

  await page.goto("/prijava");
  await page.waitForURL("http://localhost:3000/rad");
});
