import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";

import { signIn } from "./support";
import { admin, closeWork, seedWork } from "./work-seed";

// DAN-344 S03-a (#923 c.6545848868): the header of the notice as in
// S03_upute.png. The course eyebrow comes from the student's own list;
// the kicker, the title and the "{type} · {range}" | "Rok: …" line from the
// notice. Every course, assignment and account is invented.
const s = t.student;

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

test("S03-a: the student's own course above the notice, “Prije pisanja”, one h1, no opening date", async ({ page }) => {
  await signIn(page, "/zadaci");
  const assignment = await seedWork({ acknowledged: false });
  const course = await courseOf(assignment);
  await page.goto(`/zadatak/${assignment}`);

  const eyebrow = page.locator("[data-motif]");
  await expect(eyebrow).toHaveCount(1);
  await expect(eyebrow).toContainText(s.courseEyebrow);
  await expect(eyebrow).toContainText(course);
  await expect(page.getByText(s.step, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByText(/^Rok: \d/)).toBeVisible();
  await expect(page.getByText("otvoreno od")).toHaveCount(0);
  // The notice and its form are there as before.
  await expect(page.getByRole("checkbox", { name: s.checkbox })).toBeVisible();

  const shoot = async (name: string, width: number) => {
    await page.setViewportSize({ width, height: 900 });
    // Let the side navigation finish its slide before the shot.
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await test.info().attach(`s03a-${name}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
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

test("S03-a: a teacher on a notice sees no course eyebrow", async ({ browser, page }) => {
  // seedWork needs both demo accounts to have signed in once.
  const student = await browser.newPage();
  await signIn(student, "/zadaci");
  await student.close();
  await signIn(page, "/", "Demo nastavnik");
  const assignment = await seedWork({ acknowledged: false, teacher: true });
  await page.goto(`/zadatak/${assignment}`);
  await expect(page.getByRole("link", { name: t.teacher.backHome })).toBeVisible();
  await expect(page.locator("[data-motif]")).toHaveCount(0);
});
