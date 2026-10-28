import { expect, test } from "@playwright/test";

// FE-D3 (DAN-222): /prijava offers AAI@EduHr alone (D-09) through the existing
// login route. The full sign-in from this screen is in e2e/login/prijava.spec.ts.

test("/prijava renders the AAI@EduHr sign-in in Croatian", async ({ page }) => {
  await page.goto("/prijava");
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  await expect(page.getByRole("heading", { level: 1, name: "Prijava u radni prostor" })).toBeVisible();
  const button = page.getByRole("link", { name: "Prijava sustavom AAI@EduHr" });
  // DAN-325: without a returnTo the sign-in comes back to "/", which sends each person to their own page.
  await expect(button).toHaveAttribute("href", "/api/auth/login?returnTo=%2F");
  // D-09: no other way in, no e-mail field, no password field on this page.
  await expect(page.locator("input")).toHaveCount(0);
  await expect(page.locator('a[href^="/api/auth/login"]')).toHaveCount(1);
});

test("/prijava carries a path of this application as returnTo", async ({ page }) => {
  await page.goto(`/prijava?returnTo=${encodeURIComponent("/upis")}`);
  await expect(page.getByRole("link", { name: "Prijava sustavom AAI@EduHr" })).toHaveAttribute(
    "href",
    "/api/auth/login?returnTo=%2Fupis",
  );
});

for (const returnTo of ["https://example.test/rad", "//example.test", "/api/auth/logout"]) {
  test(`/prijava drops returnTo ${returnTo}`, async ({ page }) => {
    await page.goto(`/prijava?returnTo=${encodeURIComponent(returnTo)}`);
    await expect(page.getByRole("link", { name: "Prijava sustavom AAI@EduHr" })).toHaveAttribute(
      "href",
      "/api/auth/login?returnTo=%2F",
    );
  });
}
