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
