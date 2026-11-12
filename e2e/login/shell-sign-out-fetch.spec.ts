import { createHash } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { sessionTag } from "../../src/server/auth/principal";
import { localAdminUrl } from "./local-db-url";
import { APP_ORIGIN } from "./origin";
import { SESSION_COOKIE, appCookie, logoutDialogOf, sessionRow, signIn } from "./support";

// DAN-99, PR 2 of the contract on #1836 (c.6797869472): "Odjava" on a shell
// page sends the editor's request, a fetch. F-285 (contract c.6816460041):
// without the route's confirmation nothing ends, and the dialog says the
// sign-out is unconfirmed and offers it again. With an answer, the native
// POST follows to the provider and `/`; when that one fails, the device stays
// signed out. The administrator appointment comes from the local operator
// procedure and is taken away again; every account is invented.

const REQUEST = "Zahtjev e2e DAN-99/2026";

async function operator(sessionToken: string, procedure: "appoint" | "revoke"): Promise<void> {
  const client = new pg.Client({ connectionString: localAdminUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      "SELECT s.user_id AS id FROM identity.session s WHERE s.token_hash = $1",
      [createHash("sha256").update(sessionToken, "utf8").digest()]);
    expect(rows).toHaveLength(1);
    await client.query(`SELECT institution.${procedure}_institution_admin($1, $2)`, [rows[0]!.id, REQUEST]);
  } finally {
    await client.end();
  }
}

/** Signs in as the invented administrator; returns the session token. */
async function asAdministrator(page: Page): Promise<string> {
  await signIn(page, "/zadaci", "Ustanova B: nastavnica");
  const token = (await appCookie(page.context(), SESSION_COOKIE))?.value;
  expect(token).toBeDefined();
  return token!;
}

function logoutRequests(context: BrowserContext): string[] {
  const seen: string[] = [];
  context.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/logout") seen.push(`${request.method()} ${request.resourceType()}`);
  });
  return seen;
}

const signOutButton = (page: Page) => page.getByRole("button", { name: t.shell.signOut, exact: true });

async function expectSignedOutCard(page: Page, path: string, title: string): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: t.access.signedOutTitle })).toBeVisible();
  await expect(page.getByRole("link", { name: t.prijava.button }))
    .toHaveAttribute("href", `/api/auth/login?returnTo=${encodeURIComponent(path)}`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toHaveCount(0);
  await expect(signOutButton(page)).toHaveCount(0);
}

async function shoot(page: Page, name: string, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await test.info().attach(`${name}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
}

/** Without the route's confirmation: nothing ended, and the dialog does not say it did (F-285). */
async function expectUnconfirmed(page: Page, context: BrowserContext, session: string): Promise<void> {
  const dialog = logoutDialogOf(page);
  await expect(dialog.getByRole("alert")).toContainText(t.auth.logoutUnconfirmed, { timeout: 15_000 });
  await expect(dialog).not.toContainText(t.auth.logoutDevice);
  await expect(dialog.getByRole("button")).toHaveText([t.auth.retry, t.auth.logoutStay]);
  await expect(dialog.getByRole("button", { name: t.auth.logoutStay })).toBeFocused();
  expect(await appCookie(context, `ductus-ended-${sessionTag(session)!}`)).toBeUndefined();
  expect((await sessionRow(session))?.closed_at).toBeNull();
  expect((await appCookie(context, SESSION_COOKIE))?.value).toBe(session);
}

// Finding (1) and F-285, with D-183 shots of the dialog in both themes at 1440 and 400 px.
test("Odjava on /ustanova without an answer ends nothing, says so and signs out on a second try", async ({ page, context }) => {
  const first = await asAdministrator(page);
  await operator(first, "appoint");
  const appointed = [first];
  try {
    for (const theme of ["dark", "light"] as const) {
      // The previous pass ended its shots at 400 px, where the work nav sits
      // behind the menu button.
      await page.setViewportSize({ width: 1440, height: 900 });
      if (theme === "light") {
        await page.evaluate(() => localStorage.setItem("ductura.theme", "light"));
        // Forget the fake provider's earlier sign-in so the account choice shows.
        await context.clearCookies({ name: /^_session/ });
      }
      const session = theme === "dark" ? first : await asAdministrator(page);
      if (theme === "light") {
        await operator(session, "appoint");
        appointed.push(session);
      }
      await page.goto("/ustanova");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByRole("heading", { level: 1, name: t.institutionOverview.title })).toBeVisible();

      const logouts = logoutRequests(context);
      await page.route("**/api/auth/logout", (route) => route.fulfill({ status: 503, body: "" }));
      await signOutButton(page).click();
      await expectUnconfirmed(page, context, session);
      await shoot(page, `odjava-ljuska-nepotvrdena-${theme}`, 1440);
      await shoot(page, `odjava-ljuska-nepotvrdena-${theme}`, 400);
      await page.setViewportSize({ width: 1440, height: 900 });

      // "Ostani": the page is still the signed-in overview.
      const dialog = logoutDialogOf(page);
      await dialog.getByRole("button", { name: t.auth.logoutStay }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1, name: t.institutionOverview.title })).toBeVisible();
      expect(logouts).toEqual(["POST fetch"]);

      // A second try, answered this time, signs out on the server.
      await page.unroute("**/api/auth/logout");
      await signOutButton(page).click();
      await page.waitForURL(`${APP_ORIGIN}/`);
      expect(logouts).toEqual(["POST fetch", "POST fetch", "POST document"]);
      expect(await sessionRow(session)).toMatchObject({ close_reason: "logout", closed_at: expect.any(Date) });
      await page.goto("/ustanova");
      await expectSignedOutCard(page, "/ustanova", t.institutionOverview.title);
    }
  } finally {
    for (const session of appointed) await operator(session, "revoke");
  }
});

// Finding (2): the native POST follows the answered fetch without a condition.
for (const second of ["answered", "503"] as const) {
  test(`Odjava on /ustanova after an answered fetch: the native POST ${second === "503" ? "fails and the device stays signed out" : "reaches /"}`, async ({ page, context }) => {
    const session = await asAdministrator(page);
    await operator(session, "appoint");
    try {
      await page.goto("/ustanova");
      await expect(page.getByRole("heading", { level: 1, name: t.institutionOverview.title })).toBeVisible();
      const logouts = logoutRequests(context);
      if (second === "503") {
        await page.route("**/api/auth/logout", (route) =>
          route.request().resourceType() === "document" ? route.fulfill({ status: 503, body: "" }) : route.continue());
      }
      await signOutButton(page).click();
      if (second === "answered") await page.waitForURL(`${APP_ORIGIN}/`);
      else await expect.poll(() => logouts).toEqual(["POST fetch", "POST document"]);
      expect(logouts).toEqual(["POST fetch", "POST document"]);

      expect(await sessionRow(session)).toMatchObject({ close_reason: "logout", closed_at: expect.any(Date) });
      expect(await appCookie(context, SESSION_COOKIE)).toBeUndefined();
      expect(await appCookie(context, `ductus-ended-${sessionTag(session)!}`)).toBeDefined();
      await page.unroute("**/api/auth/logout");
      await page.goto("/ustanova");
      await expectSignedOutCard(page, "/ustanova", t.institutionOverview.title);
    } finally {
      await operator(session, "revoke");
    }
  });
}

// The dialog path: a journal that cannot be read opens the dialog first (T5 of
// shell-sign-out.spec.ts); Odjavi se without an answer turns it into the
// unconfirmed message, and "Pokušaj ponovno" sends the request again (F-285).
test("Odjava from the dialog without an answer says it is unconfirmed and tries again", async ({ page, context }) => {
  const session = await asAdministrator(page);
  await operator(session, "appoint");
  try {
    await page.addInitScript(() => {
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number) {
        if (name.startsWith("ductus-journal-v1-")) throw new DOMException("Made-up refusal", "SecurityError");
        return version === undefined ? open.call(this, name) : open.call(this, name, version);
      };
    });
    await page.goto("/ustanova");
    await expect(page.getByRole("heading", { level: 1, name: t.institutionOverview.title })).toBeVisible();
    const logouts = logoutRequests(context);
    await page.route("**/api/auth/logout", (route) => route.fulfill({ status: 503, body: "" }));
    await signOutButton(page).click();
    const dialog = logoutDialogOf(page);
    await expect(dialog).toContainText(t.auth.logoutPlain);
    await dialog.getByRole("button", { name: t.auth.logoutConfirm }).click();
    await expectUnconfirmed(page, context, session);
    expect(logouts).toEqual(["POST fetch"]);
    // A second unanswered try says the same and gives "Ostani" the focus again.
    await dialog.getByRole("button", { name: t.auth.retry }).click();
    await expect.poll(() => logouts).toEqual(["POST fetch", "POST fetch"]);
    await expectUnconfirmed(page, context, session);
    await page.unroute("**/api/auth/logout");
    await dialog.getByRole("button", { name: t.auth.retry }).click();
    await page.waitForURL(`${APP_ORIGIN}/`);
    expect(logouts).toEqual(["POST fetch", "POST fetch", "POST fetch", "POST document"]);
    expect(await sessionRow(session)).toMatchObject({ close_reason: "logout", closed_at: expect.any(Date) });
  } finally {
    await operator(session, "revoke");
  }
});

// A student screen does not read the mark, so it would keep rendering for a
// session the dialog called ended: its Odjava posts the form as before (QA,
// finding 1; the contract leaves student screens as they are).
test("Odjava on a student screen still posts the form, without the device message", async ({ page, context }) => {
  await signIn(page, "/upis");
  const logouts = logoutRequests(context);
  await page.route("**/api/auth/logout", (route) => route.fulfill({ status: 503, body: "" }));
  await page.getByRole("button", { name: t.shell.signOut, exact: true }).click();
  await expect.poll(() => logouts).toEqual(["POST document"]);
  await expect(logoutDialogOf(page)).toHaveCount(0);
});
