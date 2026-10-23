import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { messagesHr as t } from "../src/lib/i18n/messages.hr";

// Independent QA of source 3adeb1e3f08a93bdb50f599967c0177acea78e2c.
// Uses the unchanged standard runner, its local demo journal and real UI.
test("qa611web1: shell and sheet themes, landmarks and responsive boundaries", async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.goto("/rad");
  const editor = page.getByRole("textbox", { name: t.workspace.documentLabel });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.fill("Sintetički QA nacrt. ".repeat(20));
  await expect(page.locator(".sync-chip")).toHaveAttribute("data-state", "LOCAL_DURABLE");
  for (const width of [1440, 1251, 1250, 1051, 1050, 800, 799, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("#sadrzaj")).toHaveCount(1);
    expect(await page.locator(".workspace__body").evaluate(el => Array.from(el.children).map(c => c.tagName))).toEqual(["MAIN", "ASIDE", "ASIDE"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator(".workspace__status")).toBeVisible();
    await expect(page.locator(".workspace__status [role=status]")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: t.shell.workNav })).toHaveCount(0);
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const shell of ["dark", "light"] as const) {
      if (shell === "light") await page.getByRole("button", { name: t.shell.theme }).click();
      for (const sheet of ["dark", "light"] as const) {
        await page.getByRole("toolbar").getByRole("button", { name: "Prikaz", exact: true }).click();
        await page.getByRole("menuitemradio", { name: sheet === "light" ? "Bijeli list" : "Tamni list" }).click();
        await expect(page.locator("article.sheet")).toHaveAttribute("data-sheet-theme", sheet);
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        await info.attach(`axe-${width}-${shell}-${sheet}`, { body: JSON.stringify(axe.violations), contentType: "application/json" });
        expect.soft(axe.violations).toEqual([]);
        await info.attach(`screen-${width}-${shell}-${sheet}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      }
    }
    // Return the shell to dark before the next viewport.
    await page.getByRole("button", { name: t.shell.theme }).click();
  }
  await page.reload();
  await expect(editor).toHaveText("Sintetički QA nacrt. ".repeat(20).trim());
});

test("qa611web1: offline editing survives drawer, theme and reload", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/rad");
  const editor = page.getByRole("textbox", { name: t.workspace.documentLabel });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await context.setOffline(true);
  await editor.fill("Izmišljeni zapis tijekom prekida mreže.");
  await expect(page.locator(".sync-chip")).toHaveAttribute("data-state", "LOCAL_DURABLE");
  await page.getByRole("button", { name: t.shell.openNav }).click();
  expect(await editor.evaluate(el => el.closest("[inert]") !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: t.shell.openNav })).toBeFocused();
  expect(await editor.evaluate(el => el.closest("[inert]") !== null)).toBe(false);
  await page.getByRole("button", { name: t.shell.theme }).click();
  await context.setOffline(false);
  await page.reload();
  await expect(editor).toHaveText("Izmišljeni zapis tijekom prekida mreže.");
  await expect(page.locator(".sync-chip")).toHaveAttribute("data-state", "LOCAL_DURABLE");
  await expect(page.locator('[data-theme="light"]')).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Preskoči na sadržaj" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#sadrzaj")).toBeFocused();
});
