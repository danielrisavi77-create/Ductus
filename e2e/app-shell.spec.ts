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

// Cut (b): the student screens outside /rad get the same shell; signed out,
// still no items and no account.
for (const path of ["/upis", "/upis/kolegij/00000000-0000-4000-8000-000000000000", "/zadatak/00000000-0000-4000-8000-000000000000"]) {
  test(`signed out, ${path} is inside the shell without navigation`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("complementary", { name: t.shell.sideNav, includeHidden: true })).toBeAttached();
    await expect(page.getByRole("navigation", { name: t.shell.workNav })).toHaveCount(0);
    await expect(page.getByRole("button", { name: t.shell.signOut })).toHaveCount(0);
    await expect(page.locator("main#sadrzaj")).toHaveCount(1);
    await expect(page.getByRole("link", { name: t.student.signIn })).toBeVisible();
  });
}

test("the theme switch turns the shell light and the browser remembers it", async ({ page }) => {
  await page.goto(PATH);
  const shell = page.locator("[data-theme]").first();
  await expect(shell).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: t.shell.theme }).click();
  await expect(shell).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("[data-theme]").first()).toHaveAttribute("data-theme", "light");
  for (const path of [PATH, "/nastavnik", "/nastavnik/brz-put", "/upis", "/zadatak/00000000-0000-4000-8000-000000000000"]) {
    await page.goto(path);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations, path).toEqual([]);
  }
  // Pages outside the shell keep their own look.
  await page.goto("/prijava");
  await expect(page.locator("[data-theme]")).toHaveCount(0);
});

test("the focused skip link is drawn above the side bar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(PATH);
  const skip = page.getByRole("link", { name: t.shell.skipToContent });
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  const onTop = await skip.evaluate((link) => {
    const box = link.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit !== null && link.contains(hit);
  });
  expect(onTop).toBe(true);
});

test("the saved theme holds after a client-side navigation into another shell page", async ({ page }) => {
  await page.goto(PATH);
  await page.getByRole("button", { name: t.shell.theme }).click();
  await expect(page.locator("[data-theme]").first()).toHaveAttribute("data-theme", "light");
  await page.evaluate(() => { (window as unknown as { stayed: boolean }).stayed = true; });
  await page.getByRole("main").getByRole("link", { name: t.teacher.backCourses }).click();
  await expect(page).toHaveURL(/\/nastavnik$/);
  expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true);
  await expect(page.locator("[data-theme]").first()).toHaveAttribute("data-theme", "light");
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
    // Focus moves into the drawer and the page behind it cannot be reached.
    await expect(aside.getByRole("link", { name: t.shell.home })).toBeFocused();
    await expect(page.locator("main#sadrzaj")).toHaveAttribute("inert", "");
    await page.keyboard.press("Escape");
    await expect(aside).toBeHidden();
    await expect(page.getByRole("button", { name: t.shell.openNav })).toBeFocused();
    await expect(page.locator("main#sadrzaj")).not.toHaveAttribute("inert", "");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe("at 390 px without JavaScript", () => {
  test.use({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });

  test("the side bar stays in the page above the content and ☰ is not offered", async ({ page }) => {
    await page.goto(PATH);
    const aside = page.getByRole("complementary", { name: t.shell.sideNav });
    await expect(aside).toBeVisible();
    await expect(aside.getByRole("link", { name: t.shell.home })).toBeInViewport();
    await expect(page.getByRole("button", { name: t.shell.openNav })).toBeHidden();
    await expect(page.getByText(t.teacher.signedOut)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

for (const [width, min] of [[1440, 12], [390, 13]] as const) {
  test(`shell text at ${width} px is at least ${min} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PATH);
    if (width < 800) await page.getByRole("button", { name: t.shell.openNav }).click();
    const small = await page.locator("#bocna-navigacija, header").evaluateAll((roots, limit) => {
      const found: string[] = [];
      for (const root of roots) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const element = node.parentElement;
          if (!element || !node.textContent?.trim()) continue;
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const size = parseFloat(getComputedStyle(element).fontSize);
          if (size < limit) found.push(`${size}px: ${node.textContent.trim()}`);
        }
      }
      return found;
    }, min);
    expect(small).toEqual([]);
  });
}
