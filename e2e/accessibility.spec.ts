import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Every page added later gets a row here; WCAG 2.1 AA is the pilot target.
const PAGES = ["/", "/rad"];

// The shell is always dark (D-115); the sheet is light by default and has a
// dark theme with its own tokens, so each sheet theme is checked on its own.
const SCHEMES = ["light", "dark"] as const;

/** Chooses the sheet theme the way a writer does, through the switch. */
async function chooseSheetTheme(page: Page, theme: (typeof SCHEMES)[number]) {
  if (theme === "light") return;
  await page.getByRole("button", { name: "Tamni list" }).click();
  await expect(page.locator("article.sheet")).toHaveAttribute("data-sheet-theme", "dark");
}

for (const path of PAGES) {
  for (const colorScheme of SCHEMES) {
    test(`axe: no WCAG 2.1 AA violations on ${path} (sheet: ${colorScheme})`, async ({ page }) => {
      await page.goto(path);
      if (path === "/rad") await chooseSheetTheme(page, colorScheme);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
}

// Below 1100 px the rails are sections that open with a button (DAN-131);
// their content is only in the accessibility tree once opened.
for (const colorScheme of SCHEMES) {
  test(`axe: no WCAG 2.1 AA violations on /rad with the rails open at 390 px (sheet: ${colorScheme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/rad");
    await chooseSheetTheme(page, colorScheme);
    for (const toggle of await page.locator(".rail-toggle").all()) {
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
    }
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
