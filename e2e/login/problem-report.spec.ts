import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

import { THEME_KEY } from "../../src/components/shell/theme";
import { messagesHr } from "../../src/lib/i18n/messages.hr";
import { signIn } from "./support";

// DAN-431 (Z-10): "Prijavi problem" in the shell of a signed-in person. The
// route's answers are given here, so no report reaches the database and every
// refusal can be shown; the description is invented.

const t = messagesHr.support;
const ENDPOINT = "**/api/support/problem-report";
const DESCRIPTION = "Gumb za slanje ne reagira na prvi klik.";

async function openDialog(page: Page, signedIn = false) {
  if (!signedIn) await signIn(page, "/upis");
  const opener = page.getByRole("button", { name: t.open });
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: t.title })).toBeVisible();
  // The heading, and so the name, changes once the report is sent.
  return { opener, dialog: page.getByRole("dialog") };
}

test("the dialog is reachable by keyboard, passes axe and gives focus back", async ({ page }) => {
  const { opener, dialog } = await openDialog(page);
  await expect(dialog.getByRole("heading", { name: t.title })).toBeFocused();

  // Heading, then the chosen category, then the description.
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("radio", { name: new RegExp(t.category.technical.label) })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(dialog.getByRole("radio", { name: new RegExp(t.category.account.label) })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("textbox", { name: t.description })).toBeFocused();

  const results = await new AxeBuilder({ page }).include("dialog").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("an empty description is named at the field and nothing is sent", async ({ page }) => {
  let requests = 0;
  await page.route(ENDPOINT, (route) => {
    requests += 1;
    return route.abort();
  });
  const { dialog } = await openDialog(page);
  await dialog.getByRole("button", { name: t.send }).click();
  const field = dialog.getByRole("textbox", { name: t.description });
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByText(t.check.empty)).toBeVisible();
  expect(requests).toBe(0);
});

for (const [status, reason] of [
  [413, "tooLarge"],
  [422, "invalid"],
  [429, "tooMany"],
] as const) {
  test(`a ${status} answer reads in plain words and keeps the description`, async ({ page }) => {
    await page.route(ENDPOINT, (route) => route.fulfill({ status, json: { error: "x" } }));
    const { dialog } = await openDialog(page);
    const field = dialog.getByRole("textbox", { name: t.description });
    await field.fill(DESCRIPTION);
    await dialog.getByRole("button", { name: t.send }).click();
    await expect(dialog.getByRole("alert")).toHaveText(`${t.failedLead} ${t.failure[reason]}`);
    await expect(field).toHaveValue(DESCRIPTION);
    await expect(dialog.getByRole("button", { name: t.retry })).toBeEnabled();
  });
}

test("a double click and a resend while sending make one request, then the reference shows", async ({ page }) => {
  const held: Route[] = [];
  const bodies: string[] = [];
  await page.route(ENDPOINT, (route) => {
    bodies.push(route.request().postData() ?? "");
    held.push(route);
  });
  const { dialog } = await openDialog(page);
  await dialog.getByRole("textbox", { name: t.description }).fill(DESCRIPTION);
  const send = dialog.getByRole("button", { name: t.send });
  await send.dblclick();
  await expect(dialog.getByText(t.sending)).toBeVisible();
  await expect(send).toBeDisabled();
  // Enter in the form while the first is in flight changes nothing.
  await dialog.getByRole("textbox", { name: t.description }).press("Control+Enter");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(held).toHaveLength(1);

  await held[0]!.fulfill({ status: 201, json: { reference: "PR-3FA9C01B2E" } });
  await expect(dialog.getByRole("heading", { name: t.sentTitle })).toBeFocused();
  await expect(dialog.getByText(t.sentReference.replace("{reference}", "PR-3FA9C01B2E"))).toBeVisible();
  expect(bodies).toHaveLength(1);
  const sent = JSON.parse(bodies[0]!) as { description: string; route: string | null };
  expect(sent.description).toBe(DESCRIPTION);
  expect(sent.route).not.toContain("0000");
});

// Shots beside docs/design/ductura (§6.5, D-183): the form, a refusal and the
// sent report, both themes, 1440 and 400 px, full page.
test("shots of the dialog in each state", async ({ page }) => {
  await page.route(ENDPOINT, (route) => route.fulfill({ status: 429, json: { error: "too_many_reports" } }));
  await signIn(page, "/upis");
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [THEME_KEY, theme]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const { dialog } = await openDialog(page, true);
    await dialog.getByRole("textbox", { name: t.description }).fill(DESCRIPTION);
    await shootWidths(page, `prijava-problema-obrazac-${theme}`);
    await dialog.getByRole("button", { name: t.send }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await shootWidths(page, `prijava-problema-429-${theme}`);
    await page.unroute(ENDPOINT);
    await page.route(ENDPOINT, (route) => route.fulfill({ status: 201, json: { reference: "PR-3FA9C01B2E" } }));
    await dialog.getByRole("button", { name: t.retry }).click();
    await expect(dialog.getByRole("heading", { name: t.sentTitle })).toBeVisible();
    await shootWidths(page, `prijava-problema-poslano-${theme}`);
    await page.unroute(ENDPOINT);
    await page.route(ENDPOINT, (route) => route.fulfill({ status: 429, json: { error: "too_many_reports" } }));
  }
});

async function shootWidths(page: Page, name: string): Promise<void> {
  for (const width of [1440, 400]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await test.info().attach(`${name}-${width}`, {
      body: await page.screenshot({ fullPage: true, animations: "disabled" }),
      contentType: "image/png",
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}
