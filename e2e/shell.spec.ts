import { expect, test } from "@playwright/test";

// The F-4 shell (design v6, D-89): three columns on a wide screen, the sheet
// first and the rails stacked under it on a phone.
test.describe("workspace shell", () => {
  test("wide: rails beside the sheet, writing view marked current", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/rad");
    const rail = page.getByRole("complementary", { name: "Struktura rada" });
    const sheet = page.locator("article.sheet");
    const panel = page.getByRole("complementary", { name: "Upute, literatura i komentari" });
    const [r, s, p] = await Promise.all([rail.boundingBox(), sheet.boundingBox(), panel.boundingBox()]);
    expect(r && s && p).toBeTruthy();
    expect(r!.width).toBeCloseTo(236, 0);
    expect(p!.width).toBeCloseTo(322, 0);
    expect(r!.x + r!.width).toBeLessThanOrEqual(s!.x);
    expect(s!.x + s!.width).toBeLessThanOrEqual(p!.x);
    expect(s!.width).toBeLessThanOrEqual(756);
    await expect(
      page.getByRole("navigation", { name: "Prikaz" }).getByRole("link", { name: "Pisanje" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("phone: sheet first, no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/rad");
    const sheet = await page.locator("article.sheet").boundingBox();
    const rail = await page.getByRole("complementary", { name: "Struktura rada" }).boundingBox();
    expect(sheet!.y).toBeLessThan(rail!.y);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("home links to the workspace", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Otvori radni prostor" }).click();
    await expect(page).toHaveURL(/\/rad$/);
  });
});
