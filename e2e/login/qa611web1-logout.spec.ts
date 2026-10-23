import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { appCookie, logoutDialogOf, SESSION_COOKIE, sessionRow, signIn } from "./support";

// Independent QA, real fake-OIDC + database + browser, unchanged login runner.
test("qa611web1: mobile nested dialog, failed logout, retry and account isolation", async ({ page, context }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "/rad");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  const editor = page.getByRole("textbox", { name: t.workspace.documentLabel });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.fill("Samo za sintetičku studenticu QA611.");
  await expect(page.locator(".sync-chip")).toHaveAttribute("data-state", "LOCAL_DURABLE");
  await page.getByRole("button", { name: t.shell.openNav }).click();
  const nav = page.getByRole("navigation", { name: t.shell.workNav });
  await expect(nav.getByRole("link")).toHaveText([t.shell.nav.workspace, t.shell.nav.enroll]);
  await expect(nav.getByRole("link", { name: t.shell.nav.workspace })).toHaveAttribute("aria-current", "page");
  const logout = page.getByRole("button", { name: t.auth.logout, exact: true });
  await expect(logout).toHaveCount(1);
  await logout.click();
  const dialog = logoutDialogOf(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: t.auth.logoutStay })).toBeFocused();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  await info.attach("mobile-logout-axe", { body: JSON.stringify(axe.violations), contentType: "application/json" });
  expect.soft(axe.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: t.shell.closeNav })).toHaveAttribute("aria-expanded", "true");
  await expect(logout).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: t.shell.openNav })).toBeFocused();
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await page.getByRole("button", { name: t.shell.openNav }).click();
  await page.route("**/api/auth/logout", route => route.abort("internetdisconnected"));
  await logout.click();
  await dialog.getByRole("button", { name: t.auth.logoutConfirm }).click();
  await expect(dialog.getByRole("alert")).toHaveText(t.auth.logoutFailed);
  expect(await sessionRow(token)).toMatchObject({ closed_at: null });
  await page.unroute("**/api/auth/logout");
  await dialog.getByRole("button", { name: t.auth.logoutConfirm }).click();
  await page.waitForURL("http://localhost:3000/");
  expect(await appCookie(context, SESSION_COOKIE)).toBeUndefined();
  expect(await sessionRow(token)).toMatchObject({ close_reason: "logout", closed_at: expect.any(Date) });
  await context.clearCookies({ name: /^_session/ });
  await signIn(page, "/rad", "Demo student 2");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(editor).toHaveText("");
});

test("qa611web1: resize across drawer boundary while logout dialog is open", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "/rad");
  await expect(page.getByRole("textbox", { name: t.workspace.documentLabel })).toHaveAttribute("contenteditable", "true");
  await page.getByRole("button", { name: t.shell.openNav }).click();
  await page.getByRole("button", { name: t.auth.logout, exact: true }).click();
  const dialog = logoutDialogOf(page);
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 1050, height: 844 });
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: t.auth.logoutStay }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: t.workspace.documentLabel })).toHaveAttribute("contenteditable", "true");
});

for (const width of [1440, 390]) {
  test(`qa611web1: no JavaScript logout at ${width}px closes the real session`, async ({ page, browser }) => {
    await signIn(page, "/rad");
    const token = (await appCookie(page.context(), SESSION_COOKIE))!.value;
    const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 1000 }, storageState: await page.context().storageState() });
    try {
      const p = await nojs.newPage();
      await p.goto("http://localhost:3000/rad");
      await expect(p.locator("main#sadrzaj")).toHaveCount(1);
      const logout = p.getByRole("button", { name: t.auth.logout, exact: true });
      await expect(logout).toHaveCount(1);
      await logout.click();
      await p.waitForURL("http://localhost:3000/");
      expect(await appCookie(nojs, SESSION_COOKIE)).toBeUndefined();
      expect(await sessionRow(token)).toMatchObject({ close_reason: "logout", closed_at: expect.any(Date) });
    } finally { await nojs.close(); }
  });
}

test("qa611web1: teacher role at workspace stays teacher; invalid cookie shows no role", async ({ page, context }) => {
  await signIn(page, "/rad", "Demo nastavnik");
  await expect(page.getByRole("navigation", { name: t.shell.workNav }).getByRole("link")).toHaveText([
    t.shell.nav.courses, t.shell.nav.newCourse, t.shell.nav.fastPath,
  ]);
  await context.addCookies([{ name: SESSION_COOKIE, value: "Q".repeat(43), domain: "localhost", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
  await page.goto("/rad");
  await expect(page.getByRole("navigation", { name: t.shell.workNav })).toHaveCount(0);
  await expect(page.getByRole("button", { name: t.auth.logout, exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: t.auth.signIn })).toBeVisible();
  await expect(page.getByRole("textbox", { name: t.workspace.documentLabel })).toHaveAttribute("aria-disabled", "true");
});
