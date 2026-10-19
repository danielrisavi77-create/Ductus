import { test, type Page } from "@playwright/test";

// docs/SESSIONS.md 6: every frontend PR shows each screen wide and mobile, in
// hr and en. Each project (desktop, mobile) runs this once and the images go
// into the HTML report that CI uploads. Add a row when a page is added; `en`
// joins the loop when the English messages exist (D-70).
const PAGES = [
  { name: "home", path: "/" },
  { name: "workspace", path: "/rad" },
  { name: "teacher-new", path: "/nastavnik/zadatak/novi" },
  { name: "prijava", path: "/prijava" },
  // Signed out here; the teacher view is attached by e2e/login/fast-path.spec.ts.
  { name: "brz-put", path: "/nastavnik/brz-put" },
];
const LOCALES = ["hr"] as const;
// The shell is always dark (D-115); the sheet is dark by default, white with the switch on /rad (D-123).
const SCHEMES = ["light", "dark"] as const;

async function chooseSheetTheme(page: Page, path: string, theme: (typeof SCHEMES)[number]) {
  if ((path !== "/rad" && path !== "/") || theme === "dark") return;
  await page.getByRole("button", { name: "Bijeli list" }).click();
}
// Wide (three columns), below 1240 px (structure under the sheet), below
// 1000 px (both rails under the sheet) and a phone (README §5.1, FE-D2).
const WIDTHS = [1440, 1100, 990, 390] as const;

for (const locale of LOCALES) {
  for (const { name, path } of PAGES) {
    for (const colorScheme of SCHEMES) {
      test(`screenshot: ${name} (${locale}, ${colorScheme})`, async ({ page }, testInfo) => {
        await page.goto(path);
        await chooseSheetTheme(page, path, colorScheme);
        await page.waitForLoadState("networkidle");
        await testInfo.attach(`${testInfo.project.name}-${locale}-${name}-${colorScheme}.png`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      });

      for (const width of WIDTHS) {
        test(`screenshot: ${name} at ${width} px (${locale}, ${colorScheme})`, async ({ page }, testInfo) => {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(path);
          await chooseSheetTheme(page, path, colorScheme);
          await page.waitForLoadState("networkidle");
          await testInfo.attach(`${testInfo.project.name}-${locale}-${name}-${width}-${colorScheme}.png`, {
            body: await page.screenshot({ fullPage: true }),
            contentType: "image/png",
          });
        });
      }
    }
  }

  for (const colorScheme of SCHEMES) {
    test(`screenshot: workspace rails open at 390 px (${locale}, ${colorScheme})`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/rad");
      await chooseSheetTheme(page, "/rad", colorScheme);
      await page.waitForLoadState("networkidle");
      for (const toggle of await page.locator(".rail-toggle").all()) await toggle.click();
      await testInfo.attach(
        `${testInfo.project.name}-${locale}-workspace-390-rails-open-${colorScheme}.png`,
        {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        },
      );
    });
  }
}
