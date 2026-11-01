import { expect, test, type Page } from "@playwright/test";

import { appCookie, LOGIN_COOKIE, SESSION_COOKIE, sessionRow, signIn } from "./support";

// The full login through the fake provider against `next dev`
// (playwright.login.config.ts); the helpers are in ./support.ts.

async function expectNeutralPage(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  await expect(page.getByRole("heading", { level: 1, name: "Prijava nije dovršena" })).toBeVisible();
}

test("the demo student signs in and lands on returnTo with a session", async ({ page, context }) => {
  await signIn(page, "/rad");

  const session = await appCookie(context, SESSION_COOKIE);
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
  expect(session!.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(await appCookie(context, LOGIN_COOKIE)).toBeUndefined();

  expect(await sessionRow(session!.value)).toEqual({
    institution: "demo-fakultet",
    unique_id: "demo-student@demo.ductus.test",
    closed_at: null,
    close_reason: null,
  });
});

test("the second demo student signs in and receives a distinct session identity", async ({ page, context }) => {
  await signIn(page, "/rad", "Demo student 2");

  const session = await appCookie(context, SESSION_COOKIE);
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
  expect(session!.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(await appCookie(context, LOGIN_COOKIE)).toBeUndefined();

  expect(await sessionRow(session!.value)).toEqual({
    institution: "demo-fakultet",
    unique_id: "demo-student-2@demo.ductus.test",
    closed_at: null,
    close_reason: null,
  });
});

test("logout closes the session and clears the cookie", async ({ page, context }) => {
  await signIn(page, "/");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;

  const type = await page.evaluate(async () => {
    const response = await fetch("/api/auth/logout", { method: "POST", redirect: "manual" });
    return response.type;
  });
  // The 303 leads on to the provider's logout (DAN-212), another origin that a
  // fetch from the page does not follow; the editor posts natively after it.
  expect(type).toBe("opaqueredirect");
  expect(await appCookie(context, SESSION_COOKIE)).toBeUndefined();
  expect(await sessionRow(token)).toMatchObject({ close_reason: "logout", closed_at: expect.any(Date) });
});

test("a replayed callback ends on the neutral page and opens no session", async ({ page, context }) => {
  const callback = await signIn(page, "/");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;

  const response = await page.goto(callback);
  expect(response?.status()).toBe(400);
  await expectNeutralPage(page);
  // The replay neither replaced nor closed the session it found.
  expect((await appCookie(context, SESSION_COOKIE))?.value).toBe(token);
  expect(await sessionRow(token)).toMatchObject({ closed_at: null });
});

test("a callback with another state ends on the neutral page without a session", async ({ page, context }) => {
  // A redirect target cannot be routed, so the provider's redirects after the
  // account choice are followed here, and the browser gets the callback with
  // its state swapped for one the login cookie does not hold.
  await page.route("http://localhost:8090/interaction/*/login", async (route) => {
    let response = await route.fetch({ maxRedirects: 0 });
    for (let hop = 0; hop < 5; hop++) {
      const location = new URL(response.headers()["location"] ?? "", "http://localhost:8090");
      if (location.href.startsWith("http://localhost:3000/api/auth/callback?")) {
        location.searchParams.set("state", "x".repeat(43));
        return route.fulfill({ status: 303, headers: { location: location.href } });
      }
      response = await context.request.get(location.href, { maxRedirects: 0 });
    }
    throw new Error("the provider never redirected to the callback");
  });
  await page.goto("/api/auth/login");
  await page.getByRole("button", { name: "Demo studentica" }).click();
  await page.waitForURL(/^http:\/\/localhost:3000\/api\/auth\/callback\?/);
  await expectNeutralPage(page);
  expect(await appCookie(context, SESSION_COOKIE)).toBeUndefined();
  expect(await appCookie(context, LOGIN_COOKIE)).toBeUndefined();
});
