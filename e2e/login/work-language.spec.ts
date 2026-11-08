import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";

import { editorMounted, signIn } from "./support";
import { admin, closeWork, openWorkOf, seedWork, STUDENT } from "./work-seed";

// DAN-386 (M2.10-P02, contract on #1091): /rad names the language of the
// student's own work in Upute and marks the manuscript with it (WCAG 2.2
// 3.1.2, D-248), while the page keeps the interface language. The language
// comes from institution.work_language(), the override of the work or the
// assignment version's own. Every course, assignment and text is invented.
const OPEN = 30_000;

test.afterEach(closeWork);

const editorOf = (page: Page) => page.getByRole("textbox", { name: t.workspace.documentLabel });
const line = (language: "hr" | "en") =>
  t.workspace.upute.workLanguage.replace("{language}", t.workspace.upute.workLanguages[language]);

/** A teacher's override of one work, as the admin login, for a test whose subject is the student's view. */
async function overrideLanguage(assignment: string, language: "hr" | "en"): Promise<void> {
  await admin((client) => client.query(
    `INSERT INTO institution.work_language_override (institution_id, assignment_id, student_id, work_language, set_by)
     SELECT a.institution_id, a.id, u.id, $3, u.id
       FROM institution.assignment a JOIN identity.user_account u ON u.institution_id = a.institution_id
      WHERE a.id = $1 AND u.hr_edu_person_unique_id = $2`, [assignment, STUDENT, language]));
}

async function openUpute(page: Page) {
  const panel = page.getByRole("complementary", { name: t.workspace.sidePanel });
  await panel.getByRole("tab", { name: t.workspace.tabInstructions }).click();
  return panel.getByRole("tabpanel");
}

async function openSheet(page: Page, assignment: string): Promise<void> {
  await openWorkOf(page, assignment);
  await page.goto(`/rad?zadatak=${assignment}`);
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
  await editorMounted(page);
}

test("the assignment's own language: Croatian, named once in Upute and on the manuscript", async ({ page }) => {
  await signIn(page, "/rad");
  const assignment = await seedWork({ acknowledged: true });
  await openSheet(page, assignment);
  const upute = await openUpute(page);
  await expect(upute).toContainText(line("hr"));
  await expect(upute.getByText(line("hr"), { exact: true })).toHaveCount(1);
  await expect(page.locator(".editor-surface")).toHaveAttribute("lang", "hr");
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
});

test("a work's override to English marks only the manuscript; the interface stays Croatian", async ({ page }) => {
  await signIn(page, "/rad");
  const assignment = await seedWork({ acknowledged: true });
  await overrideLanguage(assignment, "en");
  await openSheet(page, assignment);
  const upute = await openUpute(page);
  await expect(upute).toContainText(line("en"));
  await expect(upute).not.toContainText(line("hr"));
  await expect(page.locator(".editor-surface")).toHaveAttribute("lang", "en");
  // The manuscript inherits the mark; the shell, the panel and the heading do not.
  expect(await editorOf(page).evaluate((node) => node.closest("[lang]")?.getAttribute("lang"))).toBe("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  expect(await upute.evaluate((node) => node.closest("[lang]")?.getAttribute("lang"))).toBe("hr");
  await expect(page.locator(".workspace__bar [lang]")).toHaveCount(0);

  // docs/SESSIONS.md §6: the full page, both themes, 1440 and 400 px, each with axe.
  const toggle = page.getByRole("button", { name: t.shell.theme });
  for (let i = 0; i < 2; i += 1) {
    const theme = await page.locator("[data-theme]").first().getAttribute("data-theme");
    for (const width of [1440, 400]) {
      await page.setViewportSize({ width, height: 900 });
      await test.info().attach(`jezik-rada-${theme}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await toggle.click();
  }
});

test("a draft without ?zadatak= names no language and marks nothing", async ({ page }) => {
  await signIn(page, "/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
  const upute = await openUpute(page);
  await expect(upute).toHaveText(t.workspace.instructionsEmpty);
  await expect(page.locator(".editor-surface")).not.toHaveAttribute("lang", /.*/);
});
