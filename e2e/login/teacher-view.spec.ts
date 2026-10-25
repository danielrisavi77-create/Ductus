import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

import { createTextAnchor } from "../../src/domain/collaboration";
import type { NodeId } from "../../src/domain/document";
import { messagesHr } from "../../src/lib/i18n/messages.hr";
import { post } from "./comment-seed";
import { clickSignOut, signIn } from "./support";
import { closeWork, seedWork, workDocument } from "./work-seed";

// #732 item 7 (contract 6396547184 §6 e2e 1-8): "Kako vidi nastavnik" on
// /rad shows the student's own work exactly as the teacher sees it on
// /nastavnik/rad/<id>, read-only, through the same routes and the same
// component (PRODUCT §5 rule 5). Every account, course, assignment and text
// is invented.

const t = messagesHr;
const OPEN = 30_000;
const TEXT = "Gradske knjižnice su mjesto susreta i učenja.";
const QUOTE = "mjesto susreta";

const editorOf = (page: Page) => page.getByRole("textbox", { name: t.workspace.documentLabel });
const liveTextOf = (page: Page) => page.getByRole("document", { name: t.liveView.documentLabel });
const summaryOf = (page: Page) => page.getByRole("region", { name: t.summary.title });
const modesOf = (page: Page) => page.getByRole("navigation", { name: t.workspace.viewModes });
const switchOf = (page: Page) => modesOf(page).getByRole("link", { name: t.workspace.modeTeacherView });
const offSwitchOf = (page: Page) => modesOf(page).getByRole("button", {
  name: `${t.workspace.modeTeacherView} ${t.workspace.teacherViewOff}`,
});
const pathOf = (request: Request) => new URL(request.url()).pathname;
const isLivePut = (request: Request) => request.method() === "PUT" && /^\/api\/live\//.test(pathOf(request));

/** Every read of the live and summary routes, and every open; the editor's own live PUTs are not reads. */
function recordReads(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "PUT" && /^\/api\/(live\/|process-summary$|evidence\/open$)/.test(pathOf(request))) seen.push(`${request.method()} ${pathOf(request)}`);
  });
  return seen;
}

/** Screenshots at 1440 and 375 px (docs/SESSIONS.md §6), each with axe; `noScroll`: no sideways scroll either. */
async function shoot(page: Page, name: string, noScroll = false): Promise<void> {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await test.info().attach(`${name}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    if (noScroll) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

/** The student signed in, writing TEXT into the own work of a new assignment until it is published. */
async function written(page: Page, seed: Parameters<typeof seedWork>[0] = {}) {
  await signIn(page, "/rad");
  const assignment = await seedWork(seed);
  const published = page.waitForRequest(isLivePut, { timeout: OPEN });
  await page.goto(`/rad?zadatak=${assignment}`);
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
  await editorOf(page).click();
  await page.keyboard.type(TEXT);
  await expect(page.locator(".workspace__status .sync-chip")).toHaveAttribute("data-state", "LOCAL_DURABLE");
  await published;
  return { assignment, documentId: await workDocument(assignment) };
}

test.afterEach(closeWork);

test("student switches to the teacher view and sees the published text read-only; back to writing keeps it", async ({ page }) => {
  const { assignment, documentId } = await written(page);
  await shoot(page, "f8-pisanje");
  const reads = recordReads(page);
  await switchOf(page).click();
  await expect(page).toHaveURL(`/rad?zadatak=${assignment}&prikaz=nastavnik`);
  await expect(switchOf(page)).toHaveAttribute("aria-current", "page");
  await expect(modesOf(page).getByRole("link", { name: t.workspace.modeWriting })).not.toHaveAttribute("aria-current");
  await expect(page.getByText(t.workspace.teacherViewLead)).toBeVisible();
  await expect(liveTextOf(page)).toContainText(TEXT, { timeout: OPEN });
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(page.locator(".editor-toolbar")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: t.recordLimits.title })).toBeVisible();
  await expect(summaryOf(page)).toBeVisible();
  // Typing into the read-only text changes nothing.
  await liveTextOf(page).click();
  await page.keyboard.type("Ne smije se upisati.");
  await expect(liveTextOf(page)).not.toContainText("Ne smije se upisati.");
  await shoot(page, "f8-kako-vidi-nastavnik", true);
  // Only the reads of the student's own document; no other route, no second open.
  expect(new Set(reads)).toEqual(new Set([`GET /api/live/${documentId}`, "POST /api/process-summary"]));

  await modesOf(page).getByRole("link", { name: t.workspace.modeWriting }).click();
  await expect(page).toHaveURL(`/rad?zadatak=${assignment}`);
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  await expect(editorOf(page)).toHaveText(TEXT);
  await expect(page.locator(".workspace__status .sync-chip")).toHaveAttribute("data-state", "LOCAL_DURABLE");
  expect(reads.filter((r) => r.endsWith("/api/evidence/open"))).toEqual([]);
});

test("the student's view of the text is the teacher's view (PRODUCT §5 rule 5)", async ({ browser }) => {
  const teacher = await (await browser.newContext()).newPage();
  const student = await (await browser.newContext()).newPage();
  await signIn(teacher, "/", "Demo nastavnik");
  const { assignment, documentId } = await written(student, { teacher: true });
  const nodeId = (await editorOf(student).locator("p[data-node-id]").first().getAttribute("data-node-id")) as NodeId;
  const start = TEXT.indexOf(QUOTE);
  const anchor = createTextAnchor({ nodeId, nodeText: TEXT, start, end: start + QUOTE.length });
  expect((await post(teacher, "create", { documentId, body: "Dodaj izvor za ovu tvrdnju.", anchor })).status()).toBe(200);

  await student.goto(`/rad?zadatak=${assignment}&prikaz=nastavnik`);
  await teacher.goto(`/nastavnik/rad/${documentId}`);
  for (const page of [student, teacher]) {
    await expect(liveTextOf(page).locator("mark")).toHaveText(QUOTE, { timeout: OPEN });
  }
  // Both read the same ETag within a beat of the reader; the regions are then byte for byte the same.
  await expect.poll(async () => (await liveTextOf(student).innerHTML()) === (await liveTextOf(teacher).innerHTML()))
    .toBe(true);
  // Each card reads once; both read again until they read the same record.
  await expect.poll(async () => {
    const [a, b] = [await summaryOf(student).innerHTML(), await summaryOf(teacher).innerHTML()];
    if (a === b && !a.includes(t.summaryCard.loading)) return true;
    for (const page of [student, teacher]) await page.getByRole("button", { name: t.summaryCard.refresh }).click();
    return false;
  }, { timeout: OPEN, intervals: [2000] }).toBe(true);
});

test("no teacher view without the student's own assignment", async ({ browser, page }) => {
  await signIn(page, "/rad");
  const foreign = await seedWork({ student: null });
  const reads = recordReads(page);
  /** The sheet once it has settled: the free draft's editor open, or the unavailable text. */
  const sheet = async (path: string) => {
    await expect(offSwitchOf(page)).toHaveAttribute("aria-disabled", "true");
    await expect(offSwitchOf(page)).not.toHaveAttribute("href");
    if (path === "/rad") await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
    else await expect(page.locator(".sheet-area")).toContainText(t.workspace.unavailable);
    return page.locator(".sheet-area").innerHTML();
  };
  for (const path of ["/rad", `/rad?zadatak=${foreign}`]) {
    await page.goto(path);
    const plain = await sheet(path);
    await page.goto(`${path}${path.includes("?") ? "&" : "?"}prikaz=nastavnik`);
    expect(await sheet(path)).toBe(plain);
    await expect(page.locator(".teacher-view__lead")).toHaveCount(0);
    await offSwitchOf(page).click({ force: true });
    await expect(page).toHaveURL(new RegExp("prikaz=nastavnik$"));
  }
  // A teacher on the assignment they teach: the F1 unavailable sheet, nothing read.
  const teacher = await (await browser.newContext()).newPage();
  await signIn(teacher, "/", "Demo nastavnik");
  const taught = await seedWork({ teacher: true });
  const teacherReads = recordReads(teacher);
  await teacher.goto(`/rad?zadatak=${taught}&prikaz=nastavnik`);
  await expect(teacher.locator(".sheet-area")).toContainText(t.workspace.unavailable);
  await expect(offSwitchOf(teacher)).toHaveAttribute("aria-disabled", "true");
  await expect(teacher.getByRole("document", { name: t.liveView.documentLabel })).toHaveCount(0);
  expect([...reads, ...teacherReads].filter((r) => !r.endsWith("/api/evidence/open"))).toEqual([]);
});

test("offline in the teacher view keeps the last text and says so", async ({ page, context }) => {
  const { assignment } = await written(page);
  await page.goto(`/rad?zadatak=${assignment}&prikaz=nastavnik`);
  await expect(liveTextOf(page)).toContainText(TEXT, { timeout: OPEN });
  await context.setOffline(true);
  await expect(page.locator(".offline-banner")).toContainText(t.network.offline);
  await expect(page.getByRole("status").filter({ hasText: t.liveView.connection.retrying })).toBeVisible({ timeout: OPEN });
  await expect(liveTextOf(page)).toContainText(TEXT);
  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: t.liveView.connection.live })).toBeVisible({ timeout: OPEN });
});

test("sign-out in another tab removes the text from the teacher view (D-118)", async ({ page }) => {
  const { assignment } = await written(page);
  await page.goto(`/rad?zadatak=${assignment}&prikaz=nastavnik`);
  await expect(liveTextOf(page)).toContainText(TEXT, { timeout: OPEN });
  const second = await page.context().newPage();
  await second.goto("/rad");
  await clickSignOut(second);
  await second.waitForURL("http://localhost:3000/");
  await expect(liveTextOf(page)).toContainText(t.liveView.connection.signedOut);
  await expect(page.getByText(TEXT)).toHaveCount(0);
  await expect(summaryOf(page)).toHaveCount(0);
});

test("keyboard: Pisanje, Kako vidi nastavnik and Predaja in order, each with a visible focus", async ({ page }) => {
  const { assignment } = await written(page);
  await page.goto(`/rad?zadatak=${assignment}&prikaz=nastavnik`);
  await modesOf(page).getByRole("link", { name: t.workspace.modeWriting }).focus();
  const stops: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    if (i > 0) await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    stops.push(((await focused.textContent()) ?? "").trim());
    // The first stop was focused by the test, not by Tab; the focus mark is checked on Tab.
    if (i > 0) expect(await focused.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
  }
  expect(stops).toEqual([t.workspace.modeWriting, t.workspace.modeTeacherView, t.workspace.submitLink]);
});
