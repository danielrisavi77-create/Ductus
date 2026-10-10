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
    }
  }
}
