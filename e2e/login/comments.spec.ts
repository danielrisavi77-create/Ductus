import { expect, test, type Browser, type Page } from "@playwright/test";

import { createTextAnchor } from "../../src/domain/collaboration";
import type { NodeId } from "../../src/domain/document";
import { messagesHr } from "../../src/lib/i18n/messages.hr";
import { LOCAL_DEMO_DOCUMENT_ID } from "../../src/lib/journal/local-scope";
import { cleanUp, seed } from "./comment-seed";
import { clickSignOut, signIn } from "./support";

// F-9 step 1 (DAN-86): a teacher's comment next to a paragraph reaches the
// student on /rad, through the B-10 route and RPCs. Until the teacher view
// of the saved work (B-11) exists, nothing on screen lets the teacher pick a
// paragraph, so the teacher's step is the same POST the page will send, made
// with the teacher's own session cookie; everything the student sees and
// does runs in the interface. The course, assignment and evidence document
// are invented and written through the admin login of the compose database,
// as no route creates them yet (K-3a #313, F-3 drain). Revisions and
// assignment versions are immutable, so the document and its course stay;
// afterwards the test removes the comments and closes the memberships and the
// teacher role it opened, so no other spec can read the document.

const t = messagesHr.comments;
const ORIGIN = "http://localhost:3000";
const TEXT = "Gradske knjižnice su mjesto susreta i učenja.";
const QUOTE = "mjesto susreta";
const BODY = "Dodaj izvor za ovu tvrdnju. <img src=x onerror=alert(1)>";

const post = (page: Page, action: string, data: object) =>
  page.request.post(`/api/comments/${action}`, { headers: { origin: ORIGIN }, data });

/** The comment cards only; the sheet is an article as well. */
const commentCards = (page: Page) =>
  page.getByRole("article", { name: new RegExp(`^${t.number.replace("{n}", "\\d+")}$`) });

test.afterEach(cleanUp);

test("a teacher's comment next to a paragraph reaches the student, who answers", async ({ browser }) => {
  const teacher = await (await browser.newContext()).newPage();
  const student = await (await browser.newContext()).newPage();
  await signIn(teacher, "/", "Demo nastavnik");
  await signIn(student, "/rad");

  const editor = student.getByRole("textbox", { name: messagesHr.workspace.documentLabel });
  // The first visit of /rad in a run compiles the page and the editor on
  // `next dev`; the journal opens after that, which can exceed 5 s (#431).
  await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 30_000 });
  await editor.click();
  await student.keyboard.type(TEXT);
  await expect(student.locator(".workspace__status .sync-chip")).toHaveAttribute("data-state", "LOCAL_DURABLE");
  const nodeId = (await editor.locator("p[data-node-id]").first().getAttribute("data-node-id")) as NodeId;

  await seed();
  // The student may not open a comment: an anchor would carry text the teacher has not seen.
  const start = TEXT.indexOf(QUOTE);
  const anchor = createTextAnchor({ nodeId, nodeText: TEXT, start, end: start + QUOTE.length });
  expect((await post(student, "create", { documentId: LOCAL_DEMO_DOCUMENT_ID, body: "Ne.", anchor })).status()).toBe(403);
  const created = await post(teacher, "create", { documentId: LOCAL_DEMO_DOCUMENT_ID, body: BODY, anchor });
  expect(created.status()).toBe(200);

  await student.getByRole("button", { name: t.refresh }).click();
  const card = student.getByRole("article", { name: t.number.replace("{n}", "1") });
  await expect(card).toContainText(t.teacher);
  await expect(card).toContainText(`„${QUOTE}”`);
  // Shown as text, never as markup (BACKEND 4.11, attack 10).
  await expect(card.getByText(BODY, { exact: true })).toBeVisible();
  await expect(card.locator("img")).toHaveCount(0);
  await expect(editor.locator(".comment-mark")).toHaveText(QUOTE);
  await test.info().attach("f9-komentar-kod-studenta", { body: await student.screenshot({ fullPage: true }), contentType: "image/png" });

  await card.getByRole("button", { name: t.showInText }).click();
  expect(await student.evaluate(() => window.getSelection()?.toString())).toBe(QUOTE);

  // Text written before the quote moves the mark with it; the document keeps no trace of the comment.
  // "Pokaži u tekstu" left the quote selected: a click on the first line, then Home, puts the cursor before it.
  await editor.locator("p").first().click({ position: { x: 2, y: 4 } });
  await student.keyboard.press("Home");
  await student.keyboard.type("Uvod. ");
  await expect(editor.locator("p").first()).toHaveText(`Uvod. ${TEXT}`);
  await expect(editor.locator(".comment-mark")).toHaveText(QUOTE);

  await card.getByRole("textbox", { name: t.replyLabel }).fill("Hvala, dodat ću izvor.");
  await card.getByRole("button", { name: t.reply }).click();
  await expect(card).toContainText("Hvala, dodat ću izvor.");
  await expect(card).toContainText(t.own);
  await expect(card).toContainText(t.state.answered);
  await test.info().attach("f9-odgovor-studenta", { body: await student.screenshot({ fullPage: true }), contentType: "image/png" });

  // The teacher reads the same list through the same function (PRODUCT §5 rule 5).
  const listed = await (await post(teacher, "list", { documentId: LOCAL_DEMO_DOCUMENT_ID })).json();
  expect(listed.comments.map((c: { authorRole: string; isOwn: boolean; state: string }) => [c.authorRole, c.isOwn, c.state]))
    .toEqual([["teacher", true, "answered"], ["student", false, "answered"]]);

  // Sign-out in a second tab (D-118, F-088): the writing tab drops the threads
  // and a typed reply at once, and a list answer that lands afterwards is dropped too.
  await card.getByRole("textbox", { name: t.replyLabel }).fill("Nacrt odgovora koji ne smije ostati.");
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await student.route("**/api/comments/list", async (route) => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await student.getByRole("button", { name: t.refresh }).click();
  const second = await student.context().newPage();
  await second.goto("/rad");
  await clickSignOut(second);
  await second.waitForURL(`${ORIGIN}/`);
  await expect(editor).toHaveText("");
  // Wait for the held answer itself, never for "networkidle": `next dev`
  // keeps sending hot-update requests, so the page may never go idle (#431).
  const landed = student.waitForResponse((r) => r.url().endsWith("/api/comments/list"));
  release();
  await landed;
  // Two frames: the answer's JSON is read and React has rendered whatever it would.
  await student.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await expect(student.getByText(t.signedOut)).toBeVisible();
  await expect(commentCards(student)).toHaveCount(0);
  await expect(student.getByText(QUOTE)).toHaveCount(0);
  await expect(student.getByRole("textbox", { name: t.replyLabel })).toHaveCount(0);
});

// F-093: a fixed, invented paragraph id; the sheet of these tests never holds it,
// so the comment stays in the list without a place, which is all they need.
const UNPLACED = createTextAnchor({
  nodeId: "0f8e2a64-1b3c-4d5e-8f60-718293a4b5c6" as NodeId, nodeText: TEXT,
  start: TEXT.indexOf(QUOTE), end: TEXT.indexOf(QUOTE) + QUOTE.length,
});

/** The teacher and the student signed in, and one comment of the teacher's, listed on the student's /rad. */
async function commentShown(browser: Browser, prepare: (student: Page) => Promise<unknown>) {
  const teacher = await (await browser.newContext()).newPage();
  const student = await (await browser.newContext()).newPage();
  await signIn(teacher, "/", "Demo nastavnik");
  await signIn(student, "/");
  await seed();
  const created = await post(teacher, "create", { documentId: LOCAL_DEMO_DOCUMENT_ID, body: "Dodaj izvor.", anchor: UNPLACED });
  expect(created.status()).toBe(200);
  await prepare(student);
  await student.goto("/rad");
  const card = student.getByRole("article", { name: t.number.replace("{n}", "1") });
  await expect(card).toContainText(t.notPlaced, { timeout: 30_000 });
  await card.getByRole("textbox", { name: t.replyLabel }).fill("Nacrt odgovora koji ne smije ostati.");
  return { teacher, student, card };
}

test("without IndexedDB the panel still drops the threads when the session ends in another tab (F-093)", async ({ browser }) => {
  const { student } = await commentShown(browser, (page) => page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });
  }));
  await expect(student.getByText(messagesHr.editor.failureUnavailable)).toBeVisible();

  const second = await student.context().newPage();
  await second.goto("/rad");
  await clickSignOut(second);
  await second.waitForURL(`${ORIGIN}/`);
  await expect(student.getByText(t.signedOut)).toBeVisible();
  await expect(commentCards(student)).toHaveCount(0);
  await expect(student.getByText(QUOTE)).toHaveCount(0);
  await expect(student.getByRole("textbox", { name: t.replyLabel })).toHaveCount(0);
});

test("a reply typed before another person signed in at this browser is never sent (F-093)", async ({ browser }) => {
  // The tab hears no news of the new sign-in, as if it came a moment before
  // the teacher's page recorded it; only the check right before sending is left.
  const { teacher, student, card } = await commentShown(browser, (page) => page.addInitScript(() => {
    Reflect.deleteProperty(window, "BroadcastChannel");
    const add = window.addEventListener.bind(window);
    window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      if (type !== "storage") add(type, listener, options);
    }) as typeof window.addEventListener;
  }));
  const replies: string[] = [];
  student.on("request", (request) => {
    if (request.url().endsWith("/api/comments/reply")) replies.push(request.url());
  });
  const recorded = () => student.evaluate(() => localStorage.getItem("ductus-session-current"));
  const before = await recorded();
  // The fake provider remembers who signed in; forgetting it shows the account choice again.
  await student.context().clearCookies({ name: /^_session/ });
  await signIn(await student.context().newPage(), "/", "Demo nastavnik");
  // The teacher's page has recorded its session in this browser.
  await expect.poll(recorded).not.toBe(before);

  await card.getByRole("button", { name: t.reply }).click();
  await expect(student.getByText(t.signedOut)).toBeVisible();
  await expect(commentCards(student)).toHaveCount(0);
  expect(replies).toEqual([]);
  const listed = await (await post(teacher, "list", { documentId: LOCAL_DEMO_DOCUMENT_ID })).json();
  expect(listed.comments).toHaveLength(1);
});
