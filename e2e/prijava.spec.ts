import { expect, test } from "@playwright/test";

// FE-D3 (DAN-222): /prijava offers AAI@EduHr alone (D-09) through the existing
// login route. The full sign-in from this screen is in e2e/login/prijava.spec.ts.

test("/prijava renders the AAI@EduHr sign-in in Croatian", async ({ page }) => {
  await page.goto("/prijava");
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  await expect(page.getByRole("heading", { level: 1, name: "Dobro došli u svoj prostor." })).toBeVisible();
  const button = page.getByRole("link", { name: "Prijava sustavom AAI@EduHr" });
  // The page title stays "Prijava" (Archivum, DAN-344).
  await expect(page).toHaveTitle(/^Prijava · /);
  // DAN-325: without a returnTo the sign-in comes back to "/", which sends each person to their own page.
  await expect(button).toHaveAttribute("href", "/api/auth/login?returnTo=%2F");
  // D-09: no other way in, no e-mail field, no password field on this page.
  await expect(page.locator("input")).toHaveCount(0);
  await expect(page.locator('a[href^="/api/auth/login"]')).toHaveCount(1);
});

// DAN-344: the sign-in and the public home page lead to each other by the
// existing routes, and the help and the code note open without JavaScript.
test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("/prijava leads back to the home page and opens its help", async ({ page }) => {
    await page.goto("/prijava");
    await expect(page.getByRole("link", { name: "Prijava sustavom AAI@EduHr" })).toHaveAttribute(
      "href",
      "/api/auth/login?returnTo=%2F",
    );
    await page.getByText("Trebate pomoć?").click();
    await expect(page.getByRole("link", { name: "Službena pomoć AAI@EduHr" })).toHaveAttribute(
      "href",
      "https://www.aaiedu.hr/kontakt",
    );
    await page.getByText("Prvi dolazak ili imate kod zadatka?").click();
    await expect(page.getByText("Kod zadatka od nastavnika upisujete nakon prijave.", { exact: false })).toBeVisible();
    await page.getByRole("banner").getByRole("link", { name: "Na naslovnicu" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole("banner").getByRole("link", { name: "Prijava", exact: true }).click();
    await expect(page).toHaveURL(/\/prijava$/);
  });
});

test("/prijava carries a path of this application as returnTo", async ({ page }) => {
  await page.goto(`/prijava?returnTo=${encodeURIComponent("/upis")}`);
  await expect(page.getByRole("link", { name: "Prijava sustavom AAI@EduHr" })).toHaveAttribute(
    "href",
    "/api/auth/login?returnTo=%2Fupis",
  );
});

// D-183: the whole page with both help sections open, in both themes at 1440 and 400 px.
// The sign-in is dark only (D-115) until the light choice reaches it, so the light shot shows that too.
for (const theme of ["dark", "light"] as const) {
  test(`/prijava with its help open in the ${theme} theme at 1440 and 400 px`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem("ductura.theme", value), theme);
    for (const width of [1440, 400]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/prijava");
      await page.getByText("Trebate pomoć?").click();
      await page.getByText("Prvi dolazak ili imate kod zadatka?").click();
      await expect(page.getByRole("link", { name: "Službena pomoć AAI@EduHr" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Prijava sustavom AAI@EduHr" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (testInfo.project.name === "desktop") {
        await testInfo.attach(`prijava-${theme}-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      }
    }
  });
}

for (const returnTo of ["https://example.test/rad", "//example.test", "/api/auth/logout"]) {
  test(`/prijava drops returnTo ${returnTo}`, async ({ page }) => {
    await page.goto(`/prijava?returnTo=${encodeURIComponent(returnTo)}`);
    await expect(page.getByRole("link", { name: "Prijava sustavom AAI@EduHr" })).toHaveAttribute(
      "href",
      "/api/auth/login?returnTo=%2F",
    );
  });
}

// S-01 states (prijava.html states 1 to 4): `?stanje=` picks one from a closed
// list; the sign-in stays the one login route (D-09) and works without JavaScript.
const LOGIN = "/api/auth/login?returnTo=%2F";

test("?stanje=greska says the sign-in did not finish and offers it again and the home page", async ({ page }) => {
  await page.goto("/prijava?stanje=greska");
  const alert = page.getByRole("main").getByRole("alert");
  await expect(alert.getByRole("heading", { level: 2, name: "Prijava nije dovršena" })).toBeVisible();
  await expect(alert.getByText("Prijavu nije bilo moguće dovršiti.", { exact: false })).toBeVisible();
  await expect(alert.getByRole("link", { name: "Pokušaj ponovno" })).toHaveAttribute("href", LOGIN);
  await expect(alert.getByRole("link", { name: "Na početnu" })).toHaveAttribute("href", "/");
  await expect(page.locator('a[href^="/api/auth/login"]')).toHaveCount(1);
  await expect(page.locator("input")).toHaveCount(0);
});

test("?stanje=nedostupno says AAI@EduHr does not answer and offers it again", async ({ page }) => {
  await page.goto(`/prijava?stanje=nedostupno&returnTo=${encodeURIComponent("/upis")}`);
  const alert = page.getByRole("main").getByRole("alert");
  await expect(alert.getByText("Prijava preko AAI@EduHr trenutačno ne odgovara.", { exact: false })).toBeVisible();
  await expect(alert.getByRole("link", { name: "Pokušaj ponovno" })).toHaveAttribute(
    "href",
    "/api/auth/login?returnTo=%2Fupis",
  );
  await expect(page.locator('a[href^="/api/auth/login"]')).toHaveCount(1);
});

test("?stanje=bez-uloge says who assigns the role and offers no new sign-in", async ({ page }) => {
  await page.goto("/prijava?stanje=bez-uloge");
  const status = page.getByRole("status").filter({ hasText: "Prijava je uspjela" });
  await expect(status.getByRole("heading", { level: 2, name: "Prijava je uspjela" })).toBeVisible();
  await expect(status.getByText("Ulogu dodjeljuje administrator fakulteta.")).toBeVisible();
  await expect(status.getByText("Javite se koordinatoru na svojoj ustanovi.")).toBeVisible();
  await expect(page.locator('a[href^="/api/auth/login"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Pokušaj ponovno" })).toHaveCount(0);
  // Scoped to main: Next.js keeps its own route announcer with role="alert".
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

for (const raw of ["zlonamjerno", "<script>alert(1)</script>", "GRESKA", "bez_uloge"]) {
  test(`an unknown ?stanje=${raw} is the plain sign-in and is not shown`, async ({ page }) => {
    await page.goto(`/prijava?stanje=${encodeURIComponent(raw)}`);
    await expect(page.getByRole("link", { name: "Prijava sustavom AAI@EduHr" })).toHaveAttribute("href", LOGIN);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    // Nothing the page shows or carries in an attribute repeats the value. The
    // framework's own router data keeps the URL in a JSON script, escaped.
    const shown = await page.evaluate(() =>
      [document.body.innerText, ...[...document.querySelectorAll("*")].flatMap((el) => [...el.attributes].map((a) => a.value))].join("\n"),
    );
    expect(shown).not.toContain(raw);
    expect(await page.content()).not.toContain("<script>alert(1)</script>");
  });
}

test("a click on the sign-in says the redirect is under way and leaves the link usable", async ({ page }) => {
  // A 204 from the login route leaves the browser on this page, so the status line stays.
  await page.route("**/api/auth/login**", (route) => route.fulfill({ status: 204 }));
  await page.goto("/prijava");
  await expect(page.getByText("Preusmjeravamo Vas na AAI@EduHr")).toHaveCount(0);
  const button = page.getByRole("link", { name: "Prijava sustavom AAI@EduHr" });
  await button.click({ noWaitAfter: true });
  await expect(page.getByRole("status").getByText("Preusmjeravamo Vas na AAI@EduHr")).toBeVisible();
  await expect(button).toHaveAttribute("href", LOGIN);
  await expect(button).not.toHaveAttribute("aria-disabled", /.*/);
});

test.describe("states without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  for (const [query, name] of [
    ["?stanje=greska", "Pokušaj ponovno"],
    ["?stanje=nedostupno", "Pokušaj ponovno"],
    ["", "Prijava sustavom AAI@EduHr"],
  ] as const) {
    test(`/prijava${query} keeps the sign-in a plain link`, async ({ page }) => {
      const asked: string[] = [];
      await page.route("**/api/auth/login**", (route) => {
        const url = new URL(route.request().url());
        asked.push(url.pathname + url.search);
        return route.fulfill({ status: 200, contentType: "text/plain", body: "ok" });
      });
      await page.goto(`/prijava${query}`);
      await page.getByRole("link", { name }).click();
      await expect(page).toHaveURL(/\/api\/auth\/login\?returnTo=%2F$/);
      expect(asked).toEqual([LOGIN]);
    });
  }

  test("/prijava?stanje=bez-uloge renders without JavaScript", async ({ page }) => {
    await page.goto("/prijava?stanje=bez-uloge");
    await expect(page.getByText("Ulogu dodjeljuje administrator fakulteta.")).toBeVisible();
  });
});

// D-183: each state in both themes at 1440 and 400 px (reference: snimke/prijava-*.png).
for (const theme of ["dark", "light"] as const) {
  test(`/prijava states in the ${theme} theme at 1440 and 400 px`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem("ductura.theme", value), theme);
    await page.route("**/api/auth/login**", (route) => route.fulfill({ status: 204 }));
    for (const width of [1440, 400]) {
      await page.setViewportSize({ width, height: 900 });
      for (const state of ["preusmjeravanje", "greska", "nedostupno", "bez-uloge"]) {
        if (state === "preusmjeravanje") {
          await page.goto("/prijava");
          await page.getByRole("link", { name: "Prijava sustavom AAI@EduHr" }).click({ noWaitAfter: true });
          await expect(page.getByText("Preusmjeravamo Vas na AAI@EduHr")).toBeVisible();
        } else {
          await page.goto(`/prijava?stanje=${state}`);
          await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        if (testInfo.project.name === "desktop") {
          await testInfo.attach(`prijava-${state}-${theme}-${width}.png`, {
            body: await page.screenshot({ fullPage: true, animations: "disabled" }),
            contentType: "image/png",
          });
        }
      }
    }
  });
}
