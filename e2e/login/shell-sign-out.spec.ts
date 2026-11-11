import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import {
  appCookie, clickSignOut, logoutDialogOf, ROLE_HOME, SESSION_COOKIE, sessionRow, signIn, signOutWithoutDialog,
} from "./support";
import { APP_ORIGIN } from "./origin";

// D-118 sign-out dialog (#476 contract c.6396619831 with amendment
// c.6396707923, O1 and O2): before the POST, "Odjava" reads what this
// person's journal on this device still holds. With nothing it signs out at
// once, otherwise the dialog names it. Nothing is deleted from a page
// without the editor. Every test runs in a fresh browser context; all text
// and accounts are invented.

const ORIGIN = APP_ORIGIN;
const PREFIX = "ductus-journal-v1-";
const editorOf = (page: Page) => page.getByRole("textbox", { name: t.workspace.documentLabel });
const chipOf = (page: Page) => page.locator(".workspace__status .sync-chip");
const logoutOf = (page: Page) => page.getByRole("button", { name: t.auth.logout, exact: true });
const phaseOf = (page: Page) => page.locator(".editor-surface");
const noticeOf = (page: Page) => page.locator(".editor-notice[role=alert]");
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

/**
 * Every request to the logout route, as "method type" (DAN-99, as #1444 class
 * 6 for the editor): the page's own fetch, and on success the native POST that
 * follows it to the provider. Nothing else may call the route.
 */
function logoutRequests(context: BrowserContext): string[] {
  const seen: string[] = [];
  context.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/logout") seen.push(`${request.method()} ${request.resourceType()}`);
  });
  return seen;
}
const ONE_FETCH = "POST fetch";
const ENDED_COOKIE = /^ductus-ended-[0-9A-Za-z_-]+$/;

async function endedCookies(context: BrowserContext): Promise<string[]> {
  return (await context.cookies(ORIGIN)).map((c) => c.name).filter((name) => ENDED_COOKIE.test(name));
}

async function snapshot(page: Page, name: string): Promise<void> {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

test("T1: without work on the device, Odjava on /upis signs out at once and creates no journal", async ({ page, context }) => {
  await signIn(page, "/upis");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  const logouts = logoutRequests(context);
  await signOutWithoutDialog(page);
  await expectSignedOut(page, token);
  expect(await journalNames(page)).toEqual([]);
  // DAN-99: the fetch the editor sends, then the native POST on to the provider.
  expect(logouts).toEqual([ONE_FETCH, "POST document"]);
  expect(await endedCookies(context)).toHaveLength(1);
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
      // DAN-249 (#876), A3: the dialog's structure with work on the device.
      await expect(dialog).toMatchAriaSnapshot(`
        - dialog "Odjava":
          - heading "Odjava" [level=2]
          - paragraph: /^\\d+ izmjen/
          - button "Odjavi se"
          - button "Ostani"
      `);
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

// DAN-99 (Z-02, D-118): a 503, no network or no answer within the limit no
// longer leaves for the browser's error page. The session ends on this device,
// the dialog says so, and nothing sends the sign-out again.
for (const answer of ["503", "network", "timeout"] as const) {
  test(`T11: ${answer} on /upis without work: the sign-out ends here and says so, once`, async ({ page, context }) => {
    test.setTimeout(60_000);
    await signIn(page, "/upis");
    const token = (await appCookie(context, SESSION_COOKIE))!.value;
    const logouts = logoutRequests(context);
    await page.route("**/api/auth/logout", async (route) => {
      if (answer === "503") await route.fulfill({ status: 503, body: "" });
      if (answer === "network") await route.abort("internetdisconnected");
    });
    await logoutOf(page).click();
    const dialog = logoutDialogOf(page);
    await expect(dialog.getByRole("alert")).toHaveText(t.auth.logoutDevice, { timeout: 15_000 });
    await expect(dialog).not.toContainText(t.auth.logoutKept);
    await expect(dialog.getByRole("button")).toHaveText([t.auth.logoutClose]);
    await expect(dialog.getByRole("button", { name: t.auth.logoutClose })).toBeFocused();
    expect(page.url()).toBe(`${ORIGIN}/upis`);
    expect(await endedCookies(context)).toHaveLength(1);
    await dialog.getByRole("button", { name: t.auth.logoutClose }).click();
    await expect(dialog).toHaveCount(0);
    await expect(logoutOf(page)).toBeFocused();
    // The route was not reached: the server session waits for its expiry.
    await expectStillSignedIn(page, token);
    expect(await journalNames(page)).toEqual([]);
    // "Odjava" again reads the ended mark and leaves without a second POST;
    // under the kept cookie `/` goes on to /rad, which stays closed.
    await logoutOf(page).click();
    await page.waitForURL(ROLE_HOME);
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "signed-out");
    await expect(editorOf(page)).toHaveText("");
    expect(logouts).toEqual([ONE_FETCH]);
  });
}

test("T12: unsent work and no network: the shell's sign-out keeps the work, stops the /rad tab, and it is back after sign-in", async ({ page, context }) => {
  test.setTimeout(90_000);
  const owed = await workOnDevice(page);
  const shell = await context.newPage();
  await shell.setViewportSize({ width: 1440, height: 900 });
  await shell.goto("/upis");
  const logouts = logoutRequests(context);
  await shell.route("**/api/auth/logout", (route) => route.abort("internetdisconnected"));

  await logoutOf(shell).click();
  const dialog = logoutDialogOf(shell);
  const sentence = (await dialog.locator("p").first().textContent()) ?? "";
  expect(Number(sentence.split(" ")[0])).toBe(owed);
  await dialog.getByRole("button", { name: t.auth.logoutConfirm }).click();
  await expect(dialog.getByRole("alert")).toContainText(t.auth.logoutDevice, { timeout: 15_000 });
  await expect(dialog.getByRole("alert")).toContainText(t.auth.logoutKept);
  await expect(dialog.getByRole("button")).toHaveText([t.auth.logoutClose]);
  await snapshot(shell, "odjava-ljuska-uredaj-rad-1440-tamna");

  // The /rad tab of the same session hears it and shows the text no more.
  await expect(phaseOf(page)).toHaveAttribute("data-phase", "signed-out");
  await expect(editorOf(page)).toHaveText("");
  await expect(page.getByRole("button", { name: t.editor.exportText })).toHaveCount(0);
  // Nothing was deleted from the device (D-118).
  expect(await pendingRows(shell)).toBe(owed);
  expect(logouts).toEqual([ONE_FETCH]);

  await dialog.getByRole("button", { name: t.auth.logoutClose }).click();
  await expect(logoutOf(shell)).toBeFocused();
  await shell.close();
  // "Prijavi se" on /rad signs in anew; the text is back.
  await forgetProviderLogin(context);
  await noticeOf(page).getByRole("link", { name: t.auth.signInAgain }).click();
  await page.getByRole("button", { name: "Demo studentica" }).click();
  await page.waitForURL(`${ORIGIN}/rad`);
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  await expect(editorOf(page)).toHaveText("Nacrt B: zelena bilježnica, druga rečenica");
  expect(logouts).toEqual([ONE_FETCH]);
});

// As the editor's (#1444 N1): another person signs in in a second tab while
// the shell's sign-out waits; only the session of the click ends.
test("T13 Istodobnost: a sign-in in another tab while the shell's sign-out waits keeps the newer session", async ({ page, context }) => {
  test.setTimeout(60_000);
  await signIn(page, "/upis");
  const logouts = logoutRequests(context);
  await page.route("**/api/auth/logout", () => {});
  await logoutOf(page).click();
  await expect.poll(() => logouts).toEqual([ONE_FETCH]);

  await forgetProviderLogin(context);
  const second = await context.newPage();
  await signIn(second, "/upis", "Demo student 2");
  const tokenB = (await appCookie(context, SESSION_COOKIE))!.value;
  await expect(logoutDialogOf(page).getByRole("alert")).toHaveText(t.auth.logoutDevice, { timeout: 15_000 });
  await second.reload();
  await expectStillSignedIn(second, tokenB);
  expect(logouts).toEqual([ONE_FETCH]);
  // B was not marked ended: its own "Odjava" reaches the route and closes it.
  await signOutWithoutDialog(second);
  await expectSignedOut(second, tokenB);
});

// D-183 (#1330, #1336): the shell's dialog after a sign-out that ended on this
// device, full page, both themes, 1440 and 400 px. No new visual element: the
// editor's dialog of the same state (reference docs/design/ductura/m0-rad-reference).
test("D-183: the shell's sign-out that ended on this device, both themes, 1440 and 400 px", async ({ page, context }) => {
  test.setTimeout(120_000);
  const shoot = async (name: string) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await snapshot(page, name);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
  };
  await page.route("**/api/auth/logout", (route) => route.abort("internetdisconnected"));
  // An ended sign-out leaves on the next click, so every picture signs in anew.
  for (const theme of ["tamna", "svijetla"] as const) {
    for (const width of [1440, 400]) {
      await page.setViewportSize({ width, height: 900 });
      await forgetProviderLogin(context);
      await signIn(page, "/upis");
      if (theme === "svijetla" && (await page.locator("html").getAttribute("data-theme")) !== "light") {
        await page.evaluate(() => localStorage.setItem("ductura.theme", "light"));
        await page.reload();
      }
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme === "tamna" ? "dark" : "light");
      // On a phone "Odjava" sits in the drawer behind the menu button.
      if (width === 400) await page.getByRole("button", { name: t.shell.openNav }).click();
      await logoutOf(page).click();
      const dialog = logoutDialogOf(page);
      await expect(dialog.getByRole("alert")).toHaveText(t.auth.logoutDevice, { timeout: 15_000 });
      await shoot(`odjava-ljuska-uredaj-${theme}-${width}`);
      await dialog.getByRole("button", { name: t.auth.logoutClose }).click();
      await expect(dialog).toHaveCount(0);
    }
  }
});
