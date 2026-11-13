import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";

import { signIn } from "./support";
import { admin, closeWork, seedWork, STUDENT } from "./work-seed";

// DAN-386 (M2.10-P02d, contract on #1836 c.6858305983): the teacher sets one
// work's language apart from its assignment's, on a page keyed by the
// assignment and the work's document id. One click sends one POST; the card
// then names the language in force. Every course, assignment and text is invented.
test.afterEach(closeWork);

const w = t.teacher.workLanguageException;
const names = t.workspace.upute.workLanguages;
const SAVE = /^\/api\/institution\/assignments\/[0-9a-f-]{36}\/students\/([0-9a-f-]{36})\/work-language$/;
const isSave = (request: Request) => request.method() === "POST" && SAVE.test(new URL(request.url()).pathname);

async function overrideOf(assignment: string): Promise<string[]> {
  return admin(async (client) => (await client.query<{ language: string }>(
    "SELECT work_language AS language FROM institution.work_language_override WHERE assignment_id = $1", [assignment])).rows
    .map((row) => row.language));
}

/** The student's work of the assignment, seeded by the admin login: the opening is not this spec's subject. */
async function seedDocument(assignment: string): Promise<string> {
  const documentId = `izmisljeni-rad-${Date.now().toString(36)}`;
  await admin(async (client) => {
    await client.query("BEGIN");
    const { rows: [who] } = await client.query<{ id: string; institution: string }>(
      "SELECT id, institution_id AS institution FROM identity.user_account WHERE hr_edu_person_unique_id = $1", [STUDENT]);
    const project = `project-${documentId}`;
    await client.query("INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES ($1, $2, $3, $4)",
      [project, who!.institution, assignment, who!.id]);
    await client.query(
      `INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_revision, current_content_hash)
       VALUES ($1, $2, $3, $4, 0, $5)`, [documentId, who!.institution, project, who!.id, "a".repeat(64)]);
    await client.query(
      `INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
       VALUES ($1, $2, 0, NULL, $3, $4)`, [documentId, who!.institution, who!.id, "a".repeat(64)]);
    await client.query("COMMIT");
  });
  return documentId;
}

async function shoot(page: Page, name: string): Promise<void> {
  const toggle = page.getByRole("button", { name: t.shell.theme });
  for (let i = 0; i < 2; i += 1) {
    const theme = await page.locator("[data-theme]").first().getAttribute("data-theme");
    for (const width of [1440, 400]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
      await test.info().attach(`${name}-${theme}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await toggle.click();
  }
}

test("the teacher sets one work's language; one request, the exception stored and named", async ({ browser }) => {
  const student = await (await browser.newContext()).newPage();
  await signIn(student, "/rad");
  const page = await (await browser.newContext()).newPage();
  await signIn(page, "/", "Demo nastavnik");
  const assignment = await seedWork({ teacher: true });
  const documentId = await seedDocument(assignment);
  const posts: Request[] = [];
  page.on("request", (request) => { if (isSave(request)) posts.push(request); });

  await page.goto(`/nastavnik/zadatak/${assignment}/rad/${encodeURIComponent(documentId)}/jezik`);
  const card = page.getByRole("form", { name: w.link });
  await expect(card.getByText(w.current.replace("{language}", names.hr))).toBeVisible();
  await expect(card.getByRole("button", { name: w.save })).toBeDisabled();
  await shoot(page, "jezik-rada-studenta-pocetno");

  await card.getByRole("radio", { name: names.en, exact: true }).check();
  await expect(card.getByText(w.exceptionNote)).toBeVisible();
  await card.getByRole("button", { name: w.save }).dblclick();
  await expect(card.getByRole("status")).toContainText(w.saved.replace("{language}", names.en));
  await expect(card.getByText(w.current.replace("{language}", names.en))).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]!.postDataJSON()).toEqual({ language: "en" });
  // The student id goes only into the POST path; the page never shows it as text.
  const studentId = SAVE.exec(new URL(posts[0]!.url()).pathname)![1]!;
  expect(await page.locator("body").innerText()).not.toContain(studentId);
  expect(await overrideOf(assignment)).toEqual(["en"]);
  await shoot(page, "jezik-rada-studenta-spremljeno");
  await student.context().close();
});

test("someone else's or a made-up work reads as not found", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, "/", "Demo nastavnik");
  const assignment = await seedWork({ teacher: true });
  await page.goto(`/nastavnik/zadatak/${assignment}/rad/izmisljeni-rad-koji-ne-postoji/jezik`);
  // Next's route announcer is also role=alert (empty); the page's own alert is the other one.
  await expect(page.getByRole("alert").and(page.locator(":not(#__next-route-announcer__)"))).toHaveText(w.notFound);
  await expect(page.getByRole("form", { name: w.link })).toHaveCount(0);
});
