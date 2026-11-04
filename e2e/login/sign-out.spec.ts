import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import {
  appCookie, clickSignOut, editorMounted, logoutDialogOf, SESSION_COOKIE, sessionRow, signIn, signOutWithoutDialog,
} from "./support";
import { APP_HOST, APP_ORIGIN } from "./origin";

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
    name: SESSION_COOKIE, value: "Z".repeat(43), domain: APP_HOST, path: "/",
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
  await page.waitForURL(`${APP_ORIGIN}/rad`);
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;

  // Nothing of this person stays on the device, so no dialog (O1, #476 c.6396707923).
  await signOutWithoutDialog(page);
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
  await page.waitForURL(`${APP_ORIGIN}/`);
  expect(await appCookie(context, SESSION_COOKIE)).toBeUndefined();
  expect(await sessionRow(token)).toMatchObject({ close_reason: "logout", closed_at: expect.any(Date) });
  expect(await journalNames(page)).toHaveLength(1);

  // Another account in this browser: an empty sheet, and its sign-out
  // leaves the first journal alone.
  await forgetProviderLogin(context);
  await signIn(page, "/rad", "Demo nastavnik");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  await expect(editorOf(page)).toHaveText("");
  // The other account's journal holds nothing, and the first one is not counted (O1, O2).
  await signOutWithoutDialog(page);

  await forgetProviderLogin(context);
  await signIn(page, "/rad");
  await expect(editorOf(page)).toHaveText("Nacrt A: plava bilježnica");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
});

/** localStorage refuses these calls for the app's own keys (#1444, K3). */
function refuseStorage(calls: readonly string[]): void {
  for (const call of calls) {
    const original = Reflect.get(Storage.prototype, call) as (this: Storage, ...args: string[]) => unknown;
    Reflect.set(Storage.prototype, call, function (this: Storage, ...args: string[]) {
      if (!args[0]?.startsWith("ductus-")) return original.apply(this, args);
      throw new DOMException("Storage refused.", call === "setItem" ? "QuotaExceededError" : "SecurityError");
    });
  }
}

// #1444 (K1-K4, N2-N4): a 503, no network or no answer in 8 s ends the
// sign-out on this device for every tab of the session, and nothing sends it
// again. A reload under the kept cookie shows no text, also where localStorage
// refuses the record; "Prijavi se" signs in anew and the text is back.
for (const [answer, broken, when] of [
  ["503", [], "before"], ["network", ["setItem"], "before"],
  ["timeout", ["getItem", "setItem", "removeItem"], "before"], ["503", ["setItem"], "after"],
] as const) {
  test(`row 3: ${answer}, storage refusing [${broken.join(", ")}] ${when}: the sign-out ends here, once`, async ({ page, context }) => {
    test.setTimeout(120_000);
    await signIn(page, "/rad");
    const token = (await appCookie(context, SESSION_COOKIE))!.value;
    await writeAndWait(page, " Nacrt C: smeđa mapa");
    const other = await context.newPage();
    await other.goto("/rad");
    await editorMounted(other);
    if (when === "before") {
      for (const tab of [page, other]) await tab.evaluate(refuseStorage, broken);
      await context.addInitScript(refuseStorage, broken);
    }
    const logouts: string[] = [];
    context.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/auth/logout") logouts.push(request.method());
    });
    await page.route("**/api/auth/logout", async (route) => {
      if (answer === "503") await route.fulfill({ status: 503, body: "" });
      if (answer === "network") await route.abort("internetdisconnected");
    });

    const dialog = logoutDialogOf(page);
    await clickSignOut(page);
    await expect(dialog.getByRole("alert")).toContainText(t.auth.logoutDevice, { timeout: 15_000 });
    await expect(dialog.getByRole("alert")).toContainText(t.auth.logoutKept);
    await expect(dialog.getByRole("button")).toHaveText([t.auth.logoutClose]);
    await dialog.getByRole("button", { name: t.auth.logoutClose }).click();
    expect((await appCookie(context, "ductus-ended"))?.value).toMatch(/^[0-9A-Za-z_-]+$/);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await other.reload();
    for (const tab of [page, other]) {
      await expect(phaseOf(tab)).toHaveAttribute("data-phase", "signed-out");
      await expect(editorOf(tab)).toHaveText("");
      await expect(tab.getByRole("button", { name: t.editor.exportText })).toHaveCount(0);
    }
    await other.close();
    await page.reload();
    await expect(editorOf(page)).toHaveText("");
    await expectStillSignedIn(page, token);
    expect(await journalNames(page)).toHaveLength(1);

    // "Prijavi se" with the kept cookie: the login route, back to /rad.
    if (when === "after") await context.addInitScript(refuseStorage, broken);
    await forgetProviderLogin(context);
    const logins: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/auth/login") logins.push(request.url());
    });
    await noticeOf(page).getByRole("link", { name: t.auth.signInAgain }).click();
    await page.getByRole("button", { name: "Demo studentica" }).click();
    await page.waitForURL(`${APP_ORIGIN}/rad`);
    expect(logins).toEqual([`${APP_ORIGIN}/api/auth/login?returnTo=%2Frad`]);
    expect((await appCookie(context, SESSION_COOKIE))!.value).not.toBe(token);
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    await expect(editorOf(page)).toContainText("Nacrt C: smeđa mapa");
    expect(logouts).toEqual(["POST"]);
  });
}

// #1444 (N1): another person signs in in a second tab while the sign-out
// waits; when it runs out, only the session the sign-out belongs to ends.
test("Istodobnost: a sign-in in another tab while the sign-out waits keeps the newer session signed in", async ({ page, context }) => {
  await signIn(page, "/rad");
  const logouts: string[] = [];
  context.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/logout") logouts.push(request.method());
  });
  await page.route("**/api/auth/logout", () => {});
  await logoutOf(page).click();
  await expect.poll(() => logouts).toEqual(["POST"]);

  await forgetProviderLogin(context);
  const second = await context.newPage();
  await signIn(second, "/rad", "Demo student 2");
  const tokenB = (await appCookie(context, SESSION_COOKIE))!.value;
  await writeAndWait(second, "Nacrt D: crveni papir");
  await expect(logoutDialogOf(page).getByRole("alert")).toHaveText(t.auth.logoutDevice, { timeout: 15_000 });
  await second.reload();
  await expect(editorOf(second)).toHaveAttribute("contenteditable", "true");
  await expect(editorOf(second)).toContainText("Nacrt D: crveni papir");
  await expectStillSignedIn(second, tokenB);
  expect(logouts).toEqual(["POST"]);
});

// N2: the server answers; the fence is in the cookie as well.
test("a sign-out the server answered also leaves the ended mark in the cookie", async ({ page, context }) => {
  await signIn(page, "/rad");
  await writeAndWait(page, " Nacrt E: bijela kreda");
  await context.addInitScript(refuseStorage, ["setItem"]);
  await page.evaluate(refuseStorage, ["setItem"]);
  await clickSignOut(page);
  await page.waitForURL(`${APP_ORIGIN}/`);
  expect((await appCookie(context, "ductus-ended"))?.value).toMatch(/^[0-9A-Za-z_-]+$/);
  await page.goto("/rad");
  await expect(page.getByText("Nacrt E")).toHaveCount(0);
});

// D-183 (#1330, #1336): the dialog of a sign-out that ended on this device and
// the sheet after it, full page, in both themes at 1440 and 400 px. No new
// visual element: the existing dialog and notice (prijava-v5 Z-03).
test("D-183: the sign-out that ended on this device and the sheet after it, both themes, 1440 and 400 px", async ({ page, context }) => {
  const shoot = async (name: string, width: number) => {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await test.info().attach(`odjava-${name}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
  };
  for (const theme of ["tamna", "svijetla"] as const) {
    if (theme === "svijetla") {
      await page.evaluate(() => localStorage.setItem("ductura.theme", "light"));
      await forgetProviderLogin(context);
    }
    await signIn(page, "/rad");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme === "tamna" ? "dark" : "light");
    await writeAndWait(page, ` Nacrt ${theme}: siva olovka`);
    await page.route("**/api/auth/logout", (route) => route.abort("internetdisconnected"));
    const dialog = logoutDialogOf(page);
    await clickSignOut(page);
    await expect(dialog.getByRole("alert")).toContainText(t.auth.logoutKept);
    await shoot(`uredaj-${theme}`, 1440);
    await shoot(`uredaj-${theme}`, 400);
    await dialog.getByRole("button", { name: t.auth.logoutClose }).click();
    await expect(noticeOf(page).getByRole("link", { name: t.auth.signInAgain })).toBeVisible();
    await shoot(`prijava-ne-vrijedi-${theme}`, 400);
    await shoot(`prijava-ne-vrijedi-${theme}`, 1440);
    // Nothing calls the route again; the next pass signs in anew (K4).
    await page.unroute("**/api/auth/logout");
  }
});

test("sign-out from a second tab ends the session and empties the writing tab", async ({ page, context }) => {
  await signIn(page, "/rad");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  await writeAndWait(page, "Nacrt A: plava bilježnica");

  const second = await context.newPage();
  await second.goto("/rad");
  await expect(phaseOf(second)).toHaveAttribute("data-phase", "blocked");
  await clickSignOut(second);
  await second.waitForURL(`${APP_ORIGIN}/`);
  expect(await sessionRow(token)).toMatchObject({ close_reason: "logout" });

  await expect(phaseOf(page)).toHaveAttribute("data-phase", "signed-out");
  await expect(noticeOf(page)).toContainText(t.auth.signedOutElsewhere);
  // #1336: the way back is a new sign-in, never this tab's text.
  await expect(noticeOf(page).getByRole("link", { name: t.auth.signInAgain })).toHaveAttribute("href", "/api/auth/login?returnTo=%2F");
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

// DAN-343 (Codex on #866): the Literatura tab drops its list and a half-filled
// form at the same moment the sheet empties.
test("sign-out from a second tab empties the Literatura tab of the writing tab", async ({ page, context }) => {
  const s = t.workspace.sources;
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  const panel = page.getByRole("complementary", { name: "Upute, literatura i komentari" });
  await panel.getByRole("tab", { name: t.workspace.tabSources }).click();
  const tab = panel.getByRole("tabpanel");
  const fill = async (values: Record<string, string>) => {
    for (const [label, value] of Object.entries(values)) await tab.getByLabel(label, { exact: true }).fill(value);
  };
  await tab.getByRole("button", { name: s.add }).click();
  await fill({ [s.family]: "Horvat", [s.given]: "Ana", [s.year]: "2021", [s.title]: "Nepostojeca knjiga", [s.place]: "Zagreb", [s.publisher]: "Primjer" });
  await tab.getByRole("button", { name: s.addOnly }).click();
  await expect(tab.getByRole("listitem")).toHaveCount(1);
  await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");
  // A second source, typed but never written.
  await tab.getByRole("button", { name: s.add }).click();
  await fill({ [s.family]: "Kovac", [s.title]: "Nacrt koji ne smije ostati" });

  const second = await context.newPage();
  await second.goto("/rad");
  await expect(phaseOf(second)).toHaveAttribute("data-phase", "blocked");
  await clickSignOut(second);
  await second.waitForURL(`${APP_ORIGIN}/`);

  await expect(phaseOf(page)).toHaveAttribute("data-phase", "signed-out");
  await expect(tab.getByText(s.readOnly)).toBeVisible();
  await expect(tab.getByRole("listitem")).toHaveCount(0);
  await expect(tab.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByText("Nacrt koji ne smije ostati")).toHaveCount(0);
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
  // #1331: focus starts on "Ostani", and sign-out is named for what it costs.
  await expect(dialog.getByRole("button", { name: t.auth.logoutStay })).toBeFocused();
  await expect(editorOf(page)).toHaveText("Nacrt A: plava bilježnica");
  await expectStillSignedIn(page, token);

  await dialog.getByRole("button", { name: t.auth.logoutConfirmUnsaved }).click();
  await page.waitForURL(`${APP_ORIGIN}/`);
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

  // Nothing written opens no dialog at all (O1): see "row 1" and T8 in
  // shell-sign-out.spec.ts. With work held, Escape is "Ostani".
  await writeAndWait(page, "Nacrt A: plava bilježnica");
  await logoutOf(page).click();
  await expect(dialog.getByRole("button", { name: t.auth.logoutStay })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(logoutOf(page)).toBeFocused();
  await expectStillSignedIn(page, token);

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
  await page.waitForURL(`${APP_ORIGIN}/`);
  expect(await sessionRow(token)).toMatchObject({ close_reason: "logout" });
  await forgetProviderLogin(context);
  await signIn(page, "/rad");
  await expect(editorOf(page)).toHaveText("Nacrt A: plava bilježnica, dopuna");
});

// review517 / qa517: Chromium closes a modal dialog on a repeated Escape
// even when `cancel` is prevented. During a sign-out the dialog must stay,
// so a failure is seen there and "Ostani" gives the sheet back.
test("FE-D7: Escape, the backdrop or a browser close during a sign-out leave the dialog open", async ({ page, context }) => {
  await signIn(page, "/rad");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  await writeAndWait(page, "Nacrt A: plava bilježnica");
  const dialog = logoutDialogOf(page);

  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/auth/logout", async (route) => {
    await held;
    await route.abort("internetdisconnected");
  });

  await clickSignOut(page);
  await expect(dialog.getByRole("button", { name: t.auth.loggingOut })).toBeDisabled();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);
  // A close the page did not ask for, as the browser's own close would be.
  await page.evaluate(() => document.querySelector("dialog")?.close());
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: t.auth.loggingOut })).toBeDisabled();

  release();
  // #1330: the sign-out has ended on this device all the same.
  await expect(dialog.getByRole("alert")).toContainText(t.auth.logoutDevice);
  await expect(dialog).toBeVisible();
  await expectStillSignedIn(page, token);

  // Without a sign-out running, a close the browser makes closes the dialog;
  // the session stays ended here, so nothing of the text comes back.
  await page.evaluate(() => document.querySelector("dialog")?.close());
  await expect(dialog).toHaveCount(0);
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "false");
  await expect(editorOf(page)).toHaveText("");

  // Pressed again, "Odjava" reaches the route this time and leaves.
  await page.unroute("**/api/auth/logout");
  await logoutOf(page).click();
  await page.waitForURL(`${APP_ORIGIN}/`);
  await expect.poll(async () => (await sessionRow(token))?.close_reason).toBe("logout");
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
  // A page without the sheet: "/" now goes on to /rad (DAN-325), whose open
  // journal would keep the second tab waiting.
  await signIn(page, "/upis");
  const second = await context.newPage();
  await second.goto("/rad");
  await expect(editorOf(second)).toHaveAttribute("contenteditable", "true");
  await signOutWithoutDialog(second);
  await forgetProviderLogin(context);
  await signIn(second, "/rad");
  await second.close();

  // The first tab never reloaded; its link to "/" renders under the new
  // cookie and goes on to /rad (DAN-325).
  await page.getByRole("link", { name: t.teacher.backHome, exact: true }).click();
  await page.waitForURL(`${APP_ORIGIN}/rad`);
  await expect(phaseOf(page)).toHaveAttribute("data-phase", "ready");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
});

test("a tab waiting for the document stops for good when another tab signs out", async ({ page, context }) => {
  await signIn(page, "/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  const second = await context.newPage();
  await second.goto("/rad");
  await expect(phaseOf(second)).toHaveAttribute("data-phase", "blocked");

  await signOutWithoutDialog(page);
  await expect(phaseOf(second)).toHaveAttribute("data-phase", "signed-out");
  await expect(noticeOf(second)).toContainText(t.auth.signedOutElsewhere);
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

  await signOutWithoutDialog(page);
  await page.close();
  await expect(phaseOf(second)).toHaveAttribute("data-phase", "signed-out");
  await expect(noticeOf(second)).toContainText(t.auth.signedOutElsewhere);
  await expect(editorOf(second)).toHaveAttribute("contenteditable", "false");
  const names = await second.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(names.filter((name) => name?.startsWith("ductus-journal-v1-"))).toEqual([]);
});

// DAN-325: with a session neither the home page nor the sign-in page offers a
// second sign-in; both send the student on to the workspace.
test("with a session the home page and the sign-in page lead to the student's own page", async ({ page }) => {
  await signIn(page, "/");
  await expect(page).toHaveURL(`${APP_ORIGIN}/rad`);
  for (const path of ["/", "/prijava", "/prijava?returnTo=%2Frad"]) {
    await page.goto(path);
    await expect(page).toHaveURL(`${APP_ORIGIN}/rad`);
    await expect(page.getByRole("link", { name: t.auth.signIn })).toHaveCount(0);
  }
});

// Design v3 shell around the workspace (#476 6314969336, cut (b)): the student
// items, and in the account place the workspace's own sign-out with its dialog
// (I5, D-118), never a second, plain one.
// Since 1. 11. 2026. the side bar on /rad is a drawer behind ☰ at every width
// (owner), and the sign-out sits in the top bar, still one press away.
test("in the shell /rad keeps one sign-out, the one that knows the device", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "/rad");
  const side = page.getByRole("complementary", { name: t.shell.sideNav });
  await expect(side).toBeHidden();
  await expect(logoutOf(page)).toHaveCount(1);
  await expect(page.getByRole("banner").getByRole("button", { name: t.auth.logout, exact: true })).toBeVisible();
  await page.getByRole("button", { name: t.shell.openNav }).click();
  const nav = side.getByRole("navigation", { name: t.shell.workNav });
  await expect(nav.getByRole("link")).toHaveText([t.shell.nav.assignments, t.shell.nav.courses, t.shell.nav.works, t.shell.nav.workspace, t.shell.nav.enroll]);
  await expect(nav.getByRole("link", { name: t.shell.nav.workspace })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await expect(side).toBeHidden();
  await expect(page.getByRole("button", { name: t.shell.openNav })).toBeFocused();
});
