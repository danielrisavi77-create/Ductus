import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

import { CURRENT_KEY, SESSION_END_CHANNEL } from "../../src/client/session-marks";
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

// The workspace brings its own sign-out (LocalLogout, D-118); the report is
// still in its drawer, so a student need not leave the editor (Codex, #1967).
test("in the workspace the drawer offers the report beside its own sign-out", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "/rad");
  await expect(page.getByRole("banner").getByRole("button", { name: messagesHr.auth.logout, exact: true })).toBeVisible();
  await page.getByRole("button", { name: messagesHr.shell.openNav }).click();
  const side = page.getByRole("complementary", { name: messagesHr.shell.sideNav });
  await side.getByRole("button", { name: t.open }).click();
  const dialog = page.getByRole("dialog", { name: t.title });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: t.close }).click();
  await expect(dialog).toHaveCount(0);
});

// Below 800 px the side bar that holds the opener is hidden; the dialog lives
// in <body>, so narrowing the window while it is open keeps it on screen
// (Codex, #1967).
test("the dialog stays on screen when the side bar hides below 800 px", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { dialog } = await openDialog(page);
  await page.setViewportSize({ width: 400, height: 900 });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: t.title })).toBeVisible();
  expect(await dialog.evaluate((node) => node.parentElement === document.body)).toBe(true);
  await dialog.getByRole("textbox", { name: t.description }).fill(DESCRIPTION);
  await expect(dialog.getByRole("textbox", { name: t.description })).toHaveValue(DESCRIPTION);
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

// A 201 without a reference may still be recorded: the alert keeps the
// description and does not say the report was not sent (Grok review, #1967).
test("an unconfirmed answer does not claim the report was not sent", async ({ page }) => {
  await page.route(ENDPOINT, (route) => route.fulfill({ status: 201, json: {} }));
  const { dialog } = await openDialog(page);
  const field = dialog.getByRole("textbox", { name: t.description });
  await field.fill(DESCRIPTION);
  await dialog.getByRole("button", { name: t.send }).click();
  await expect(dialog.getByRole("alert")).toHaveText(`${t.keptLead} ${t.failure.unknown}`);
  await expect(field).toHaveValue(DESCRIPTION);
});

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

// Another person signing in in another tab leaves their cookie in this
// browser; the open dialog must not send the earlier description under it.
// The later sign-in is written where the other tab writes it, without the
// storage event, so only the check right before sending can see it (Codex,
// #1967).
test("a description written before someone else signed in is not sent", async ({ page }) => {
  let requests = 0;
  await page.route(ENDPOINT, (route) => {
    requests += 1;
    return route.fulfill({ status: 201, json: { reference: "PR-3FA9C01B2E" } });
  });
  const { dialog } = await openDialog(page);
  await dialog.getByRole("textbox", { name: t.description }).fill(DESCRIPTION);
  await page.evaluate((key) => {
    const mark = JSON.parse(localStorage.getItem(key) ?? "null") as { tag: string; at: number } | null;
    if (!mark) throw new Error("The signed-in page must record its session mark");
    localStorage.setItem(key, JSON.stringify({ tag: `${mark.tag}-other`, at: mark.at + 1 }));
  }, CURRENT_KEY);
  await dialog.getByRole("button", { name: t.send }).click();
  await expect(dialog.getByRole("alert")).toHaveText(t.ended);
  await expect(dialog.getByRole("heading", { name: t.title })).toBeFocused();
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  expect(requests).toBe(0);
});

test("a sign-out in another tab clears the open dialog", async ({ page }) => {
  const { dialog } = await openDialog(page);
  await dialog.getByRole("textbox", { name: t.description }).fill(DESCRIPTION);
  await page.evaluate(({ key, channelName }) => {
    const mark = JSON.parse(localStorage.getItem(key) ?? "null") as { tag: string } | null;
    if (!mark) throw new Error("The signed-in page must record its session mark");
    const channel = new BroadcastChannel(channelName);
    channel.postMessage(mark.tag);
    channel.close();
  }, { key: CURRENT_KEY, channelName: SESSION_END_CHANNEL });
  await expect(dialog.getByRole("alert")).toHaveText(t.ended);
  await expect(page.getByText(DESCRIPTION)).toHaveCount(0);
  await dialog.getByRole("button", { name: t.close }).click();
  await expect(dialog).toHaveCount(0);
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
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await test.info().attach(`${name}-${width}`, {
      body: await page.screenshot({ fullPage: true, animations: "disabled" }),
      contentType: "image/png",
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}
