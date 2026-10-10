import { test } from "@playwright/test";

// docs/SESSIONS.md 6: every frontend PR shows each screen wide and mobile, in
// hr and en. Each project (desktop, mobile) runs this once and the images go
// into the HTML report that CI uploads. Add a row when a page is added; `en`
// joins the loop when the English messages exist (D-70).
const PAGES = [
  { name: "home", path: "/" },
  { name: "workspace", path: "/rad" },
];
const LOCALES = ["hr"] as const;
// The dark theme follows the system setting (design v6, D-89).
const SCHEMES = ["light", "dark"] as const;
// Wide (three columns), the 1100 px break (rails under the sheet) and a phone.
const WIDTHS = [1440, 1000, 390] as const;

for (const locale of LOCALES) {
  for (const { name, path } of PAGES) {
    for (const colorScheme of SCHEMES) {
      test(`screenshot: ${name} (${locale}, ${colorScheme})`, async ({ page }, testInfo) => {
        await page.emulateMedia({ colorScheme });
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await testInfo.attach(`${testInfo.project.name}-${locale}-${name}-${colorScheme}.png`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      });

      for (const width of WIDTHS) {
        test(`screenshot: ${name} at ${width} px (${locale}, ${colorScheme})`, async ({ page }, testInfo) => {
          await page.setViewportSize({ width, height: 900 });
          await page.emulateMedia({ colorScheme });
          await page.goto(path);
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
      await page.emulateMedia({ colorScheme });
      await page.goto("/rad");
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
