import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

import { messagesHr } from "../../src/lib/i18n/messages.hr";
import { LOCAL_DEMO_DOCUMENT_ID } from "../../src/lib/journal/local-scope";
import { closeWork, documentsOf, seedWork, STUDENT, TEACHER, workDocument } from "./work-seed";
import { clickSignOut, signIn, signOutWithoutDialog, type DemoAccount } from "./support";

// #711 F1 (contract 6391402093 §8 tests 1-10 and 13, amendment 6391779486):
// `/rad?zadatak=` writes into the student's own document of the assignment,
// opened by the real route; without `?zadatak=` the draft stays on the device.
// DAN-330 (Refs #711): the work starts only on the student's click on
// "Započni rad"; loading a page never starts it.
// Every account, course, assignment and text is invented.

const t = messagesHr;
const OPEN = 30_000;

const editorOf = (page: Page) => page.getByRole("textbox", { name: t.workspace.documentLabel });
const sheetOf = (page: Page) => page.locator(".sheet-area");
const writableEditors = (page: Page) => page.locator('[contenteditable="true"]');

/** Every request the page makes, to check what it sends. */
function recordRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on("request", (request) => requests.push(request));
  return requests;
}

const pathOf = (request: Request) => new URL(request.url()).pathname;
const touching = (requests: Request[], pattern: RegExp) => requests.filter((r) => pattern.test(pathOf(r))).map(pathOf);
const carryingFixedId = (requests: Request[]) =>
  requests.filter((r) => r.url().includes(LOCAL_DEMO_DOCUMENT_ID) || (r.postData() ?? "").includes(LOCAL_DEMO_DOCUMENT_ID)).map(pathOf);
const isLivePut = (request: Request) => request.method() === "PUT" && /^\/api\/live\//.test(pathOf(request));

async function signedIn(page: Page, account: DemoAccount = "Demo studentica"): Promise<void> {
  await signIn(page, "/rad", account);
}

async function writable(page: Page): Promise<void> {
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
}

async function axeClean(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

/** Screenshots at 1440 and 375 px (docs/SESSIONS.md §6), each with axe. */
async function shoot(page: Page, name: string): Promise<void> {
  const viewport = page.viewportSize();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await test.info().attach(`${name}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await axeClean(page);
  }
  if (viewport) await page.setViewportSize(viewport);
}

test.afterEach(closeWork);

// DAN-330: the work starts only on the student's click on "Započni rad".
const startOf = (page: Page) => page.getByRole("button", { name: t.workspace.startWork });
const opens = (requests: Request[]) => touching(requests, /^\/api\/evidence\/open$/);

/** As shoot, in both themes, switched with the shell's own toggle and back. */
async function shootThemes(page: Page, name: string): Promise<void> {
  const toggle = page.getByRole("button", { name: t.shell.theme });
  for (let i = 0; i < 2; i += 1) {
    const theme = await page.locator("[data-theme]").first().getAttribute("data-theme");
    await shoot(page, `${name}-${theme}`);
    await toggle.click();
  }
}

test("DAN-330: loading /rad?zadatak= starts nothing until \"Započni rad\"", async ({ page }) => {
  await signedIn(page);
  const assignment = await seedWork();
  const requests = recordRequests(page);
  await page.goto(`/rad?zadatak=${assignment}`);
  await expect(startOf(page)).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: t.workspace.notStarted })).toBeVisible();
  await expect(editorOf(page)).toHaveAttribute("aria-disabled", "true");
  await expect(writableEditors(page)).toHaveCount(0);
  await page.waitForTimeout(3000);
  await page.reload();
  await expect(startOf(page)).toBeVisible();
  await page.waitForTimeout(3000);
  expect(opens(requests)).toEqual([]);
  expect(await documentsOf(STUDENT, assignment)).toEqual({ projects: 0, documents: [] });
  await shootThemes(page, "dan330-rad-nije-zapocet");

  const live = page.waitForRequest(isLivePut, { timeout: OPEN });
  await startOf(page).click();
  await writable(page);
  await editorOf(page).click();
  await page.keyboard.type("Izmišljena prva rečenica nakon klika.");
  const { projects, documents } = await documentsOf(STUDENT, assignment);
  expect(projects).toBe(1);
  expect(documents).toHaveLength(1);
  expect(pathOf(await live)).toBe(`/api/live/${documents[0]}`);
  const comments = requests.filter((r) => /^\/api\/comments/.test(pathOf(r)));
  expect(comments.length).toBeGreaterThan(0);
  for (const request of comments) expect(request.postData() ?? "").toContain(documents[0]!);
  expect(opens(requests)).toEqual(["/api/evidence/open"]);

  // The work exists: the same address opens the editor directly.
  await page.reload();
  await writable(page);
  await expect(startOf(page)).toHaveCount(0);
  await expect(page.getByText(t.workspace.notStarted)).toHaveCount(0);
  expect(opens(requests)).toEqual(["/api/evidence/open"]);
  expect(carryingFixedId(requests)).toEqual([]);
  expect(await page.content()).not.toContain(LOCAL_DEMO_DOCUMENT_ID);
});

test("DAN-330: a double click starts one work", async ({ page }) => {
  await signedIn(page);
  const assignment = await seedWork();
  const requests = recordRequests(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/evidence/open", async (route) => { await held; await route.continue(); });
  await page.goto(`/rad?zadatak=${assignment}`);
  await startOf(page).dblclick();
  await page.keyboard.press("Enter");
  // The waiting button is aria-disabled, which Playwright's actionability
  // check refuses; a person can still click it, so the click is forced.
  await startOf(page).click({ force: true });
  // Waiting: the button stays focusable, aria-disabled, and the sheet is busy.
  await expect(page.getByRole("status").filter({ hasText: t.workspace.openLoading })).toBeVisible();
  await expect(startOf(page)).toHaveAttribute("aria-disabled", "true");
  await expect(startOf(page)).toBeFocused();
  await expect(editorOf(page)).toHaveAttribute("aria-busy", "true");
  await shootThemes(page, "dan330-otvaram-rad");
  release();
  await writable(page);
  expect(opens(requests)).toEqual(["/api/evidence/open"]);
  const { projects, documents } = await documentsOf(STUDENT, assignment);
  expect(projects).toBe(1);
  expect(documents).toHaveLength(1);
});

test("DAN-330: the submission page of a work not started sends nothing", async ({ page }) => {
  await signedIn(page);
  const assignment = await seedWork();
  const requests = recordRequests(page);
  await page.goto(`/rad/${assignment}/predaja`);
  await expect(page.getByRole("status").filter({ hasText: t.submission.notStarted })).toBeVisible();
  await expect(page.getByRole("link", { name: t.submission.backToWork })).toHaveAttribute("href", `/rad?zadatak=${assignment}`);
  await expect(page.getByRole("button", { name: t.submission.submit })).toHaveCount(0);
  await page.waitForTimeout(3000);
  await page.reload();
  await expect(page.getByText(t.submission.notStarted)).toBeVisible();
  await page.waitForTimeout(3000);
  expect(touching(requests, /^\/api\/(evidence|submission)(\/|$)/)).toEqual([]);
  expect(await documentsOf(STUDENT, assignment)).toEqual({ projects: 0, documents: [] });
  await shootThemes(page, "dan330-predaja-rad-nije-zapocet");
});

test("DAN-330: past the due date the work can still be started", async ({ page }) => {
  await signedIn(page);
  const assignment = await seedWork({ opens: "-10 days", due: "-1 day" });
  const requests = recordRequests(page);
  await page.goto(`/rad?zadatak=${assignment}`);
  await expect(page.getByRole("note")).toHaveText(t.workspace.lateNote);
  await expect(startOf(page)).toBeVisible();
  await page.waitForTimeout(1000);
  expect(opens(requests)).toEqual([]);
  await startOf(page).click();
  await writable(page);
  await editorOf(page).click();
  await page.keyboard.type("Rad započet nakon roka.");
  await expect(editorOf(page)).toContainText("Rad započet nakon roka.");
  await expect(page.getByRole("note")).toHaveText(t.workspace.lateNote);
  expect(opens(requests)).toEqual(["/api/evidence/open"]);
});

test("DAN-330: offline, nothing is sent before the click and the click continues when the network returns", async ({ page, context }) => {
  await signedIn(page);
  const assignment = await seedWork();
  const requests = recordRequests(page);
  await page.goto(`/rad?zadatak=${assignment}`);
  await expect(startOf(page)).toBeVisible();
  // Without a click, the network going and coming back starts nothing.
  await context.setOffline(true);
  await page.waitForTimeout(500);
  await context.setOffline(false);
  await page.waitForTimeout(2000);
  expect(opens(requests)).toEqual([]);
  expect((await documentsOf(STUDENT, assignment)).projects).toBe(0);
  // With the click, the opening waits for the network and goes on by itself.
  await context.setOffline(true);
  await startOf(page).click();
  await expect(page.getByRole("status").filter({ hasText: t.workspace.openOffline })).toBeVisible({ timeout: OPEN });
  await expect(writableEditors(page)).toHaveCount(0);
  expect((await documentsOf(STUDENT, assignment)).projects).toBe(0);
  await context.setOffline(false);
  await writable(page);
  await workDocument(assignment);
});

test("DAN-330: after another sign-in in this browser the earlier tab starts nothing", async ({ page, context }) => {
  await signedIn(page);
  const assignment = await seedWork();
  const requests = recordRequests(page);
  await page.goto(`/rad?zadatak=${assignment}`);
  await expect(startOf(page)).toBeVisible();
  const other = await context.newPage();
  await context.clearCookies({ name: /^_session/ });
  await signIn(other, "/rad", "Demo student 2");
  await expect(startOf(page)).toHaveCount(0);
  await expect(sheetOf(page).getByRole("link", { name: t.auth.signIn })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(opens(requests)).toEqual([]);
  expect((await documentsOf(STUDENT, assignment)).projects).toBe(0);
});

test("F1: /rad?zadatak= writes into the student's own document of the assignment", async ({ page }) => {
  await signedIn(page);
  const assignment = await seedWork();
  const requests = recordRequests(page);
  const live = page.waitForRequest(isLivePut, { timeout: OPEN });
  await page.goto(`/rad?zadatak=${assignment}`);
  await startOf(page).click();
  await writable(page);
  await editorOf(page).click();
  await page.keyboard.type("Izmišljena prva rečenica rada F1.");
  const { projects, documents } = await documentsOf(STUDENT, assignment);
  expect(projects).toBe(1);
  expect(documents).toHaveLength(1);
  expect(pathOf(await live)).toBe(`/api/live/${documents[0]}`);
  const comments = requests.filter((r) => /^\/api\/comments/.test(pathOf(r)));
  expect(comments.length).toBeGreaterThan(0);
  for (const request of comments) expect(request.postData() ?? "").toContain(documents[0]!);
  expect(touching(requests, /^\/api\/evidence\/open$/)).toEqual(["/api/evidence/open"]);
  expect(carryingFixedId(requests)).toEqual([]);
  expect(await page.content()).not.toContain(LOCAL_DEMO_DOCUMENT_ID);
});

test("F1: two assignments keep two documents", async ({ page }) => {
  await signedIn(page);
  const x = await seedWork();
  const y = await seedWork();
  await page.goto(`/rad?zadatak=${x}`);
  await startOf(page).click();
  await writable(page);
  await editorOf(page).click();
  await page.keyboard.type("Tekst samo za zadatak X.");
  await expect(page.locator(".workspace__status .sync-chip")).toHaveAttribute("data-state", "LOCAL_DURABLE");
  await page.goto(`/rad?zadatak=${y}`);
  await startOf(page).click();
  await writable(page);
  await expect(editorOf(page)).not.toContainText("Tekst samo za zadatak X.");
  const [docX, docY] = [await workDocument(x), await workDocument(y)];
  expect(docX).not.toBe(docY);
  await page.goto(`/rad?zadatak=${x}`);
  await writable(page);
  await expect(editorOf(page)).toContainText("Tekst samo za zadatak X.");
});

test("F1: a foreign, unknown and malformed assignment give the same unavailable sheet", async ({ page }) => {
  await signedIn(page);
  const foreign = await seedWork({ student: null });
  const requests = recordRequests(page);
  const sheets: string[] = [];
  for (const param of [foreign, "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c", "1%3B%20DROP", ""]) {
    await page.goto(`/rad?zadatak=${param}`);
    await expect(sheetOf(page)).toContainText(t.workspace.unavailable);
    await expect(writableEditors(page)).toHaveCount(0);
    await expect(startOf(page)).toHaveCount(0);
    sheets.push(await sheetOf(page).innerHTML());
  }
  expect(new Set(sheets).size).toBe(1);
  await shoot(page, "f1-zadatak-nije-dostupan");
  expect(touching(requests, /^\/api\/(evidence|live|comments)/)).toEqual([]);
  expect(carryingFixedId(requests)).toEqual([]);
  expect((await documentsOf(STUDENT, foreign)).projects).toBe(0);
});

test("F1: a teacher on /rad?zadatak= gets no editor and no work", async ({ browser, page }) => {
  // The seed names the demo student, who must have signed in once.
  const student = await (await browser.newContext()).newPage();
  await signedIn(student);
  await student.context().close();
  await signIn(page, "/rad", "Demo nastavnik");
  const assignment = await seedWork({ teacher: true });
  const requests = recordRequests(page);
  await page.goto(`/rad?zadatak=${assignment}`);
  await expect(sheetOf(page)).toContainText(t.workspace.unavailable);
  await expect(writableEditors(page)).toHaveCount(0);
  await expect(startOf(page)).toHaveCount(0);
  expect(touching(requests, /^\/api\/(evidence|live)/)).toEqual([]);
  expect((await documentsOf(TEACHER, assignment)).projects).toBe(0);
});

test("F1: before opens_at nothing is opened", async ({ page }) => {
  await signedIn(page);
  const assignment = await seedWork({ opens: "2 days", acknowledged: true });
  const requests = recordRequests(page);
  await page.goto(`/rad?zadatak=${assignment}`);
  await expect(sheetOf(page)).toContainText(t.workspace.openNotYet.split("{time}")[0]!.trim());
  await expect(writableEditors(page)).toHaveCount(0);
  await expect(startOf(page)).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(touching(requests, /^\/api\/(evidence|live)/)).toEqual([]);
  expect((await documentsOf(STUDENT, assignment)).projects).toBe(0);
});

test("F1: past the due date the editor stays writable and says the submission will be marked late", async ({ page }) => {
  await signedIn(page);
  const assignment = await seedWork({ opens: "-10 days", due: "-1 day" });
  await page.goto(`/rad?zadatak=${assignment}`);
  await startOf(page).click();
  await writable(page);
  await expect(page.getByRole("note")).toHaveText(t.workspace.lateNote);
  await editorOf(page).click();
  await page.keyboard.type("Pisanje nakon roka.");
  await expect(editorOf(page)).toContainText("Pisanje nakon roka.");
  await expect(page.locator(".workspace__bar").getByRole("link", { name: t.workspace.submitLink, exact: true })).toBeVisible();
  await shoot(page, "f1-nakon-roka");
});

test("F1: /rad without zadatak is a free editor with no comments, live or submission", async ({ page }) => {
  const requests = recordRequests(page);
  await signedIn(page);
  await writable(page);
  await expect(page.getByText(t.workspace.freeNote)).toBeVisible();
  await editorOf(page).click();
  await page.keyboard.type("Slobodni izmišljeni nacrt.");
  await expect(page.locator(".workspace__status .sync-chip")).toHaveAttribute("data-state", "LOCAL_DURABLE");
  await page.waitForTimeout(2500);
  await page.reload();
  await writable(page);
  await expect(editorOf(page)).toContainText("Slobodni izmišljeni nacrt.");
  await expect(page.getByRole("link", { name: t.workspace.submitLink, exact: true })).toHaveCount(0);
  await expect(page.getByText(t.workspace.commentsEmpty)).toBeVisible();
  expect(touching(requests, /^\/api\/(evidence|live|comments)/)).toEqual([]);
  await shoot(page, "f1-slobodni-nacrt");
});

test("F1: a failing open route leaves the sheet read-only with a retry", async ({ page }) => {
  await signedIn(page);
  const assignment = await seedWork();
  await page.route("**/api/evidence/open", (route) => route.fulfill({ status: 503, body: "{}" }));
  await page.goto(`/rad?zadatak=${assignment}`);
  await startOf(page).click();
  const retry = page.getByRole("button", { name: t.workspace.openRetry });
  await expect(retry).toBeVisible({ timeout: OPEN });
  await expect(page.getByRole("status").filter({ hasText: t.workspace.openError })).toBeVisible();
  await expect(writableEditors(page)).toHaveCount(0);
  expect((await documentsOf(STUDENT, assignment)).projects).toBe(0);
  await shoot(page, "f1-otvaranje-greska");
  await page.unroute("**/api/evidence/open");
  await retry.click();
  await writable(page);
  await workDocument(assignment);
});

test("F1: without a network the first open waits and continues when it returns", async ({ page, context }) => {
  await signedIn(page);
  const assignment = await seedWork();
  // The page is served; the network goes away at the first opening (amendment point 7).
  await page.route("**/api/evidence/open", async (route) => {
    await context.setOffline(true);
    await route.abort("internetdisconnected");
  }, { times: 1 });
  await page.goto(`/rad?zadatak=${assignment}`);
  await startOf(page).click();
  await expect(page.getByRole("status").filter({ hasText: t.workspace.openOffline })).toBeVisible({ timeout: OPEN });
  await expect(writableEditors(page)).toHaveCount(0);
  await shoot(page, "f1-otvaranje-bez-mreze");
  await context.setOffline(false);
  await writable(page);
  await workDocument(assignment);
});

test("F1: the submission page uses the editor's document", async ({ page }) => {
  await signedIn(page);
  const assignment = await seedWork();
  const live = page.waitForRequest(isLivePut, { timeout: OPEN });
  await page.goto(`/rad?zadatak=${assignment}`);
  await startOf(page).click();
  await writable(page);
  await editorOf(page).click();
  await page.keyboard.type("Izmišljeni tekst za predaju.");
  const liveId = pathOf(await live).split("/").pop();
  const opened = page.waitForResponse((r) => pathOf(r.request()) === "/api/evidence/open", { timeout: OPEN });
  await page.locator(".workspace__bar").getByRole("link", { name: t.workspace.submitLink, exact: true }).click();
  await page.waitForURL(`**/rad/${assignment}/predaja`);
  const body = (await (await opened).json()) as { documentId?: string };
  expect(body.documentId).toBe(liveId);
  expect(await workDocument(assignment)).toBe(liveId);
});

const journalNames = (page: Page) => page.evaluate(async () =>
  (await indexedDB.databases()).map((d) => d.name ?? "").filter((name) => name.startsWith("ductus-journal-v1-")).sort());

// A13 and D-118: the session always ends, and work the device has not synced
// stays in the person's own journal (the sign-out dialog says so, logoutKept).
// So the next person gets a journal of their own, never this one, and the
// student gets both documents back when she signs in again.
test("F1: sign-out after two assignments leaves neither to the next person", async ({ page }) => {
  await signIn(page, "/rad", "Demo student 2");
  // An empty journal holds nothing: no dialog (O1, #476 c.6396707923).
  await signOutWithoutDialog(page);
  await page.waitForURL("http://localhost:3000/");
  await page.context().clearCookies({ name: /^_session/ });
  await signedIn(page);
  const x = await seedWork();
  const y = await seedWork();
  for (const [assignment, text] of [[x, "Tekst X prije odjave."], [y, "Tekst Y prije odjave."]] as const) {
    await page.goto(`/rad?zadatak=${assignment}`);
    await startOf(page).click();
    await writable(page);
    await editorOf(page).click();
    await page.keyboard.type(text);
    await expect(page.locator(".workspace__status .sync-chip")).toHaveAttribute("data-state", "LOCAL_DURABLE");
  }
  const hers = await journalNames(page);
  expect(hers).toHaveLength(1);
  await clickSignOut(page);
  await page.waitForURL("http://localhost:3000/");
  await page.context().clearCookies({ name: /^_session/ });
  await signIn(page, "/rad", "Demo student 2");
  await writable(page);
  await expect(editorOf(page)).not.toContainText("prije odjave.");
  for (const assignment of [x, y]) {
    await page.goto(`/rad?zadatak=${assignment}`);
    await expect(writableEditors(page)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("prije odjave.");
  }
  // Her journal is kept (nothing was synced) and is not the one this person writes in.
  const now = await journalNames(page);
  expect(now).toHaveLength(2);
  expect(now).toContain(hers[0]);
  // The unavailable sheet opens no journal, so the account place is the
  // shell's plain sign-out form, not LocalLogout and its dialog (page.tsx).
  await page.getByRole("button", { name: t.auth.logout, exact: true }).click();
  await page.waitForURL("http://localhost:3000/");
  await page.context().clearCookies({ name: /^_session/ });
  await signIn(page, `/rad?zadatak=${x}`);
  await writable(page);
  await expect(editorOf(page)).toHaveText("Tekst X prije odjave.");
  await page.goto(`/rad?zadatak=${y}`);
  await writable(page);
  await expect(editorOf(page)).toHaveText("Tekst Y prije odjave.");
});
