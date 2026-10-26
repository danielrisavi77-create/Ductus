import { expect, test, type Page } from "@playwright/test";

// DAN-249 (#876): visual baselines of two demo screens and an ARIA snapshot of
// the editor toolbar. The teacher screen (V3) is in e2e/login/teacher-home.spec.ts.
//
// Pixels are compared in the `desktop` project only, against baselines made on
// the CI runner (ubuntu-latest, Chromium) and committed after review; the other
// projects run the same test and check the ARIA snapshot of the same screen,
// so nothing is skipped. Tolerances are Playwright's defaults, with no mask.
// docs/TESTING.md §2 describes the run, the review and a new baseline.

const PIXELS_IN = "desktop";

async function settle(page: Page): Promise<void> {
  // A fixed width, so every project shows the same layout (the toolbar keeps all its tools).
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForLoadState("networkidle");
  // The fonts are local files (app/fonts); the comparison waits for them.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

test("V1: /prijava matches its baseline and its sign-in structure", async ({ page }, testInfo) => {
  await page.goto("/prijava");
  await settle(page);
  const main = page.getByRole("main");
  await expect(main).toMatchAriaSnapshot(`
    - region "Dobro došli u svoj prostor.":
      - heading "Dobro došli u svoj prostor." [level=1]
    - region "Tvoj akademski identitet.":
      - heading "Tvoj akademski identitet." [level=2]
      - link "Prijava sustavom AAI@EduHr":
        - /url: /api/auth/login?returnTo=%2F
  `);
  if (testInfo.project.name === PIXELS_IN) await expect(main).toHaveScreenshot("prijava.png");
});

test("V2 and A1: the editor on /rad matches its baseline; the toolbar keeps its tools in order", async ({ page }, testInfo) => {
  await page.goto("/rad");
  await expect(page.getByRole("textbox", { name: "Tekst rada" })).toHaveAttribute("contenteditable", "true");
  await settle(page);
  await expect(page.getByRole("toolbar", { name: "Oblikovanje teksta" })).toMatchAriaSnapshot(`
    - toolbar "Oblikovanje teksta":
      - button "Odlomak" [pressed]
      - button "Naslov 1"
      - button "Naslov 2"
      - button "Naslov 3"
      - button "Podebljano"
      - button "Kurziv"
      - button "Popis"
      - button "Blok-citat"
      - button "Poništi" [disabled]
      - button "Ponovi" [disabled]
      - button "Prikaz"
  `);
  if (testInfo.project.name === PIXELS_IN) await expect(page.getByRole("main")).toHaveScreenshot("rad-editor.png");
});
