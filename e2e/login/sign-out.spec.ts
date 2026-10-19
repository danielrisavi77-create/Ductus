import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { appCookie, clickSignOut, logoutDialogOf, SESSION_COOKIE, sessionRow, signIn } from "./support";

// F-5 (DAN-34, plan #376): the writing page of a signed-in person and the
// sign-out that always ends the session (D-118). Every test runs in a
// fresh browser context, so IndexedDB and the provider's cookies start empty.
// All text is invented.

const editorOf = (page: Page) => page.getByRole("textbox", { name: t.workspace.documentLabel });
const phaseOf = (page: Page) => page.locator(".editor-surface");
const noticeOf = (page: Page) => page.locator(".editor-notice[role=alert]");
const chipOf = (page: Page) => page.locator(".workspace__status .sync-chip");
const logoutOf = (page: Page) => page.getByRole("button", { name: t.auth.logout, exact: true });

async function writeAndWait(page: Page, text: string): Promise<void> {
  await editorOf(page).click();
  await page.keyboard.type(text);
  await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");
}

async function journalNames(page: Page): Promise<(string | undefined)[]> {
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  return names.filter((name) => name?.startsWith("ductus-journal-v1-"));
}

/** The fake provider remembers who signed in; forgetting it shows the account choice again. */
async function forgetProviderLogin(context: BrowserContext): Promise<void> {
  await context.clearCookies({ name: /^_session/ });
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
  // The home page's way in is the sign-in screen (FE-H1, FE-D3); start at
  // the login route its AAI@EduHr button links to.
  await page.goto(`/api/auth/login?returnTo=${encodeURIComponent("/rad")}`);
  await page.getByRole("button", { name: "Demo studentica" }).click();
  await page.waitForURL("http://localhost:3000/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;

  await clickSignOut(page);
  await page.waitForURL("http://localhost:3000/");
  expect(await appCookie(context, SESSION_COOKIE)).toBeUndefined();
  expect(await sessionRow(token)).toMatchObject({ close_reason: "logout", closed_at: expect.any(Date) });
  // Nothing was written, so nothing of that person stays on the device.
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(names.filter((name) => name?.startsWith("ductus-journal-v1-"))).toEqual([]);
});

// D-118: sign-out always ends the session. Work the server has not confirmed
// stays in the person's own journal and comes back at their next sign-in;
// another account in the same browser never sees it.
test("rows 2, 3 and 5: a local change does not hold the session open; the text waits for the same person", async ({ page, context }) => {
  await signIn(page, "/rad");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  await writeAndWait(page, "Nacrt A: plava bilježnica");

  await clickSignOut(page);
  await page.waitForURL("http://localhost:3000/");
  expect(await appCookie(context, SESSION_COOKIE)).toBeUndefined();
  expect(await sessionRow(token)).toMatchObject({ close_reason: "logout", closed_at: expect.any(Date) });
  expect(await journalNames(page)).toHaveLength(1);

  // Another account in this browser: an empty sheet, and its sign-out
  // leaves the first journal alone.
  await forgetProviderLogin(context);
  await signIn(page, "/rad", "Demo nastavnik");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  await expect(editorOf(page)).toHaveText("");
  await clickSignOut(page);
  await page.waitForURL("http://localhost:3000/");

  await forgetProviderLogin(context);
  await signIn(page, "/rad");
  await expect(editorOf(page)).toHaveText("Nacrt A: plava bilježnica");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
});

test("row 3: a sign-out the server never got deletes nothing and says so", async ({ page, context }) => {
  await signIn(page, "/rad");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  await page.route("**/api/auth/logout", (route) => route.abort("internetdisconnected"));

  // Even an unchanged document keeps its journal while the session is open.
  // The failure is said in the dialog, which stays open for another try.
  const dialog = logoutDialogOf(page);
  await clickSignOut(page);
  await expect(dialog.getByRole("alert")).toHaveText(t.auth.logoutFailed);
  await expectStillSignedIn(page, token);
  expect(await journalNames(page)).toHaveLength(1);
  await dialog.getByRole("button", { name: t.auth.logoutStay }).click();
  await expect(dialog).toHaveCount(0);

  await writeAndWait(page, "Nacrt A: plava bilježnica");
  await clickSignOut(page);
  await expect(dialog.getByRole("alert")).toHaveText(t.auth.logoutFailed);
  // A second try in the same dialog fails the same way and deletes nothing.
  await dialog.getByRole("button", { name: t.auth.logoutConfirm }).click();
  await expect(dialog.getByRole("alert")).toHaveText(t.auth.logoutFailed);
  expect(page.url()).toBe("http://localhost:3000/rad");
  await expectStillSignedIn(page, token);
  await dialog.getByRole("button", { name: t.auth.logoutStay }).click();
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  await writeAndWait(page, ", dopuna");

  await page.unroute("**/api/auth/logout");
  await clickSignOut(page);
  await page.waitForURL("http://localhost:3000/");
  expect(await sessionRow(token)).toMatchObject({ close_reason: "logout" });
  await forgetProviderLogin(context);
  await signIn(page, "/rad");
  await expect(editorOf(page)).toHaveText("Nacrt A: plava bilježnica, dopuna");
});

test("sign-out from a second tab ends the session and empties the writing tab", async ({ page, context }) => {
  await signIn(page, "/rad");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  await writeAndWait(page, "Nacrt A: plava bilježnica");

  const second = await context.newPage();
  await second.goto("/rad");
  await expect(phaseOf(second)).toHaveAttribute("data-phase", "blocked");
  await clickSignOut(second);
  await second.waitForURL("http://localhost:3000/");
  expect(await sessionRow(token)).toMatchObject({ close_reason: "logout" });

  await expect(phaseOf(page)).toHaveAttribute("data-phase", "signed-out");
  await expect(noticeOf(page)).toHaveText(t.auth.signedOutElsewhere);
  await expect(editorOf(page)).toHaveText("");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "false");
  await expect(page.getByRole("button", { name: t.editor.exportText })).toHaveCount(0);
  // The button still works there; it never stays disabled.
  await expect(logoutOf(page)).toBeEnabled();

  await page.close();
  await forgetProviderLogin(context);
  await signIn(second, "/rad");
  await expect(editorOf(second)).toHaveText("Nacrt A: plava bilježnica");
});

test("row 9: the dialog says text the device could not store would be lost; sign-out goes ahead", async ({ page, context }) => {
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
  const dialog = logoutDialogOf(page);
  await expect(dialog).toContainText(t.auth.logoutUnsaved);
  await expect(dialog.getByRole("button", { name: t.editor.exportText })).toBeVisible();
  await expect(editorOf(page)).toHaveText("Nacrt A: plava bilježnica");
  await expectStillSignedIn(page, token);

  await dialog.getByRole("button", { name: t.auth.logoutConfirm }).click();
  await page.waitForURL("http://localhost:3000/");
  expect(await sessionRow(token)).toMatchObject({ close_reason: "logout" });
});

/** Rows the journal of this browser still owes (`pending`), read straight from IndexedDB. */
async function pendingRows(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const names = (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("ductus-journal-v1-"));
    let total = 0;
    for (const name of names) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      total += await new Promise<number>((resolve, reject) => {
        const request = db.transaction("pending", "readonly").objectStore("pending").count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
    }
    return total;
  });
}

// FE-D7 (contract #476 6273153537): the dialog names the saved steps the
// journal still holds, and "Ostani" or Escape change nothing.
test("FE-D7: the dialog names what stays on this device; Ostani and Escape keep the session", async ({ page, context }) => {
  await signIn(page, "/rad");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  const dialog = logoutDialogOf(page);

  // Nothing written: no number at all.
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  await logoutOf(page).click();
  await expect(dialog).toContainText(t.auth.logoutPlain);
  await expect(dialog).not.toContainText(/\d/);
  await expect(dialog.getByRole("button", { name: t.auth.logoutStay })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(logoutOf(page)).toBeFocused();
  await expectStillSignedIn(page, token);

  await writeAndWait(page, "Nacrt A: plava bilježnica");
  await writeAndWait(page, ", dopuna");
  await logoutOf(page).click();
  await expect(dialog).toContainText(t.auth.logoutKept);
  const owed = await pendingRows(page);
  expect(owed).toBeGreaterThan(0);
  // The main sentence starts with the number: "N izmjena postoji …".
  const sentence = (await dialog.locator("p").first().textContent()) ?? "";
  expect(sentence).toMatch(/^\d+ izmjen/);
  expect(Number(sentence.split(" ")[0])).toBe(owed);
  // The sheet takes no input while the dialog is open, so the number holds.
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "false");

  await dialog.getByRole("button", { name: t.auth.logoutStay }).click();
  await expect(dialog).toHaveCount(0);
  await expect(logoutOf(page)).toBeFocused();
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  await expect(editorOf(page)).toHaveText("Nacrt A: plava bilježnica, dopuna");
  await expectStillSignedIn(page, token);
  expect(await pendingRows(page)).toBe(owed);

  await clickSignOut(page);
  await page.waitForURL("http://localhost:3000/");
  expect(await sessionRow(token)).toMatchObject({ close_reason: "logout" });
  await forgetProviderLogin(context);
  await signIn(page, "/rad");
  await expect(editorOf(page)).toHaveText("Nacrt A: plava bilježnica, dopuna");
});

test("a sign-in through the login route stops the tab of the session it replaced", async ({ page, context }) => {
  await signIn(page, "/rad");
  await writeAndWait(page, "Nacrt A: plava bilježnica");

  // No sign-out at all: another account signs in straight through the route.
  await forgetProviderLogin(context);
  const second = await context.newPage();
  await signIn(second, "/rad", "Demo nastavnik");
  await expect(editorOf(second)).toHaveText("");

  await expect(phaseOf(page)).toHaveAttribute("data-phase", "signed-out");
  await expect(editorOf(page)).toHaveText("");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "false");
});

test("a stopped tab that opens the next person's sheet starts with nothing to undo", async ({ page, context }) => {
  await signIn(page, "/rad");
  await writeAndWait(page, "Nacrt A: plava bilježnica");

  await forgetProviderLogin(context);
  const second = await context.newPage();
  await signIn(second, "/rad", "Demo nastavnik");
  await expect(phaseOf(page)).toHaveAttribute("data-phase", "signed-out");
  await expect(editorOf(page)).toHaveText("");
  await second.close();

  // The old tab never reloads: its own link renders /rad under the new cookie.
  await page.getByRole("link", { name: t.workspace.modeWriting }).click();
  await expect(phaseOf(page)).toHaveAttribute("data-phase", "ready");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  await expect(page.getByRole("button", { name: t.toolbar.undo })).toBeDisabled();

  await editorOf(page).click();
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editorOf(page)).toHaveText("");
  await page.waitForTimeout(1_000);
  await page.reload();
  await expect(phaseOf(page)).toHaveAttribute("data-phase", "ready");
  await expect(editorOf(page)).toHaveText("");
});

test("a tab opened before a sign-out works again after the next sign-in", async ({ page, context }) => {
  await signIn(page, "/");
  const second = await context.newPage();
  await second.goto("/rad");
  await expect(editorOf(second)).toHaveAttribute("contenteditable", "true");
  await clickSignOut(second);
  await second.waitForURL("http://localhost:3000/");
  await forgetProviderLogin(context);
  await signIn(second, "/rad");
  await second.close();

  // The first tab never reloaded; its link renders /rad under the new cookie.
  await page.getByRole("link", { name: t.home.openWorkspace }).click();
  await page.waitForURL("http://localhost:3000/rad");
  await expect(phaseOf(page)).toHaveAttribute("data-phase", "ready");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
});

test("a tab waiting for the document stops for good when another tab signs out", async ({ page, context }) => {
  await signIn(page, "/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  const second = await context.newPage();
  await second.goto("/rad");
  await expect(phaseOf(second)).toHaveAttribute("data-phase", "blocked");

  await clickSignOut(page);
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

  await clickSignOut(page);
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
