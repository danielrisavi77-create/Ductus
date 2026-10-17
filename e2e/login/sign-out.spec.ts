import { expect, test, type Page } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { appCookie, SESSION_COOKIE, sessionRow, signIn } from "./support";

// F-5 (DAN-34, plan #376): the writing page of a signed-in person and the
// sign-out that goes through the local journal first. Every test runs in a
// fresh browser context, so IndexedDB and the provider's cookies start empty.
// All text is invented.

const editorOf = (page: Page) => page.getByRole("textbox", { name: t.workspace.documentLabel });
const phaseOf = (page: Page) => page.locator(".editor-surface");
const noticeOf = (page: Page) => page.locator(".editor-notice[role=alert]");
const chipOf = (page: Page) => page.locator(".workspace__status .sync-chip");
const logoutOf = (page: Page) => page.getByRole("button", { name: t.auth.logout });

async function writeAndWait(page: Page, text: string): Promise<void> {
  await editorOf(page).click();
  await page.keyboard.type(text);
  await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");
}

async function expectStillSignedIn(page: Page, token: string): Promise<void> {
  expect((await appCookie(page.context(), SESSION_COOKIE))?.value).toBe(token);
  expect(await sessionRow(token)).toMatchObject({ closed_at: null });
}

test("row 1: without a session /rad shows no one as signed in", async ({ page, context }) => {
  await page.goto("/rad");
  await expect(logoutOf(page)).toHaveCount(0);

  // A cookie of the right shape that no open session has: nothing is shown
  // as signed in, no journal opens, and signing in again is offered.
  await context.addCookies([{
    name: SESSION_COOKIE, value: "Z".repeat(43), domain: "localhost", path: "/",
    secure: true, httpOnly: true, sameSite: "Lax",
  }]);
  await page.goto("/rad");
  await expect(logoutOf(page)).toHaveCount(0);
  await expect(page.getByRole("link", { name: t.auth.signIn })).toHaveAttribute(
    "href", "/api/auth/login?returnTo=%2Frad",
  );
  await expect(page.locator(".editor-surface")).toHaveCount(0);
});

test("row 1: sign-in leads to an editable sheet; sign-out of an unchanged document ends the session", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("link", { name: t.auth.signIn }).click();
  await page.getByRole("button", { name: "Demo studentica" }).click();
  await page.waitForURL("http://localhost:3000/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;

  await logoutOf(page).click();
  await page.waitForURL("http://localhost:3000/");
  expect(await appCookie(context, SESSION_COOKIE)).toBeUndefined();
  expect(await sessionRow(token)).toMatchObject({ close_reason: "logout", closed_at: expect.any(Date) });
  // The journal of that person went before the session did.
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(names.filter((name) => name?.startsWith("ductus-journal-v1-"))).toEqual([]);
});

for (const offline of [false, true]) {
  test(`rows 2 and 3: a change ${offline ? "made offline " : ""}blocks sign-out, keeps the session and the text`, async ({ page, context }) => {
    await signIn(page, "/rad");
    const token = (await appCookie(context, SESSION_COOKIE))!.value;
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    if (offline) await context.setOffline(true);
    await writeAndWait(page, "Nacrt A: plava bilježnica");

    await logoutOf(page).click();
    await expect(noticeOf(page)).toHaveText(t.auth.logoutUnsynced);
    await expect(page.getByRole("button", { name: t.editor.exportText })).toBeVisible();
    // Never shown as on the server; writing goes on.
    await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    await writeAndWait(page, ", dopuna");
    expect(page.url()).toBe("http://localhost:3000/rad");
    if (offline) await context.setOffline(false);
    await expectStillSignedIn(page, token);

    // Row 4: a new load of the page finds the text and refuses again.
    await page.reload();
    await expect(editorOf(page)).toHaveText("Nacrt A: plava bilježnica, dopuna");
    await logoutOf(page).click();
    await expect(noticeOf(page)).toHaveText(t.auth.logoutUnsynced);
    await expectStillSignedIn(page, token);
  });
}

test("a second tab of the same document does not sign out under the first", async ({ page, context }) => {
  await signIn(page, "/rad");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");

  const second = await context.newPage();
  await second.goto("/rad");
  await expect(phaseOf(second)).toHaveAttribute("data-phase", "blocked");
  await logoutOf(second).click();
  await expect(noticeOf(second)).toHaveText(t.auth.logoutOtherTab);
  await expectStillSignedIn(second, token);
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
});

test("row 9: a first save the device refuses keeps sign-out refused and the text exportable", async ({ page, context }) => {
  // Journal writes fail as on a full device; only the logout fence could
  // still be written, so the journal alone would look empty.
  await page.addInitScript(() => {
    const { put, add } = IDBObjectStore.prototype;
    const refuse = (original: typeof put) => function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === "control") return original.apply(this, args);
      throw new DOMException("Made-up full device", "QuotaExceededError");
    };
    Object.assign(IDBObjectStore.prototype, { put: refuse(put), add: refuse(add) });
  });
  await signIn(page, "/rad");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  await editorOf(page).click();
  await page.keyboard.type("Nacrt A: plava bilježnica");
  await expect(chipOf(page)).toHaveAttribute("data-state", "ERROR");

  await logoutOf(page).click();
  await expect(noticeOf(page)).toHaveText(t.auth.logoutUnsynced);
  await expect(page.getByRole("button", { name: t.editor.exportText })).toBeVisible();
  await expect(editorOf(page)).toHaveText("Nacrt A: plava bilježnica");
  await expectStillSignedIn(page, token);
});

test("a tab waiting for the document stops for good when another tab signs out", async ({ page, context }) => {
  await signIn(page, "/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  const second = await context.newPage();
  await second.goto("/rad");
  await expect(phaseOf(second)).toHaveAttribute("data-phase", "blocked");

  await logoutOf(page).click();
  await page.waitForURL("http://localhost:3000/");
  await expect(phaseOf(second)).toHaveAttribute("data-phase", "signed-out");
  await expect(noticeOf(second)).toHaveText(t.auth.signedOutElsewhere);
  // The first tab has left and freed the lock; the second never takes it,
  // so the deleted journal is not created again.
  await page.close();
  await second.waitForTimeout(1_000);
  await expect(phaseOf(second)).toHaveAttribute("data-phase", "signed-out");
  await expect(editorOf(second)).toHaveAttribute("contenteditable", "false");
  const names = await second.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(names.filter((name) => name?.startsWith("ductus-journal-v1-"))).toEqual([]);
});

test("a tab that missed the sign-out news still never reopens the journal", async ({ page, context }) => {
  await signIn(page, "/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  // Loaded before the sign-out but not listening for it, as a tab that is
  // still starting up would be.
  const second = await context.newPage();
  await second.addInitScript(() => {
    Reflect.deleteProperty(window, "BroadcastChannel");
  });
  await second.goto("/rad");
  await expect(phaseOf(second)).toHaveAttribute("data-phase", "blocked");

  await logoutOf(page).click();
  await page.waitForURL("http://localhost:3000/");
  await page.close();
  await expect(phaseOf(second)).toHaveAttribute("data-phase", "signed-out");
  await expect(noticeOf(second)).toHaveText(t.auth.signedOutElsewhere);
  await expect(editorOf(second)).toHaveAttribute("contenteditable", "false");
  const names = await second.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(names.filter((name) => name?.startsWith("ductus-journal-v1-"))).toEqual([]);
});

test("with a session the home page offers no second sign-in", async ({ page }) => {
  await signIn(page, "/");
  await expect(page.getByRole("link", { name: t.home.openWorkspace })).toBeVisible();
  await expect(page.getByRole("link", { name: t.auth.signIn })).toHaveCount(0);
});
