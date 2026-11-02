import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";

import { signIn } from "./support";
import { admin, closeWork, seedWork } from "./work-seed";

// DAN-344, Archivum S02 on /zadaci/kolegiji: the student's own courses and
// their assignments, from the same read as /zadaci, reached from the side
// navigation. Every course, assignment and account is invented.
const home = t.student.home;

test.afterEach(closeWork);

async function courseOf(assignment: string): Promise<string> {
  return admin(async (client) => (await client.query<{ name: string }>(
    "SELECT c.name FROM institution.assignment a JOIN institution.course c ON c.id = a.course_id WHERE a.id = $1",
    [assignment])).rows[0]!.name);
}

test("S02: the side navigation leads to the own courses, each assignment still through /rad", async ({ page }) => {
  await signIn(page, "/zadaci");
  const unread = await seedWork({ acknowledged: false });
  const course = await courseOf(unread);
  await page.reload();

  const nav = page.getByRole("navigation", { name: t.shell.workNav });
  await nav.getByRole("link", { name: t.shell.nav.courses }).click();
  await expect(page).toHaveURL(/\/zadaci\/kolegiji$/);
  await expect(nav.getByRole("link", { name: t.shell.nav.courses })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1, name: home.courses })).toBeVisible();
  await expect(page.getByText(home.coursesLede)).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: t.student.assignments.enroll })).toHaveCount(0);

  const card = page.getByRole("region", { name: course }).getByRole("link");
  await expect(card).toHaveAttribute("href", `/rad?zadatak=${unread}`);
  await expect(card).toContainText(home.readNotice);
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/zadatak/${unread}$`));
});

test("S02 in the dark and light theme and at 390 px, without a sideways scroll", async ({ page }) => {
  await signIn(page, "/zadaci/kolegiji");
  await seedWork({ acknowledged: false });
  await seedWork({ acknowledged: true });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: home.courses })).toBeVisible();

  const shoot = async (name: string, width: number) => {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await test.info().attach(`s02-${name}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  };
  await shoot("tamna", 1440);
  await shoot("tamna", 390);
  await page.getByRole("button", { name: t.shell.theme }).click();
  await expect(page.locator("[data-theme]").first()).toHaveAttribute("data-theme", "light");
  await shoot("svijetla", 390);
  await shoot("svijetla", 1440);
});
