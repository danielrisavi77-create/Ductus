import { expect, test, type Page } from "@playwright/test";

import { messagesHr } from "../src/lib/i18n/messages.hr";
import { installTeacherRolesHarness, openTeacherRolesHarness, prepareTeacherRolesHarness } from "./support/teacher-roles-harness";

/**
 * DAN-581 (A-02, plan #1592 C1, contract #1091 `issuecomment-6674260401`):
 * the mounted dialog sends one request per confirmation, however often its
 * button is pressed while the reply waits, and cannot be left until the reply
 * comes. The routes are answered here; every person and id is invented.
 */

const t = messagesHr.teacherRoles;
const PERSON = "00000000-0000-4000-8000-000000000001";
const CONFIRM_PATH = `/api/institution/teachers/${PERSON}/role-confirmation`;

/** Holds every role request until `release`, and records what reached the server. */
async function holdRoleRoutes(page: Page) {
  const sent: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/institution/teachers/**", async (route) => {
    const request = route.request();
    sent.push(`${request.method()} ${new URL(request.url()).pathname} ${request.postData() ?? ""}`);
    await held;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ confirmed: true }) });
  });
  return { sent, release };
}

async function openConfirmDialog(page: Page) {
  await page.getByRole("listitem").filter({ hasText: "Osoba A (test)" }).getByRole("button", { name: t.confirmAction }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

const refreshes = (page: Page) => page.evaluate(() => window.__roles!.refreshes);

test.describe("teacher roles dialog (DAN-581)", () => {
  // Playwright requires the first argument to be a destructuring pattern.
  test.beforeAll(async ({}, testInfo) => {
    // Bundling the harness is not part of any test's time.
    testInfo.setTimeout(180_000);
    await prepareTeacherRolesHarness(testInfo.project.outputDir);
  });

  test.beforeEach(async ({ context, page }) => {
    await installTeacherRolesHarness(context);
    await openTeacherRolesHarness(page);
  });

  test("a double click while the reply waits sends one request", async ({ page }) => {
    const { sent, release } = await holdRoleRoutes(page);
    const dialog = await openConfirmDialog(page);
    await dialog.getByRole("button", { name: t.confirmAction }).dblclick();
    await expect.poll(() => sent.length).toBe(1);
    await expect(dialog.getByRole("button", { name: t.confirmAction })).toBeDisabled();

    release();
    await expect(page.getByRole("status")).toHaveText(t.outcome.confirmed);
    await expect(dialog).toBeHidden();
    expect(sent).toEqual([`POST ${CONFIRM_PATH} {}`]);
    expect(await refreshes(page)).toBe(1);
  });

  test("two clicks in one task, before React renders again, send one request", async ({ page }) => {
    const { sent, release } = await holdRoleRoutes(page);
    const dialog = await openConfirmDialog(page);
    // The second click sees the step of the first render: only the in-flight guard stops it.
    await dialog.getByRole("button", { name: t.confirmAction }).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect.poll(() => sent.length).toBe(1);

    release();
    await expect(page.getByRole("status")).toHaveText(t.outcome.confirmed);
    expect(sent).toEqual([`POST ${CONFIRM_PATH} {}`]);
    expect(await refreshes(page)).toBe(1);
  });

  test("Escape and the backdrop do not leave the dialog while the reply waits", async ({ page }) => {
    const { sent, release } = await holdRoleRoutes(page);
    const dialog = await openConfirmDialog(page);
    await dialog.getByRole("button", { name: t.confirmAction }).click();
    await expect.poll(() => sent.length).toBe(1);

    // Twice: Chromium closes a modal on a repeated Escape without a new user activation.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: t.cancel })).toBeDisabled();
    expect(await refreshes(page)).toBe(0);

    release();
    await expect(page.getByRole("status")).toHaveText(t.outcome.confirmed);
    await expect(dialog).toBeHidden();
    expect(sent).toHaveLength(1);
  });

  test("before sending, Escape cancels and sends nothing", async ({ page }) => {
    const { sent } = await holdRoleRoutes(page);
    const dialog = await openConfirmDialog(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(sent).toEqual([]);
    expect(await refreshes(page)).toBe(0);
  });
});
