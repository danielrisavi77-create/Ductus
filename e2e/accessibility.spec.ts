import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Every page added later gets a row here; WCAG 2.1 AA is the pilot target.
const PAGES = ["/", "/rad", "/nastavnik/kolegiji", "/zadatak/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "/upis",
  "/upis/kolegij/cccccccc-cccc-4ccc-8ccc-cccccccccccc", "/prijava"];

// The shell is always dark (D-115); the sheet is dark by default and has a
// white theme with its own tokens (D-123), so each sheet theme is checked on its own.
const SCHEMES = ["light", "dark"] as const;

/** Chooses the sheet theme the way a writer does: the switch, on /rad the "Prikaz" menu (FE-D5). */
async function chooseSheetTheme(page: Page, theme: (typeof SCHEMES)[number]) {
  if (theme === "dark") return;
  const view = page.getByRole("toolbar", { name: "Oblikovanje teksta" }).getByRole("button", { name: "Prikaz" });
  if (await view.isVisible()) {
    await view.click();
    await page.getByRole("menuitemradio", { name: "Bijeli list" }).click();
  } else {
    await page.getByRole("button", { name: "Bijeli list" }).click();
  }
  await expect(page.locator("article.sheet")).toHaveAttribute("data-sheet-theme", "light");
}

for (const path of PAGES) {
  for (const colorScheme of SCHEMES) {
    test(`axe: no WCAG 2.1 AA violations on ${path} (sheet: ${colorScheme})`, async ({ page }) => {
      await page.goto(path);
      // The home page's preview carries the same sheet switch (FE-H1).
      if (path === "/rad" || path === "/") await chooseSheetTheme(page, colorScheme);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
}

// Below 1240 px (structure) and 1000 px (panel) the rails are sections that
// open with a button (DAN-131, FE-D2);
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
