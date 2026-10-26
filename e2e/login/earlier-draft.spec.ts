import { readFile } from "node:fs/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { messagesHr } from "../../src/lib/i18n/messages.hr";
import { closeWork, seedWork } from "./work-seed";
import { clickSignOut, signIn } from "./support";

// #711 F1b (contract 6391402093 §4 and §8 tests 11 and 12; owner decisions O2
// and O3): the free draft of this device is offered on the student's own work
// of an assignment only to read and copy. It is never written into the work,
// moved or deleted, and never shown to another person. Every account, course,
// assignment and text is invented.

const t = messagesHr.workspace;
const OPEN = 30_000;
const STUDENT_2 = "demo-student-2@demo.ductus.test";

const editorOf = (page: Page) => page.getByRole("textbox", { name: t.documentLabel });
const offerOf = (page: Page) => page.locator("details.earlier-draft");
const chipOf = (page: Page) => page.locator(".workspace__status .sync-chip");

// The first opening (DAN-330: the click on "Započni rad" while the work does
// not exist yet) POSTs the open and refreshes the render, which mounts the
// shell afresh (#731): the offer is touched only once the editor toolbar of the
// refreshed render is there.
async function openAssignment(page: Page, assignment: string, start = true): Promise<void> {
  await page.goto(`/rad?zadatak=${assignment}`);
  if (start) await page.getByRole("button", { name: t.startWork }).click();
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
  await expect(page.getByRole("toolbar", { name: messagesHr.toolbar.label })).toBeVisible();
}

async function writeFree(page: Page, text: string): Promise<void> {
  await page.goto("/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
  await editorOf(page).click();
  await page.keyboard.type(text);
  await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");
}

test.afterEach(closeWork);

test("F1b: an earlier draft is offered as text to copy and stays on the device", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const EARLIER = "Raniji izmišljeni tekst o gradskim knjižnicama.";
  await signIn(page, "/rad");
  await writeFree(page, EARLIER);
  const assignment = await seedWork();

  await openAssignment(page, assignment);
  // Nothing was written into the work by the program.
  await expect(editorOf(page)).toHaveText("");
  const offer = offerOf(page);
  await expect(offer).toBeVisible();
  await expect(offer).not.toHaveAttribute("open", "");
  await offer.getByText(t.earlierDraftSummary).click();
  await expect(offer).toContainText(EARLIER);
  await expect(offer.locator('[contenteditable="true"]')).toHaveCount(0);
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await test.info().attach(`f1b-raniji-tekst-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }

  await offer.getByRole("button", { name: t.earlierDraftCopy }).click();
  await expect(offer.getByRole("status")).toHaveText(t.earlierDraftCopied);
  await expect(editorOf(page)).toHaveText("");
  // The student's own paste is the only way in.
  await editorOf(page).click();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(editorOf(page)).toHaveText(EARLIER);
  await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");

  // The earlier draft is where it was, whole.
  await offer.getByRole("link", { name: t.earlierDraftOpen }).click();
  await page.waitForURL("**/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
  await expect(editorOf(page)).toHaveText(EARLIER);
});

test("F1b: without a clipboard the offer says so and offers the export", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
  await signIn(page, "/rad");
  await writeFree(page, "Raniji izmišljeni tekst bez međuspremnika.");
  const assignment = await seedWork();
  await openAssignment(page, assignment);
  await offerOf(page).getByText(t.earlierDraftSummary).click();
  await offerOf(page).getByRole("button", { name: t.earlierDraftCopy }).click();
  await expect(offerOf(page).getByRole("status")).toHaveText(t.earlierDraftCopyFailed);
  const download = page.waitForEvent("download");
  await offerOf(page).getByRole("button", { name: messagesHr.editor.exportText }).click();
  const file = await download;
  expect(await readFile(await file.path(), "utf8")).toBe("Raniji izmišljeni tekst bez međuspremnika.");
  await expect(editorOf(page)).toHaveText("");
});

test("F1b: another person on the same browser never sees the earlier draft", async ({ page }) => {
  const HERS = "Raniji tekst studentice koji nitko drugi ne vidi.";
  await signIn(page, "/rad");
  await writeFree(page, HERS);
  await clickSignOut(page);
  await page.waitForURL("http://localhost:3000/");
  await page.context().clearCookies({ name: /^_session/ });

  await signIn(page, "/rad", "Demo student 2");
  // With no draft of their own there is nothing to offer.
  const assignment = await seedWork({ student: STUDENT_2 });
  await openAssignment(page, assignment);
  await expect(offerOf(page)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(HERS);

  // With a draft of their own, only that one is offered.
  await writeFree(page, "Vlastiti raniji tekst drugog studenta.");
  // The work exists since the first opening above: no click.
  await openAssignment(page, assignment, false);
  await offerOf(page).getByText(t.earlierDraftSummary).click();
  await expect(offerOf(page)).toContainText("Vlastiti raniji tekst drugog studenta.");
  await expect(page.locator("body")).not.toContainText(HERS);
});

test("F1b: the offer leaves the page when the session ends in another tab", async ({ page, context }) => {
  await signIn(page, "/rad");
  await writeFree(page, "Raniji tekst koji odlazi s odjavom.");
  const assignment = await seedWork();
  await openAssignment(page, assignment);
  await offerOf(page).getByText(t.earlierDraftSummary).click();
  await expect(offerOf(page)).toContainText("Raniji tekst koji odlazi s odjavom.");
  const second = await context.newPage();
  await second.goto("/rad");
  await clickSignOut(second);
  await second.waitForURL("http://localhost:3000/");
  await expect(offerOf(page)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Raniji tekst koji odlazi s odjavom.");
});
