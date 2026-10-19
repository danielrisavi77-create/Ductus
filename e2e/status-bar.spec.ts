import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Top bar and status bar of /rad (FE-D6, design editor-v11, #476 row 06a).
 * The course, the assignment and the word range are invented demo data until
 * /rad reads its assignment. The save chip keeps its own logic; these tests
 * show what the bars say in each state, and that nothing claims the server
 * has the text (F-3/F-8: SYNCED only with a signed receipt). Only made-up
 * text is typed.
 */

const NBSP = " ";
const RANGE = ` / 2${NBSP}000–2${NBSP}500 riječi`;
const SERVER = "poslužitelju";

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Tekst rada" });
const statusOf = (page: Page) => page.getByRole("contentinfo", { name: "Stanje rada" });
const lengthOf = (page: Page) => statusOf(page).locator(".status-length");
const chipOf = (page: Page) => statusOf(page).locator(".sync-chip");

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe("editor top bar and status bar (FE-D6)", () => {
  test("top bar: brand, then course and assignment, then the demo label", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/rad");
    const bar = page.locator(".workspace__bar");
    const context = bar.locator(".brand-line__context");
    await expect(context).toHaveText("Kolegij A / Zadatak 1");
    const [brand, path, demo] = await Promise.all([
      bar.getByRole("link", { name: "Ductura" }).boundingBox(),
      context.boundingBox(),
      bar.locator(".demo-badge").boundingBox(),
    ]);
    expect(brand!.x + brand!.width).toBeLessThanOrEqual(path!.x);
    expect(path!.x + path!.width).toBeLessThanOrEqual(demo!.x);
    // The invented data is marked as such right beside it.
    await expect(bar.locator(".demo-badge")).toHaveText("Demo · izmišljeni podaci");
  });

  test("status bar: words against the range, pages, a selection, never the server", async ({ page }) => {
    await page.goto("/rad");
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    await expect(lengthOf(page)).toHaveText(`0${RANGE}`);

    await editorOf(page).click();
    await page.keyboard.type("Prva rečenica izmišljenog rada.");
    await expect(lengthOf(page)).toHaveText(`4${RANGE} · ≈ 1 str.`);
    // Saved on the device only: the chip says so, and no part of the bar says more.
    await expect(chipOf(page)).toHaveText("Spremljeno na uređaju");
    await expect(statusOf(page)).not.toContainText(SERVER);

    await page.keyboard.press("ControlOrMeta+a");
    await expect(lengthOf(page)).toHaveText(`označeno 4 riječi · 4${RANGE} · ≈ 1 str.`);
    await page.keyboard.press("End");
    await expect(lengthOf(page)).toHaveText(`4${RANGE} · ≈ 1 str.`);
    // Not a live region: the count changes with every word typed.
    await expect(lengthOf(page)).not.toHaveAttribute("aria-live");
    await axe(page);
  });

  test("loading: while the journal is read the bar says so and shows no save state", async ({ page }) => {
    // The document's Web Lock never answers, so the journal is never read.
    await page.addInitScript(() => {
      Object.assign(LockManager.prototype, { request: () => new Promise<never>(() => undefined) });
    });
    await page.goto("/rad");
    await expect(lengthOf(page)).toHaveText("Učitavanje rada…");
    await expect(chipOf(page)).toHaveCount(0);
    await expect(statusOf(page)).not.toContainText(SERVER);
  });

  test("offline: the bar keeps counting and marks the missing network", async ({ page, context }) => {
    await page.goto("/rad");
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    await context.setOffline(true);
    await editorOf(page).click();
    await page.keyboard.type("Odlomak bez mreže.");
    await expect(statusOf(page).locator(".offline-chip")).toHaveText("Bez mreže");
    await expect(lengthOf(page)).toHaveText(`3${RANGE} · ≈ 1 str.`);
    await expect(chipOf(page)).toHaveText("Spremljeno na uređaju");
    await expect(statusOf(page)).not.toContainText(SERVER);
    await axe(page);
  });

  test("saving fails: the chip says so and the count stays", async ({ page }) => {
    await page.addInitScript(() => {
      const refuse = function (this: IDBObjectStore): IDBRequest {
        throw new DOMException("Made-up full device", "QuotaExceededError");
      };
      Object.assign(window, {
        __ductusFill: () => Object.assign(IDBObjectStore.prototype, { put: refuse, add: refuse }),
      });
    });
    await page.goto("/rad");
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    await page.evaluate(() => (window as unknown as { __ductusFill: () => void }).__ductusFill());
    await editorOf(page).click();
    await page.keyboard.type("Dvije riječi.");
    await expect(chipOf(page)).toHaveText("Greška");
    await expect(lengthOf(page)).toHaveText(`2${RANGE} · ≈ 1 str.`);
    await expect(statusOf(page)).not.toContainText(SERVER);
  });

  // As deployed, without the local demo journal: no session, nothing journals.
  test("no journal: the bar says nothing is saved, with no path and no save state", async ({ page }) => {
    await page.goto("http://localhost:3003/rad");
    await expect(statusOf(page)).toHaveText("Ovdje se ništa ne sprema.");
    await expect(chipOf(page)).toHaveCount(0);
    await expect(page.locator(".workspace__bar .brand-line__context")).toHaveCount(0);
    await axe(page);
  });
});
