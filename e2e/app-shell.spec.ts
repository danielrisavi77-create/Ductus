import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { messagesHr as t } from "../src/lib/i18n/messages.hr";

// Design v3 shell, cut (a): the teacher routes (#476 6314969336). Signed out
// here, so the shell shows no navigation and no account (I2, I3); the signed-in
// teacher's items are checked in e2e/login/teacher-home.spec.ts.
const PATH = "/nastavnik/zadatak/novi";

test("a signed-out visitor gets the shell without navigation or account", async ({ page }) => {
  await page.goto(PATH);
  await expect(page.getByRole("complementary", { name: t.shell.sideNav, includeHidden: true })).toBeAttached();
  await expect(page.getByRole("navigation", { name: t.shell.workNav })).toHaveCount(0);
  await expect(page.getByRole("button", { name: t.shell.signOut })).toHaveCount(0);
  await expect(page.locator("main#sadrzaj")).toHaveCount(1);
  await expect(page.getByText(t.teacher.signedOut)).toBeVisible();
});

test("the theme switch turns the shell light and the browser remembers it", async ({ page }) => {
  await page.goto(PATH);
  const shell = page.locator("[data-theme]").first();
  await expect(shell).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: t.shell.theme }).click();
  await expect(shell).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("[data-theme]").first()).toHaveAttribute("data-theme", "light");
  for (const path of [PATH, "/nastavnik", "/nastavnik/brz-put"]) {
    await page.goto(path);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations, path).toEqual([]);
  }
  // Pages outside the shell keep their own look.
  await page.goto("/prijava");
  await expect(page.locator("[data-theme]")).toHaveCount(0);
});

test.describe("at 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the side bar is a drawer: ☰ opens it, Esc closes it and focus returns", async ({ page }) => {
    await page.goto(PATH);
    const aside = page.getByRole("complementary", { name: t.shell.sideNav });
    await expect(aside).toBeHidden();
    const menu = page.getByRole("button", { name: t.shell.openNav });
    await menu.click();
    await expect(aside).toBeVisible();
    await expect(page.getByRole("button", { name: t.shell.closeNav })).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(aside).toBeHidden();
    await expect(page.getByRole("button", { name: t.shell.openNav })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
