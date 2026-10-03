import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Every page added later gets a row here; WCAG 2.1 AA is the pilot target.
const PAGES = ["/", "/rad"];

for (const path of PAGES) {
  test(`axe: no WCAG 2.1 AA violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
