import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";

import { signIn } from "./support";
import { admin, closeWork, seedWork, workDocument } from "./work-seed";

// DAN-344: /zadaci as Archivum S01. The student's own courses, each with its
// assignments, from the existing read; opening one goes through /rad, which
// sends the unconfirmed current notice first and, after the confirmation,
// back into the same work. Every course, assignment and account is invented.
const home = t.student.home;
const OPEN = 30_000;

test.afterEach(closeWork);

/** The name of the invented course an assignment of seedWork sits in. */
async function courseOf(assignment: string): Promise<string> {
  return admin(async (client) => {
    const { rows: [row] } = await client.query<{ name: string }>(
      `SELECT c.name FROM institution.assignment a JOIN institution.course c ON c.id = a.course_id WHERE a.id = $1`,
      [assignment]);
    return row!.name;
  });
}

async function writable(page: Page): Promise<void> {
  await expect(page.getByRole("textbox", { name: t.workspace.documentLabel }))
    .toHaveAttribute("contenteditable", "true", { timeout: OPEN });
}

test("S02: assignments sit under their own course, and the notice comes first, then the same work", async ({ page }) => {
  await signIn(page, "/zadaci");
  const unread = await seedWork({ acknowledged: false });
  const read = await seedWork({ acknowledged: true });
  const [unreadCourse, readCourse] = [await courseOf(unread), await courseOf(read)];
  await page.reload();

  await expect(page.getByRole("heading", { level: 1, name: home.heading })).toBeVisible();
  const first = page.getByRole("region", { name: unreadCourse });
  const second = page.getByRole("region", { name: readCourse });
  await expect(first.getByRole("link")).toHaveCount(1);
  await expect(second.getByRole("link")).toHaveCount(1);
  await expect(first.getByRole("link")).toHaveAttribute("href", `/rad?zadatak=${unread}`);
  await expect(first.getByRole("link")).toContainText(home.readNotice);
  await expect(second.getByRole("link")).toHaveAttribute("href", `/rad?zadatak=${read}`);
  await expect(second.getByRole("link")).toContainText(home.open);

  // First entry: /rad sends the unconfirmed current version to its notice.
  await first.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/zadatak/${unread}$`));
  await page.getByRole("checkbox", { name: t.student.checkbox }).check();
  await page.getByRole("button", { name: t.student.confirm }).click();
  const onward = page.getByRole("link", { name: t.student.openEditor });
  await expect(onward).toHaveAttribute("href", `/rad?zadatak=${unread}`);
  await onward.click();
  await expect(page).toHaveURL(new RegExp(`/rad\\?zadatak=${unread}$`));
  // DAN-330: the work starts on the student's click.
  await page.getByRole("button", { name: t.workspace.startWork }).click();
  await writable(page);
  const document = await workDocument(unread);

  // Back on the home the same assignment opens the work, past the notice, into the same document.
  await page.goto("/zadaci");
  const again = page.getByRole("region", { name: unreadCourse }).getByRole("link");
  await expect(again).toContainText(home.open);
  await again.click();
  await expect(page).toHaveURL(new RegExp(`/rad\\?zadatak=${unread}$`));
  await writable(page);
  expect(await workDocument(unread)).toBe(document);
});

test("S01 in the dark and light theme and at 390 px, without a sideways scroll", async ({ page }) => {
  await signIn(page, "/zadaci");
  await seedWork({ acknowledged: false });
  await seedWork({ acknowledged: true });
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: home.courses })).toBeVisible();

  const shoot = async (name: string, width: number) => {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await test.info().attach(`s01-${name}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  };

  await shoot("tamna", 1440);
  await shoot("tamna", 390);
  await page.getByRole("button", { name: t.shell.theme }).click();
  await expect(page.locator("[data-theme]").first()).toHaveAttribute("data-theme", "light");
  await shoot("svijetla", 390);
  await shoot("svijetla", 1440);
});
