import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

import { createTextAnchor } from "../../src/domain/collaboration";
import type { NodeId } from "../../src/domain/document";
import { DUCTUS_PROTOCOL_VERSION } from "../../src/domain/evidence/commit-envelope";
import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { post } from "./comment-seed";
import { closeWork, seedWork, workDocument } from "./work-seed";
import { clickSignOut, logoutDialogOf, signIn } from "./support";
import { APP_ORIGIN } from "./origin";

// #732 item 7 (DAN-89, contract 6396547184 §6 with 6404284308): "Kako vidi
// nastavnik" on /rad shows the student's own work of the assignment as its
// teacher sees it, drawn by the same LiveText from the same routes (PRODUCT
// §5 rule 5), read-only. Course, assignment, text and comment are invented;
// the document is the student's own work, made by the real open route.

const TEXT = "Gradske knjižnice su mjesto susreta i učenja.";
const QUOTE = "mjesto susreta";
const LATER = "učenja";
const HEADING = "Izmišljeni zaključak";
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
  // DAN-330: the work starts on the student's click.
  await student.getByRole("button", { name: t.workspace.startWork }).click();
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

  // A comment the teacher adds now is marked once the student refreshes the panel beside the text.
  const later = TEXT.indexOf(LATER);
  const second = createTextAnchor({ nodeId, nodeText: TEXT, start: later, end: later + LATER.length });
  expect((await post(teacher, "create", { documentId, body: "Pojasni.", anchor: second })).status()).toBe(200);
  await student.getByRole("button", { name: t.comments.refresh }).click();
  await expect(liveTextOf(student).locator("mark")).toHaveText([QUOTE, LATER]);
  // "Prikaži u tekstu" in the panel selects the passage in the text on screen, not in the hidden editor.
  await student.getByRole("article").filter({ hasText: "Pojasni." })
    .getByRole("button", { name: t.comments.showInText }).click();
  expect(await student.evaluate(() => window.getSelection()?.toString())).toBe(LATER);
  expect(await liveTextOf(student).evaluate((element) =>
    element.contains(window.getSelection()?.anchorNode ?? null))).toBe(true);

  // 2. Rule 5: the region holds the same markup on the teacher's page.
  await teacher.goto(`/nastavnik/rad/${documentId}`);
  await expect(liveTextOf(teacher).locator("mark")).toHaveText([QUOTE, LATER], { timeout: OPEN });
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

test("a heading of the structure brings that heading of the teacher view's text into view", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await signIn(page, "/rad");
  const { assignment, documentId } = await writeWork(page);
  // Enough invented paragraphs to put the heading below the first screen.
  for (let i = 1; i <= 20; i += 1) {
    await page.keyboard.press("Enter");
    await page.keyboard.type(`Izmišljeni odlomak ${i}.`);
  }
  await page.keyboard.press("Enter");
  await page.keyboard.type(HEADING);
  const toolbar = page.getByRole("toolbar", { name: t.toolbar.label });
  const heading1 = toolbar.getByRole("button", { name: t.toolbar.heading1, exact: true });
  if (await heading1.isVisible()) await heading1.click();
  else {
    await toolbar.getByRole("button", { name: t.toolbar.more }).click();
    await page.getByRole("menuitemcheckbox", { name: t.toolbar.heading1, exact: true }).click();
  }
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/live/${documentId}`, { headers: { "ductus-protocol": DUCTUS_PROTOCOL_VERSION } });
      return response.ok() ? await response.text() : "";
    }, { timeout: OPEN })
    .toContain(HEADING);

  await page.goto(`/rad?zadatak=${assignment}&prikaz=nastavnik`);
  const shown = liveTextOf(page).getByRole("heading", { name: HEADING });
  await expect(shown).toBeAttached({ timeout: OPEN });
  await expect(shown).not.toBeInViewport();
  await page.getByRole("navigation", { name: t.outline.label }).getByRole("button", { name: HEADING }).click();
  await expect(shown).toBeInViewport();
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
  await second.waitForURL(`${APP_ORIGIN}/`);

  await expect(liveTextOf(page)).toContainText(t.liveView.connection.signedOut);
  await expect(liveTextOf(page).getByText(TEXT)).toHaveCount(0);
  await expect(liveTextOf(page).locator("[data-node-id]")).toHaveCount(0);
});

// #882 (DAN-215): while /rad shows the teacher view the tab publishes nothing
// (BACKEND 4.12 t. 7); the state typed before waits for the return to writing.
const TOKEN = "33333333-3333-4333-8333-333333333333";
const isPut = (request: Request) => request.method() === "PUT" && /^\/api\/live\/[^/]+$/.test(pathOf(request));
const writingOf = (page: Page) => modesOf(page).getByRole("link", { name: t.workspace.modeWriting });

/** Every PUT to the live route with the time it left and its body. */
function recordPuts(page: Page): { at: number; body: string }[] {
  const puts: { at: number; body: string }[] = [];
  page.on("request", (request) => { if (isPut(request)) puts.push({ at: Date.now(), body: request.postData() ?? "" }); });
  return puts;
}

/** Into the teacher view by its link; the returned time is after the publisher has been held. */
async function toTeacherView(page: Page, assignment: string): Promise<number> {
  await teacherSwitchOf(page).click();
  await page.waitForURL(`**/rad?zadatak=${assignment}&prikaz=nastavnik`);
  await expect(teacherSwitchOf(page)).toHaveAttribute("aria-current", "page");
  await page.waitForTimeout(250);
  return Date.now();
}

async function toWriting(page: Page, assignment: string): Promise<void> {
  await writingOf(page).click();
  await page.waitForURL(`**/rad?zadatak=${assignment}`);
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
  await editorOf(page).click();
  await page.keyboard.press("Control+End");
}

const liveBody = async (page: Page, documentId: string): Promise<string> => {
  const response = await page.request.get(`/api/live/${documentId}`, { headers: { "ductus-protocol": DUCTUS_PROTOCOL_VERSION } });
  return response.ok() ? await response.text() : "";
};

test("a teacher view opened directly publishes nothing, and writing publishes again from the same editor", async ({ page }) => {
  await signIn(page, "/rad");
  const { assignment } = await writeWork(page);
  const opens = record(page, isOpen);
  const puts = recordPuts(page);
  await page.goto(`/rad?zadatak=${assignment}&prikaz=nastavnik`);
  await expect(liveTextOf(page).getByText(TEXT)).toBeVisible({ timeout: OPEN });
  await page.reload();
  await expect(liveTextOf(page).getByText(TEXT)).toBeVisible({ timeout: OPEN });
  await page.waitForTimeout(3000);
  expect(puts).toEqual([]);

  const opensBefore = opens.length;
  await toWriting(page, assignment);
  await expect(editorOf(page)).toHaveText(TEXT);
  expect(opens.length).toBe(opensBefore);
  await page.keyboard.type(" Dodatak.");
  await expect.poll(() => puts.some((put) => put.body.includes("Dodatak.")), { timeout: OPEN }).toBe(true);
  expect(opens.length).toBe(opensBefore);
});

test("switching to the teacher view holds the waiting state, and the return to writing publishes it", async ({ page }) => {
  await signIn(page, "/rad");
  const { assignment, documentId } = await writeWork(page);
  const opens = record(page, isOpen);
  const puts = recordPuts(page);
  for (let round = 0; round < 3; round += 1) {
    await page.keyboard.type(` piše ${round}`);
    await expect.poll(() => puts.some((put) => put.body.includes(`piše ${round}`)), { timeout: OPEN }).toBe(true);
    // Within a second of the last start: this state waits for the next request.
    await page.keyboard.type(` čeka ${round}`);
    const heldAt = await toTeacherView(page, assignment);
    await page.waitForTimeout(2500);
    expect(puts.filter((put) => put.at > heldAt)).toEqual([]);

    await toWriting(page, assignment);
    await expect.poll(() => liveBody(page, documentId), { timeout: OPEN }).toContain(`čeka ${round}`);
  }
  expect(opens).toEqual([]);
});

test("a request in flight is aborted by the switch to the teacher view and is not sent again there", async ({ page }) => {
  // The route's answers are the test's: the request is held long enough to switch.
  await page.route((url) => /^\/api\/live\/[^/]+$/.test(url.pathname), async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    await new Promise((resolve) => setTimeout(resolve, 4000));
    try {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ outcome: "accepted", token: TOKEN }) });
    } catch {
      // Aborted by the page meanwhile.
    }
  });
  await signIn(page, "/rad");
  const assignment = await seedWork({ teacher: true });
  await page.goto(`/rad?zadatak=${assignment}`);
  await page.getByRole("button", { name: t.workspace.startWork }).click();
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
  const puts = recordPuts(page);
  const failed: Request[] = [];
  page.on("requestfailed", (request) => { if (isPut(request)) failed.push(request); });
  await editorOf(page).click();
  await page.keyboard.type(TEXT);
  await expect.poll(() => puts.length, { timeout: OPEN }).toBeGreaterThan(0);

  const heldAt = await toTeacherView(page, assignment);
  await expect.poll(() => failed.length, { timeout: 8000 }).toBeGreaterThan(0);
  await page.waitForTimeout(5000);
  expect(puts.filter((put) => put.at > heldAt)).toEqual([]);
});

test("Odjava from the teacher view: Ostani keeps it held, and nothing goes out after the sign-out", async ({ page }) => {
  await page.route((url) => /^\/api\/live\/[^/]+$/.test(url.pathname), (route) => route.request().method() === "PUT"
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ outcome: "accepted", token: TOKEN }) })
    : route.fallback());
  // The evidence never gets its receipt here, so the text stays owed and "Odjava" opens the dialog.
  await page.route("**/api/evidence/commit", (route) => route.abort());
  await signIn(page, "/rad");
  const assignment = await seedWork({ teacher: true });
  await page.goto(`/rad?zadatak=${assignment}`);
  await page.getByRole("button", { name: t.workspace.startWork }).click();
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
  const puts = recordPuts(page);
  const dialog = logoutDialogOf(page);
  await editorOf(page).click();
  await page.keyboard.type(TEXT);
  await expect.poll(() => puts.length, { timeout: OPEN }).toBeGreaterThan(0);

  const heldAt = await toTeacherView(page, assignment);
  await page.getByRole("button", { name: t.auth.logout, exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: t.auth.logoutStay }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(2500);
  expect(puts.filter((put) => put.at > heldAt)).toEqual([]);

  await toWriting(page, assignment);
  const back = puts.length;
  await page.keyboard.type(" Dodatak.");
  await expect.poll(() => puts.length, { timeout: OPEN }).toBeGreaterThan(back);

  const fencedAt = await toTeacherView(page, assignment);
  await page.getByRole("button", { name: t.auth.logout, exact: true }).click();
  await dialog.getByRole("button", { name: t.auth.logoutConfirm }).click();
  await page.waitForURL(`${APP_ORIGIN}/`);
  await page.waitForTimeout(2500);
  expect(puts.filter((put) => put.at > fencedAt)).toEqual([]);
});
