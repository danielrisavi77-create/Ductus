import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Every page added later gets a row here; WCAG 2.1 AA is the pilot target.
const PAGES = ["/", "/rad"];

// The dark theme follows the system setting and has its own tokens, so its
// contrast is checked separately from the light one.
const SCHEMES = ["light", "dark"] as const;

for (const path of PAGES) {
  for (const colorScheme of SCHEMES) {
    test(`axe: no WCAG 2.1 AA violations on ${path} (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto(path);
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
  test(`axe: no WCAG 2.1 AA violations on /rad with the rails open at 390 px (${colorScheme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme });
    await page.goto("/rad");
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
