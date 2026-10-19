import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { messagesHr as t } from "../src/lib/i18n/messages.hr";

// Public home page for a visitor without a session (FE-H1, #476).

test.describe("public home page", () => {
  test("a visitor without a session sees the home page with its sections", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(t.landing.title);
    await expect(page.getByRole("heading", { level: 2, name: t.landing.forWhomTitle })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: t.landing.howTitle })).toBeVisible();
    await expect(page.locator("#kako-radi ol > li")).toHaveCount(4);
    await expect(page.getByRole("figure", { name: t.landing.previewLabel })).toBeVisible();
    await expect(page.getByText(t.landing.aaiOnly)).toBeVisible();
  });

  test("every way in is a plain link to /prijava", async ({ page }) => {
    await page.goto("/");
    const entries = page.getByRole("link", { name: new RegExp(`^(${t.auth.signIn}|${t.landing.enter})$`) });
    await expect(entries).toHaveCount(3);
    for (const entry of await entries.all()) await expect(entry).toHaveAttribute("href", "/prijava");
    await page.getByRole("link", { name: t.landing.enter }).click();
    await expect(page).toHaveURL(/\/prijava$/);
  });

  test("the section links lead to their sections", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: t.landing.sectionsNav });
    await nav.getByRole("link", { name: t.landing.forWhomLink }).click();
    await expect(page).toHaveURL(/#za-koga$/);
    await expect(page.locator("#za-koga")).toBeInViewport();
  });

  test("the skip link moves focus to the content", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: t.shell.skipToContent })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#sadrzaj")).toBeFocused();
  });

  for (const sheet of ["dark", "light"] as const) {
    test(`axe: no WCAG 2.1 AA violations (sheet: ${sheet})`, async ({ page }) => {
      await page.goto("/");
      if (sheet === "light") {
        await page.getByRole("button", { name: t.workspace.sheetThemeLight }).click();
        await expect(page.locator("article.sheet")).toHaveAttribute("data-sheet-theme", "light");
      }
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }

  test("at 390 px nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  });

  test("with reduced motion the page has no running transition or animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const moving = await page.evaluate(() =>
      [...document.querySelectorAll("body *")].filter((element) => {
        const style = getComputedStyle(element);
        const seconds = (value: string) => Math.max(...value.split(",").map((part) => parseFloat(part) || 0));
        return seconds(style.transitionDuration) > 0 || style.animationName !== "none";
      }).length,
    );
    expect(moving).toBe(0);
  });
});
