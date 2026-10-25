import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

import { createTextAnchor } from "../../src/domain/collaboration";
import type { NodeId } from "../../src/domain/document";
import { DUCTUS_PROTOCOL_VERSION } from "../../src/domain/evidence/commit-envelope";
import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { post } from "./comment-seed";
import { closeWork, seedWork, workDocument } from "./work-seed";
import { clickSignOut, signIn } from "./support";

// #732 item 7 (DAN-89, contract 6396547184 §6 with 6404284308): "Kako vidi
// nastavnik" on /rad shows the student's own work of the assignment as its
// teacher sees it, drawn by the same LiveText from the same routes (PRODUCT
// §5 rule 5), read-only. Course, assignment, text and comment are invented;
// the document is the student's own work, made by the real open route.

const TEXT = "Gradske knjižnice su mjesto susreta i učenja.";
const QUOTE = "mjesto susreta";
const OPEN = 30_000;

const editorOf = (page: Page) => page.getByRole("textbox", { name: t.workspace.documentLabel });
const liveTextOf = (page: Page) => page.getByRole("document", { name: t.liveView.documentLabel });
const modesOf = (page: Page) => page.getByRole("navigation", { name: t.workspace.viewModes });
const teacherSwitchOf = (page: Page) => modesOf(page).getByRole("link", { name: t.workspace.modeTeacherView });
const pathOf = (request: Request) => new URL(request.url()).pathname;
const isOpen = (request: Request) => request.method() === "POST" && pathOf(request) === "/api/evidence/open";
const isTeacherRead = (request: Request) =>
  pathOf(request).startsWith("/api/live/") || pathOf(request) === "/api/process-summary";

function record(page: Page, keep: (request: Request) => boolean): Request[] {
  const seen: Request[] = [];
  page.on("request", (request) => { if (keep(request)) seen.push(request); });
  return seen;
}

/** The student writes TEXT into the work of a new assignment the demo teacher teaches. */
async function writeWork(student: Page): Promise<{ assignment: string; documentId: string; nodeId: NodeId }> {
  const assignment = await seedWork({ teacher: true });
  await student.goto(`/rad?zadatak=${assignment}`);
  await expect(editorOf(student)).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
  await editorOf(student).click();
  await student.keyboard.type(TEXT);
  const nodeId = (await editorOf(student).locator("p[data-node-id]").first().getAttribute("data-node-id")) as NodeId;
  const documentId = await workDocument(assignment);
  // The teacher view shows the last state the student published (PUT
  // /api/live), not unsent local input; a test that leaves the editor at
  // once waits until the whole TEXT is published.
  await expect
    .poll(async () => {
      const response = await student.request.get(`/api/live/${documentId}`, {
        headers: { "ductus-protocol": DUCTUS_PROTOCOL_VERSION },
      });
      return response.ok() ? await response.text() : "";
    }, { timeout: OPEN })
    .toContain(TEXT);
  return { assignment, documentId, nodeId };
}

async function axeClean(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
}

test.afterEach(closeWork);

test("the student switches to the teacher view, reads the text as the teacher does, and goes back to writing", async ({ browser }) => {
  const student = await (await browser.newContext()).newPage();
  const teacher = await (await browser.newContext()).newPage();
  await signIn(teacher, "/", "Demo nastavnik");
  await signIn(student, "/rad");
  const opens = record(student, isOpen);
  const { assignment, documentId, nodeId } = await writeWork(student);
  const start = TEXT.indexOf(QUOTE);
  const anchor = createTextAnchor({ nodeId, nodeText: TEXT, start, end: start + QUOTE.length });
  expect((await post(teacher, "create", { documentId, body: "Dodaj izvor.", anchor })).status()).toBe(200);
  const opensBefore = opens.length;

  // 1. A real link, then read-only text and nothing to write with.
  await expect(teacherSwitchOf(student)).toHaveAttribute("href", `/rad?zadatak=${assignment}&prikaz=nastavnik`);
  await teacherSwitchOf(student).click();
  await student.waitForURL(`**/rad?zadatak=${assignment}&prikaz=nastavnik`);
  await expect(teacherSwitchOf(student)).toHaveAttribute("aria-current", "page");
  await expect(modesOf(student).getByRole("link", { name: t.workspace.modeWriting })).not.toHaveAttribute("aria-current");
  await expect(student.getByText(t.workspace.teacherViewLead)).toBeVisible();
  await expect(liveTextOf(student).getByText(TEXT)).toBeVisible({ timeout: OPEN });
  await expect(liveTextOf(student).locator("mark")).toHaveText(QUOTE);
  await expect(student.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(student.getByRole("toolbar", { name: t.toolbar.label })).toHaveCount(0);

  // 2. Rule 5: the region holds the same markup on the teacher's page.
  await teacher.goto(`/nastavnik/rad/${documentId}`);
  await expect(liveTextOf(teacher).locator("mark")).toHaveText(QUOTE, { timeout: OPEN });
  const html = (page: Page) => liveTextOf(page).evaluate((element) => element.innerHTML);
  expect(await html(student)).toBe(await html(teacher));

  // 8. Tab order in the bar: Pisanje, Kako vidi nastavnik, then the submission link.
  await modesOf(student).getByRole("link", { name: t.workspace.modeWriting }).focus();
  await student.keyboard.press("Tab");
  await expect(teacherSwitchOf(student)).toBeFocused();
  expect(await teacherSwitchOf(student).evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");

  // 7. axe and screenshots of both modes at both widths (docs/SESSIONS.md §6).
  for (const width of [1440, 375]) {
    await student.setViewportSize({ width, height: 900 });
    await axeClean(student);
    expect(await student.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await test.info().attach(`kako-vidi-nastavnik-${width}`, { body: await student.screenshot({ fullPage: true }), contentType: "image/png" });
  }

  // 3. Back to writing: the same text in the editor, and the work is not opened again.
  await modesOf(student).getByRole("link", { name: t.workspace.modeWriting }).click();
  await student.waitForURL(`**/rad?zadatak=${assignment}`);
  await expect(editorOf(student)).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
  await expect(editorOf(student)).toHaveText(TEXT);
  expect(opens.length).toBe(opensBefore);
  for (const width of [1440, 375]) {
    await student.setViewportSize({ width, height: 900 });
    await test.info().attach(`pisanje-${width}`, { body: await student.screenshot({ fullPage: true }), contentType: "image/png" });
  }
});

test("no teacher view without the student's own assignment, and nothing read for it", async ({ browser }) => {
  const student = await (await browser.newContext()).newPage();
  const teacher = await (await browser.newContext()).newPage();
  await signIn(student, "/rad");
  await signIn(teacher, "/", "Demo nastavnik");
  const foreign = await seedWork({ student: null });
  const own = await seedWork({ teacher: true });
  const cases: [Page, string][] = [
    [student, "/rad?prikaz=nastavnik"],
    [student, `/rad?zadatak=${foreign}&prikaz=nastavnik`],
    [teacher, `/rad?zadatak=${own}&prikaz=nastavnik`],
  ];
  for (const [page, path] of cases) {
    const reads = record(page, isTeacherRead);
    await page.goto(path);
    const off = modesOf(page).getByRole("button", { name: `${t.workspace.modeTeacherView} ${t.workspace.teacherViewOff}` });
    await expect(off).toHaveAttribute("aria-disabled", "true");
    await expect(off).not.toHaveAttribute("href");
    await expect(page.getByText(t.workspace.teacherViewLead)).toHaveCount(0);
    await expect(liveTextOf(page)).toHaveCount(0);
    // The bar is the same as without the parameter.
    const withParam = await modesOf(page).evaluate((element) => element.outerHTML);
    await page.goto(path.replace(/[?&]prikaz=nastavnik$/, ""));
    expect(await modesOf(page).evaluate((element) => element.outerHTML)).toBe(withParam);
    await page.waitForTimeout(1_500);
    expect(reads.map(pathOf)).toEqual([]);
  }
});

test("offline in the teacher view keeps the last text and connects again", async ({ page, context }) => {
  await signIn(page, "/rad");
  const { assignment } = await writeWork(page);
  await page.goto(`/rad?zadatak=${assignment}&prikaz=nastavnik`);
  await expect(liveTextOf(page).getByText(TEXT)).toBeVisible({ timeout: OPEN });

  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: t.liveView.connection.retrying })).toBeVisible({ timeout: 15_000 });
  await expect(liveTextOf(page).getByText(TEXT)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: t.liveView.connection.live })).toBeVisible({ timeout: 30_000 });
  await expect(liveTextOf(page).getByText(TEXT)).toBeVisible();
});

test("a sign-out in another tab removes the text from the teacher view (D-118)", async ({ page, context }) => {
  await signIn(page, "/rad");
  const { assignment } = await writeWork(page);
  await page.goto(`/rad?zadatak=${assignment}&prikaz=nastavnik`);
  await expect(liveTextOf(page).getByText(TEXT)).toBeVisible({ timeout: OPEN });

  const second = await context.newPage();
  // The work's own sheet, held by the first tab, as sign-out.spec.ts signs out from it.
  await second.goto(`/rad?zadatak=${assignment}`);
  await clickSignOut(second);
  await second.waitForURL("http://localhost:3000/");

  await expect(liveTextOf(page)).toContainText(t.liveView.connection.signedOut);
  await expect(liveTextOf(page).getByText(TEXT)).toHaveCount(0);
  await expect(liveTextOf(page).locator("[data-node-id]")).toHaveCount(0);
});
