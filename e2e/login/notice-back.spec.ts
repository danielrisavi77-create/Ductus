import { expect, test } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";

import { signIn } from "./support";
import { closeWork, seedWork } from "./work-seed";

// DAN-344 (Archivum S03): from the notice of an assignment the student goes
// back to /zadaci, her own courses and assignments. Every course, assignment
// and account is invented.
test.afterEach(closeWork);

test("the notice leads the student back to her courses and assignments", async ({ page }) => {
  await signIn(page, "/zadaci");
  const assignment = await seedWork({ acknowledged: false });
  await page.goto(`/zadatak/${assignment}`);
  await expect(page.getByText(t.student.checkbox)).toBeVisible();

  const back = page.getByRole("link", { name: t.student.backToAssignments });
  await expect(back).toHaveAttribute("href", "/zadaci");
  await test.info().attach("s03-povratak", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await back.click();
  await expect(page).toHaveURL(/\/zadaci$/);
  // The same assignment is there, and still goes through /rad.
  await expect(page.locator(`a[href="/rad?zadatak=${assignment}"]`)).toHaveCount(1);
});

test("a teacher on a notice gets no way to a student's list", async ({ browser, page }) => {
  // seedWork needs both demo accounts to have signed in once.
  const student = await browser.newPage();
  await signIn(student, "/zadaci");
  await student.close();
  await signIn(page, "/", "Demo nastavnik");
  const assignment = await seedWork({ acknowledged: false, teacher: true });
  await page.goto(`/zadatak/${assignment}`);
  await expect(page.getByRole("link", { name: t.teacher.backHome })).toBeVisible();
  await expect(page.getByRole("link", { name: t.student.backToAssignments })).toHaveCount(0);
});
