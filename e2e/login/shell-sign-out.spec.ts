import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import {
  appCookie, clickSignOut, logoutDialogOf, SESSION_COOKIE, sessionRow, signIn, signOutWithoutDialog,
} from "./support";

// D-118 sign-out dialog (#476 contract c.6396619831 with amendment
// c.6396707923, O1 and O2): before the POST, "Odjava" reads what this
// person's journal on this device still holds. With nothing it signs out at
// once, otherwise the dialog names it. Nothing is deleted from a page
// without the editor. Every test runs in a fresh browser context; all text
// and accounts are invented.

const ORIGIN = "http://localhost:3000";
const PREFIX = "ductus-journal-v1-";
const editorOf = (page: Page) => page.getByRole("textbox", { name: t.workspace.documentLabel });
const chipOf = (page: Page) => page.locator(".workspace__status .sync-chip");
const logoutOf = (page: Page) => page.getByRole("button", { name: t.auth.logout, exact: true });
// An invented assignment id: the notice page shows its shell and "not found".
const NOTICE = "/zadatak/5d1c9a2e-7b3f-4e6a-9c8d-0f1e2d3c4b5a";

async function writeAndWait(page: Page, text: string): Promise<void> {
  await editorOf(page).click();
  await page.keyboard.type(text);
  await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");
}

async function journalNames(page: Page): Promise<string[]> {
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ""));
  return names.filter((name) => name.startsWith("ductus-journal-v1-"));
}

/**
 * Changes every journal of this browser with the raw IndexedDB API, as only
 * a test does: `confirm` leaves each document as a verified receipt would
 * (no owed row, SYNCED); `move` also moves the owed rows, the snapshot and
 * the state to another invented document of the same person.
 */
async function rewriteJournals(page: Page, mode: "confirm" | "move"): Promise<void> {
  await page.evaluate(async ({ prefix, mode: how }) => {
    const OTHER = "6e5d4c3b-2a19-4807-b6f5-e4d3c2b1a090";
    const done = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const names = (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith(prefix));
    for (const name of names) {
      const db = await done(indexedDB.open(name));
      try {
        const tx = db.transaction(["pending", "meta", "snapshots"], "readwrite");
        const pending = tx.objectStore("pending");
        const meta = tx.objectStore("meta");
        const snapshots = tx.objectStore("snapshots");
        const rows = await done(pending.getAll()) as { documentId: string }[];
        const metas = await done(meta.getAll()) as { documentId: string }[];
        if (how === "move") {
          for (const row of rows) await done(pending.put({ ...row, documentId: OTHER }));
          for (const row of metas) await done(meta.put({ ...row, documentId: OTHER }));
          for (const row of await done(snapshots.getAll()) as { documentId: string }[]) {
            await done(snapshots.put({ ...row, documentId: OTHER }));
          }
        }
        for (const row of rows as { documentId: string; localSeq: number }[]) {
          await done(pending.delete([row.documentId, row.localSeq]));
        }
        for (const row of metas) await done(meta.put({ ...row, state: "SYNCED" }));
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    }
  }, { prefix: PREFIX, mode });
}

/** Owed rows of every journal in this browser. */
async function pendingRows(page: Page): Promise<number> {
  return page.evaluate(async (prefix) => {
    const names = (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith(prefix));
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
  }, PREFIX);
}

async function forgetProviderLogin(context: BrowserContext): Promise<void> {
  await context.clearCookies({ name: /^_session/ });
}

async function expectStillSignedIn(page: Page, token: string): Promise<void> {
  expect((await appCookie(page.context(), SESSION_COOKIE))?.value).toBe(token);
  expect(await sessionRow(token)).toMatchObject({ closed_at: null });
}

async function expectSignedOut(page: Page, token: string): Promise<void> {
  expect(page.url()).toBe(`${ORIGIN}/`);
  expect(await appCookie(page.context(), SESSION_COOKIE)).toBeUndefined();
  expect(await sessionRow(token)).toMatchObject({ close_reason: "logout", closed_at: expect.any(Date) });
}

/** Writes in the free draft of /rad until the device holds it, and returns how many rows it owes. */
async function workOnDevice(page: Page): Promise<number> {
  await signIn(page, "/rad");
  await writeAndWait(page, "Nacrt B: zelena bilježnica");
  await writeAndWait(page, ", druga rečenica");
  const owed = await pendingRows(page);
  expect(owed).toBeGreaterThan(0);
  return owed;
}

async function snapshot(page: Page, name: string): Promise<void> {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

test("T1: without work on the device, Odjava on /upis signs out at once and creates no journal", async ({ page, context }) => {
  await signIn(page, "/upis");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  await signOutWithoutDialog(page);
  await expectSignedOut(page, token);
  expect(await journalNames(page)).toEqual([]);
});

test("T2 and T3: work of this person opens the dialog with its number; another person's never does", async ({ page, context }) => {
  const owed = await workOnDevice(page);
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  await page.goto("/upis");
  await logoutOf(page).click();
  const dialog = logoutDialogOf(page);
  await expect(dialog).toBeVisible();
  const sentence = (await dialog.locator("p").first().textContent()) ?? "";
  expect(sentence).toMatch(/^\d+ izmjen/);
  expect(Number(sentence.split(" ")[0])).toBe(owed);
  await expect(dialog).toContainText(t.auth.logoutKept);
  // Only the device: nothing about the server, and nothing to export here.
  await expect(dialog.getByRole("button", { name: t.editor.exportText })).toHaveCount(0);
  await dialog.getByRole("button", { name: t.auth.logoutConfirm }).click();
  await page.waitForURL(`${ORIGIN}/`);
  await expectSignedOut(page, token);
  // Nothing was deleted from a page without the editor.
  expect(await journalNames(page)).toHaveLength(1);
  expect(await pendingRows(page)).toBe(owed);

  // T3: another person in this browser: their journal holds nothing, and
  // the first person's is neither seen nor counted.
  await forgetProviderLogin(context);
  await signIn(page, "/upis", "Demo student 2");
  const other = (await appCookie(context, SESSION_COOKIE))!.value;
  await signOutWithoutDialog(page);
  await expectSignedOut(page, other);
  expect(await journalNames(page)).toHaveLength(1);

  // The same person signs in again and has the text back (D-118).
  await forgetProviderLogin(context);
  await signIn(page, "/rad");
  await expect(editorOf(page)).toHaveText("Nacrt B: zelena bilježnica, druga rečenica");
});

test("T4: Ostani and Escape keep the session and give the focus back to Odjava; the dialog passes axe", async ({ page, context }) => {
  await workOnDevice(page);
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  for (const path of ["/upis", NOTICE]) {
    await page.goto(path);
    const dialog = logoutDialogOf(page);
    await logoutOf(page).click();
    await expect(dialog.getByRole("button", { name: t.auth.logoutStay })).toBeFocused();
    // The keyboard moves between the dialog's own buttons; the page behind is inert.
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: t.auth.logoutConfirm })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: t.auth.logoutStay })).toBeFocused();
    if (path === "/upis") {
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
    }
    const name = path === "/upis" ? "upis" : "zadatak";
    await snapshot(page, `odjava-dijalog-${name}-1440-tamna`);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(logoutOf(page)).toBeFocused();
    await expectStillSignedIn(page, token);

    // The light theme, then "Ostani".
    await page.getByRole("button", { name: t.shell.theme }).click();
    await logoutOf(page).click();
    await expect(dialog).toBeVisible();
    await snapshot(page, `odjava-dijalog-${name}-1440-svijetla`);
    await dialog.getByRole("button", { name: t.auth.logoutStay }).click();
    await expect(dialog).toHaveCount(0);
    await expect(logoutOf(page)).toBeFocused();
    await expectStillSignedIn(page, token);

    // On a phone "Odjava" sits in the drawer behind ☰; the dialog opens over it.
    await page.setViewportSize({ width: 375, height: 812 });
    for (const theme of ["svijetla", "tamna"]) {
      await page.getByRole("button", { name: t.shell.openNav }).click();
      await logoutOf(page).click();
      await expect(dialog).toBeVisible();
      await snapshot(page, `odjava-dijalog-${name}-375-${theme}`);
      await dialog.getByRole("button", { name: t.auth.logoutStay }).click();
      await expect(dialog).toHaveCount(0);
      // Escape now closes the drawer, then the theme changes.
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: t.shell.theme }).click();
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    // Back to the dark theme for the next page.
    await page.getByRole("button", { name: t.shell.theme }).click();
    await expect(page.locator("[data-theme]").first()).toHaveAttribute("data-theme", "dark");
    await expectStillSignedIn(page, token);
  }
});

test("T5: a journal that cannot be read gives the dialog without a number; Odjavi se still ends the session", async ({ page, context }) => {
  await signIn(page, "/upis");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number) {
      if (name.startsWith("ductus-journal-v1-")) throw new DOMException("Made-up refusal", "SecurityError");
      return version === undefined ? open.call(this, name) : open.call(this, name, version);
    };
  });
  await page.goto("/upis");
  await logoutOf(page).click();
  const dialog = logoutDialogOf(page);
  await expect(dialog).toContainText(t.auth.logoutPlain);
  await expect(dialog).not.toContainText(/\d/);
  await expect(dialog).not.toContainText(t.auth.logoutKept);
  await dialog.getByRole("button", { name: t.auth.logoutConfirm }).click();
  await page.waitForURL(`${ORIGIN}/`);
  await expectSignedOut(page, token);
});

test("T6: a teacher without work on the device signs out of /nastavnik without a dialog", async ({ page, context }) => {
  await signIn(page, "/nastavnik", "Demo nastavnik");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  await expect(logoutOf(page)).toBeVisible();
  await signOutWithoutDialog(page);
  await expectSignedOut(page, token);
  expect(await journalNames(page)).toEqual([]);
});

test("T8: on /rad, a journal that holds nothing signs out without a dialog and is deleted as before", async ({ page, context }) => {
  // An unchanged sheet.
  await signIn(page, "/rad");
  let token = (await appCookie(context, SESSION_COOKIE))!.value;
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  await signOutWithoutDialog(page);
  await expectSignedOut(page, token);
  expect(await journalNames(page)).toEqual([]);

  // Written, then confirmed. The browser cannot reach SYNCED on /rad yet
  // (3d-2c2), so the confirmation is written straight into the journal as a
  // signed receipt would leave it: no owed row, the document SYNCED.
  await forgetProviderLogin(context);
  await signIn(page, "/rad");
  token = (await appCookie(context, SESSION_COOKIE))!.value;
  await writeAndWait(page, "Nacrt C: potvrđeno");
  await rewriteJournals(page, "confirm");
  expect(await pendingRows(page)).toBe(0);
  await signOutWithoutDialog(page);
  await expectSignedOut(page, token);
  expect(await journalNames(page)).toEqual([]);
});

test("T9: on /rad the number counts the whole scope, also a document that is not open", async ({ page, context }) => {
  const owed = await workOnDevice(page);
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  // The rows move to another invented document of the same person; the open
  // one is left confirmed (as in T8).
  await rewriteJournals(page, "move");
  expect(await pendingRows(page)).toBe(owed);
  await page.reload();
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");

  await logoutOf(page).click();
  const dialog = logoutDialogOf(page);
  const sentence = (await dialog.locator("p").first().textContent()) ?? "";
  expect(Number(sentence.split(" ")[0])).toBe(owed);
  await expect(dialog).toContainText(t.auth.logoutKept);
  await dialog.getByRole("button", { name: t.auth.logoutConfirm }).click();
  await page.waitForURL(`${ORIGIN}/`);
  await expectSignedOut(page, token);
  // The work of the other document stays (D-118).
  expect(await pendingRows(page)).toBe(owed);
});

test("T10: on /rad without a network, unsent changes open the dialog as before, with their number", async ({ page, context }) => {
  await signIn(page, "/rad");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  await context.setOffline(true);
  try {
    await writeAndWait(page, "Nacrt D: bez mreže");
    const owed = await pendingRows(page);
    expect(owed).toBeGreaterThan(0);
    await logoutOf(page).click();
    const dialog = logoutDialogOf(page);
    const sentence = (await dialog.locator("p").first().textContent()) ?? "";
    expect(Number(sentence.split(" ")[0])).toBe(owed);
    await dialog.getByRole("button", { name: t.auth.logoutStay }).click();
    await expect(dialog).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }
  await expectStillSignedIn(page, token);
  await clickSignOut(page);
  await page.waitForURL(`${ORIGIN}/`);
  await expectSignedOut(page, token);
});
