import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { createTextAnchor } from "../../src/domain/collaboration";
import type { NodeId } from "../../src/domain/document";
import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { LOCAL_DEMO_DOCUMENT_ID } from "../../src/lib/journal/local-scope";
import { cleanUp, post, seed } from "./comment-seed";
import { clickSignOut, signIn, type DemoAccount } from "./support";

// F-086 and F-088 (#476 contract 6383859615): one browser, one person after
// another. Nothing the previous sign-in held in the page, its text, its undo
// history, its comment threads or a typed reply, reaches the next person;
// the same person gets back only their own journal (D-118). All text is
// invented; the teacher's comment is made in a separate context, as the
// teacher view of the work does not exist yet (comments.spec.ts).

const TEXT = "Gradske knjižnice su mjesto susreta i učenja.";
const QUOTE = "mjesto susreta";
const DRAFT_REPLY = "Nacrt odgovora koji ostaje samo ovoj prijavi.";
const UNPLACED = createTextAnchor({
  nodeId: "5b0c3f1e-7a2d-4e8f-9a61-0c2d3e4f5a6b" as NodeId, nodeText: TEXT,
  start: TEXT.indexOf(QUOTE), end: TEXT.indexOf(QUOTE) + QUOTE.length,
});

const editorOf = (page: Page) => page.getByRole("textbox", { name: t.workspace.documentLabel });
const phaseOf = (page: Page) => page.locator(".editor-surface");
const chipOf = (page: Page) => page.locator(".workspace__status .sync-chip");
const undoOf = (page: Page) => page.getByRole("button", { name: t.toolbar.undo });
const firstCard = (page: Page) => page.getByRole("article", { name: t.comments.number.replace("{n}", "1") });

test.afterEach(cleanUp);

/** The fake provider remembers who signed in; forgetting it shows the account choice again. */
async function forgetProviderLogin(context: BrowserContext): Promise<void> {
  await context.clearCookies({ name: /^_session/ });
}

async function signInAgain(page: Page, account: DemoAccount): Promise<void> {
  await forgetProviderLogin(page.context());
  await signIn(page, "/rad", account);
  await expect(phaseOf(page)).toHaveAttribute("data-phase", "ready", { timeout: 30_000 });
}

async function writeAndWait(page: Page, text: string): Promise<void> {
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true", { timeout: 30_000 });
  await editorOf(page).click();
  await page.keyboard.type(text);
  await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");
}

/** The teacher's comment on the demo document, made with the teacher's own cookie in another context. */
async function teacherComments(browser: Browser): Promise<void> {
  const teacher = await (await browser.newContext()).newPage();
  await signIn(teacher, "/", "Demo nastavnik");
  await seed();
  const created = await post(teacher, "create", { documentId: LOCAL_DEMO_DOCUMENT_ID, body: "Dodaj izvor.", anchor: UNPLACED });
  expect(created.status()).toBe(200);
  await teacher.context().close();
}

/** Undo and redo bring back nothing: the sheet keeps `text` exactly. */
async function nothingToUndo(page: Page, text: string): Promise<void> {
  await expect(undoOf(page)).toBeDisabled();
  await editorOf(page).click();
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(editorOf(page)).toHaveText(text);
}

async function snapshot(page: Page, name: string): Promise<void> {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

test("student, teacher, student in one browser: no text, undo, comment or reply of the sign-in before", async ({ browser, page }) => {
  // The demo teacher must have signed in once before seed() can name them.
  await signIn(page, "/rad");
  await teacherComments(browser);

  await writeAndWait(page, TEXT);
  await expect(undoOf(page)).toBeEnabled();
  await page.reload();
  await firstCard(page).getByRole("textbox", { name: t.comments.replyLabel }).fill(DRAFT_REPLY, { timeout: 30_000 });
  await snapshot(page, "1-studentica-pise");
  await clickSignOut(page);
  await page.waitForURL("http://localhost:3000/");

  await signInAgain(page, "Demo nastavnik");
  await expect(editorOf(page)).toHaveText("");
  await nothingToUndo(page, "");
  await expect(page.getByText(TEXT)).toHaveCount(0);
  await expect(page.getByText(DRAFT_REPLY)).toHaveCount(0);
  await page.reload();
  await expect(phaseOf(page)).toHaveAttribute("data-phase", "ready");
  await expect(editorOf(page)).toHaveText("");
  await snapshot(page, "2-nastavnik-prazan-list");
  await clickSignOut(page);
  await page.waitForURL("http://localhost:3000/");

  // Her own journal comes back (D-118); nothing else of either sign-in does.
  await signInAgain(page, "Demo studentica");
  await expect(editorOf(page)).toHaveText(TEXT);
  await nothingToUndo(page, TEXT);
  await expect(firstCard(page)).toContainText(t.comments.notPlaced);
  await expect(firstCard(page).getByRole("textbox", { name: t.comments.replyLabel })).toHaveValue("");
  await expect(page.getByText(DRAFT_REPLY)).toHaveCount(0);
  await snapshot(page, "3-studentica-ponovno");
});

test("a tab that never heard the session end starts empty when the next person's /rad renders in it", async ({ browser, page }) => {
  // This tab hears no news of the next sign-in: no channel, no storage or
  // pageshow events. The sheet and the panel must not depend on that news.
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "BroadcastChannel");
    const add = window.addEventListener.bind(window);
    window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      if (type !== "storage" && type !== "pageshow") add(type, listener, options);
    }) as typeof window.addEventListener;
  });
  await signIn(page, "/rad");
  await teacherComments(browser);
  await page.reload();
  await writeAndWait(page, TEXT);
  await firstCard(page).getByRole("textbox", { name: t.comments.replyLabel }).fill(DRAFT_REPLY, { timeout: 30_000 });

  const recorded = () => page.evaluate(() => localStorage.getItem("ductus-session-current"));
  const before = await recorded();
  await forgetProviderLogin(page.context());
  // The next person's own tab holds their journal for now.
  const second = await page.context().newPage();
  await signIn(second, "/rad", "Demo student 2");
  await expect(phaseOf(second)).toHaveAttribute("data-phase", "ready", { timeout: 30_000 });
  await expect.poll(recorded).not.toBe(before);

  // The old tab never reloads: its own link renders /rad under the new cookie.
  // While it waits for the journal, the sheet already shows nothing of before.
  await page.getByRole("link", { name: t.workspace.modeWriting }).click();
  await expect(phaseOf(page)).toHaveAttribute("data-phase", "blocked");
  await expect(editorOf(page)).toHaveText("");
  await expect(page.getByText(DRAFT_REPLY)).toHaveCount(0);
  await snapshot(page, "4-kartica-ceka-dnevnik");
  await second.close();
  await expect(phaseOf(page)).toHaveAttribute("data-phase", "ready");
  await expect(editorOf(page)).toHaveText("");
  await nothingToUndo(page, "");
  await expect(page.getByText(TEXT)).toHaveCount(0);
  await expect(page.getByText(DRAFT_REPLY)).toHaveCount(0);
  await expect(firstCard(page)).toHaveCount(0);
  await snapshot(page, "5-kartica-bez-vijesti");

  // The next person's journal holds only what they typed.
  await writeAndWait(page, "Moj tekst.");
  await page.reload();
  await expect(phaseOf(page)).toHaveAttribute("data-phase", "ready");
  await expect(editorOf(page)).toHaveText("Moj tekst.");
});
