import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";

import { signIn } from "./support";
import { admin, closeWork, seedWork } from "./work-seed";

// DAN-386 (M2.10-P02c, contract on #1836): the teacher changes the work
// language of an assignment on its edit page. One click sends one POST with the
// current version; the RPC publishes the next version, and the page then
// names the new language. Every course, assignment and text is invented.
test.afterEach(closeWork);

const w = t.teacher.workLanguage;
const names = t.workspace.upute.workLanguages;
const isSave = (request: Request) => request.method() === "POST" && /\/work-language$/.test(new URL(request.url()).pathname);

async function versionOf(assignment: string): Promise<{ version: number; language: string }> {
  return admin(async (client) => {
    const { rows: [row] } = await client.query<{ version: number; language: string }>(
      `SELECT a.current_version AS version, v.work_language AS language FROM institution.assignment a
         JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = a.current_version
        WHERE a.id = $1`, [assignment]);
    return row!;
  });
}

async function shoot(page: Page, name: string): Promise<void> {
  const toggle = page.getByRole("button", { name: t.shell.theme });
  for (let i = 0; i < 2; i += 1) {
    const theme = await page.locator("[data-theme]").first().getAttribute("data-theme");
    for (const width of [1440, 400]) {
      await page.setViewportSize({ width, height: 900 });
      // The shell closes its navigation on a narrow viewport with a transition; shoot the settled page.
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
      await test.info().attach(`${name}-${theme}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await toggle.click();
  }
}

test("the teacher changes the language once; one request, the next version, the new language named", async ({ browser }) => {
  const student = await (await browser.newContext()).newPage();
  await signIn(student, "/rad");
  const page = await (await browser.newContext()).newPage();
  await signIn(page, "/", "Demo nastavnik");
  const assignment = await seedWork({ teacher: true });
  const saves: Request[] = [];
  page.on("request", (request) => { if (isSave(request)) saves.push(request); });

  await page.goto(`/nastavnik/zadatak/${assignment}/uredi`);
  const card = page.getByRole("form", { name: w.heading });
  await expect(card.getByText(w.current.replace("{language}", names.hr))).toBeVisible();
  const save = card.getByRole("button", { name: w.saveIdle, exact: true });
  await expect(save).toBeDisabled();
  await shoot(page, "jezik-rada-nastavnik-pocetno");

  await card.getByRole("radio", { name: names.en }).check();
  await expect(card.getByText(w.consequence.replace("{n}", "2"))).toBeVisible();
  await card.getByRole("button", { name: w.save.replace("{language}", names.en) }).dblclick();
  await expect(card.getByRole("status")).toContainText(w.saved.replace("{n}", "2"));
  expect(saves).toHaveLength(1);
  expect(saves[0]!.postDataJSON()).toEqual({ expectedVersion: 1, language: "en" });
  expect(await versionOf(assignment)).toEqual({ version: 2, language: "en" });
  await shoot(page, "jezik-rada-nastavnik-spremljeno");

  await card.getByRole("link", { name: w.reload }).click();
  await expect(page.getByRole("form", { name: w.heading }).getByText(w.current.replace("{language}", names.en))).toBeVisible();
  await student.context().close();
});

test("a stale version is refused: no new version, the page offers a reload", async ({ browser }) => {
  const student = await (await browser.newContext()).newPage();
  await signIn(student, "/rad");
  const page = await (await browser.newContext()).newPage();
  await signIn(page, "/", "Demo nastavnik");
  const assignment = await seedWork({ teacher: true });
  await page.goto(`/nastavnik/zadatak/${assignment}/uredi`);
  const card = page.getByRole("form", { name: w.heading });
  await expect(card.getByText(w.current.replace("{language}", names.hr))).toBeVisible();

  // Another tab publishes version 2 meanwhile.
  const other = await page.context().newPage();
  await other.goto(`/nastavnik/zadatak/${assignment}/uredi`);
  const otherCard = other.getByRole("form", { name: w.heading });
  await otherCard.getByRole("radio", { name: names.en }).check();
  await otherCard.getByRole("button", { name: w.save.replace("{language}", names.en) }).click();
  await expect(otherCard.getByRole("status")).toBeVisible();

  await card.getByRole("radio", { name: names.en }).check();
  await card.getByRole("button", { name: w.save.replace("{language}", names.en) }).click();
  await expect(card.getByRole("alert")).toHaveText(w.errors.conflict);
  await expect(card.getByRole("link", { name: w.reload })).toBeVisible();
  expect(await versionOf(assignment)).toEqual({ version: 2, language: "en" });
  await shoot(page, "jezik-rada-nastavnik-sukob");
  await student.context().close();
});
