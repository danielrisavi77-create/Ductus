import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The toolbar menus of /rad (FE-D5, design editor-v11): "Više ▾" holds the
 * headings a narrow toolbar cannot show, "Prikaz ▾" the sheet theme. Both
 * follow the WAI-ARIA menu button pattern, by mouse and by keyboard, wide
 * (1440 px) and on a phone (390 px). Only made-up text is typed.
 */

const BLOCKED = "Ova kartica ništa ne sprema dok je druga otvorena.";

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Tekst rada" });
const toolbarOf = (page: Page) => page.getByRole("toolbar", { name: "Oblikovanje teksta" });
const tool = (page: Page, name: string) => toolbarOf(page).getByRole("button", { name, exact: true });
const moreButton = (page: Page) => toolbarOf(page).getByRole("button", { name: "Više" });
const viewButton = (page: Page) => toolbarOf(page).getByRole("button", { name: "Prikaz" });
const moreMenu = (page: Page) => page.getByRole("menu", { name: "Više alata" });
const viewMenu = (page: Page) => page.getByRole("menu", { name: "Prikaz" });
const heading = (page: Page, name: string) => moreMenu(page).getByRole("menuitemcheckbox", { name, exact: true });
const theme = (page: Page, name: string) => viewMenu(page).getByRole("menuitemradio", { name });
const sheetOf = (page: Page) => page.locator("article.sheet");

async function openEditor(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
}

test.describe("toolbar menus, wide (1440 px)", () => {
  test("every tool fits, so there is no Više; Prikaz is a menu button", async ({ page }) => {
    await openEditor(page, 1440);
    for (const name of ["Odlomak", "Naslov 1", "Naslov 2", "Naslov 3", "Podebljano", "Kurziv", "Popis", "Blok-citat", "Poništi", "Ponovi"]) {
      await expect(tool(page, name)).toBeVisible();
    }
    await expect(moreButton(page)).toHaveCount(0);
    await expect(viewButton(page)).toHaveAttribute("aria-haspopup", "menu");
    await expect(viewButton(page)).toHaveAttribute("aria-expanded", "false");
    // The theme has one place: the switch above the sheet steps aside.
    await expect(page.getByRole("group", { name: "Tema lista" })).toBeHidden();
  });

  test("Prikaz by mouse: opens, shows the theme as checked, switches it, closes on a click elsewhere", async ({ page }) => {
    await openEditor(page, 1440);
    await viewButton(page).click();
    await expect(viewButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(viewMenu(page).getByRole("group", { name: "List" })).toBeVisible();
    await expect(theme(page, "Tamni list")).toHaveAttribute("aria-checked", "true");
    await expect(theme(page, "Bijeli list")).toHaveAttribute("aria-checked", "false");
    await theme(page, "Bijeli list").click();
    await expect(sheetOf(page)).toHaveAttribute("data-sheet-theme", "light");
    await expect(viewMenu(page)).toHaveCount(0);
    await expect(viewButton(page)).toBeFocused();

    await viewButton(page).click();
    await expect(viewMenu(page)).toBeVisible();
    // A click on a place that takes no focus, away from the menu.
    await page.getByRole("banner").click({ position: { x: 4, y: 4 } });
    await expect(viewMenu(page)).toHaveCount(0);
    await expect(viewButton(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("Prikaz by keyboard: Enter opens on the first item, arrows wrap, Escape returns focus, Space chooses", async ({ page }) => {
    await openEditor(page, 1440);
    await tool(page, "Odlomak").focus();
    await page.keyboard.press("End");
    await expect(viewButton(page)).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(theme(page, "Tamni list")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(theme(page, "Bijeli list")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(theme(page, "Tamni list")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(theme(page, "Bijeli list")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(theme(page, "Tamni list")).toBeFocused();
    await page.keyboard.press("End");
    await expect(theme(page, "Bijeli list")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(viewMenu(page)).toHaveCount(0);
    await expect(viewButton(page)).toBeFocused();
    await expect(sheetOf(page)).toHaveAttribute("data-sheet-theme", "dark");

    // ArrowUp opens on the last item; Space chooses it and focus comes back.
    await page.keyboard.press("ArrowUp");
    await expect(theme(page, "Bijeli list")).toBeFocused();
    await page.keyboard.press(" ");
    await expect(sheetOf(page)).toHaveAttribute("data-sheet-theme", "light");
    await expect(viewMenu(page)).toHaveCount(0);
    await expect(viewButton(page)).toBeFocused();
    // The toolbar stays one Tab stop: the menu items are not Tab stops.
    await expect(toolbarOf(page).locator('[tabindex="0"]')).toHaveCount(1);
  });

  test("Tab out of an open menu closes it", async ({ page }) => {
    await openEditor(page, 1440);
    await viewButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(viewMenu(page)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(viewMenu(page)).toHaveCount(0);
    await expect(viewButton(page)).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("toolbar menus, phone (390 px)", () => {
  test("the headings, then the block quote and the list (E1), move into Više, in toolbar order; the other tools stay", async ({ page }) => {
    await openEditor(page, 390);
    for (const name of ["Naslov 1", "Naslov 2", "Naslov 3", "Popis", "Blok-citat"]) await expect(tool(page, name)).toHaveCount(0);
    for (const name of ["Odlomak", "Podebljano", "Kurziv", "Poništi", "Ponovi"]) await expect(tool(page, name)).toBeVisible();
    // One row: the toolbar no longer wraps.
    const tops = await toolbarOf(page).locator("[data-roving]").evaluateAll(
      (buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size).toBe(1);

    await expect(moreButton(page)).toHaveAttribute("aria-haspopup", "menu");
    await moreButton(page).click();
    await expect(moreMenu(page).getByRole("menuitemcheckbox")).toHaveText([/Naslov 1/, /Naslov 2/, /Naslov 3/, /Popis/, /Blok-citat/]);
  });

  test("Više by mouse runs the same command as the button: a heading, listed and checked", async ({ page }) => {
    await openEditor(page, 390);
    await editorOf(page).click();
    await page.keyboard.type("Okvir rada");
    await moreButton(page).click();
    await expect(heading(page, "Naslov 2")).toHaveAttribute("aria-checked", "false");
    await heading(page, "Naslov 2").click();
    await expect(editorOf(page).locator("h2")).toHaveText("Okvir rada");
    await expect(moreMenu(page)).toHaveCount(0);
    // The command puts the cursor back in the sheet, as its button does.
    await expect(editorOf(page)).toBeFocused();
    await moreButton(page).click();
    await expect(heading(page, "Naslov 2")).toHaveAttribute("aria-checked", "true");
  });

  test("Više by keyboard: ArrowDown opens, Enter chooses, Escape returns focus; one menu at a time", async ({ page }) => {
    await openEditor(page, 390);
    await editorOf(page).click();
    await page.keyboard.type("Uvod");
    await moreButton(page).focus();
    await page.keyboard.press("ArrowDown");
    await expect(heading(page, "Naslov 1")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    // The last item: the block quote, after the headings and the list (E1).
    await expect(heading(page, "Blok-citat")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(moreMenu(page)).toHaveCount(0);
    await expect(moreButton(page)).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(heading(page, "Naslov 1")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(editorOf(page).locator("h1")).toHaveText("Uvod");
    await expect(moreMenu(page)).toHaveCount(0);

    await moreButton(page).click();
    await expect(moreMenu(page)).toBeVisible();
    await viewButton(page).click();
    await expect(viewMenu(page)).toBeVisible();
    await expect(moreMenu(page)).toHaveCount(0);
  });

  test("text is at least 13 px and every target at least 44 px, menus open", async ({ page }) => {
    await openEditor(page, 390);
    await moreButton(page).click();
    const targets = page.locator(".editor-toolbar [data-roving], .editor-menu__item");
    for (const box of await targets.evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { size: parseFloat(getComputedStyle(element).fontSize), height: rect.height, width: rect.width };
    }))) {
      expect(box.size).toBeGreaterThanOrEqual(13);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    // Nothing runs off the page sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test("a second tab: the Više items say they are unavailable and change nothing", async ({ page, context }) => {
    await openEditor(page, 390);
    const second = await context.newPage();
    await second.setViewportSize({ width: 390, height: 900 });
    await second.goto("/rad");
    await expect(second.getByText(BLOCKED, { exact: false })).toBeVisible();
    await moreButton(second).click();
    await expect(heading(second, "Naslov 1")).toHaveAttribute("aria-disabled", "true");
    await heading(second, "Naslov 1").click({ force: true });
    await expect(editorOf(second).locator("h1")).toHaveCount(0);
    // Unavailable: nothing happened, so the menu stays where it was.
    await expect(moreMenu(second)).toBeVisible();
  });

  test("a new width closes an open Više for good: focus goes to the toolbar, never back into the menu (review524)", async ({ page }) => {
    await openEditor(page, 390);
    await moreButton(page).click();
    await expect(heading(page, "Naslov 1")).toBeFocused();

    // Wider: the headings return to the toolbar, the menu is gone and focus
    // is on the toolbar, not on the page body.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(tool(page, "Naslov 3")).toBeVisible();
    await expect(moreMenu(page)).toHaveCount(0);
    await expect(toolbarOf(page).locator(":focus")).toHaveCount(1);

    // Writing, then narrow again: "Više" comes back closed and the sheet keeps
    // focus, so Enter is a new line, not a heading.
    await editorOf(page).click();
    await page.keyboard.type("Izmišljeni tekst");
    await page.setViewportSize({ width: 390, height: 900 });
    await expect(moreButton(page)).toBeVisible();
    await expect(moreButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(moreMenu(page)).toHaveCount(0);
    await expect(editorOf(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.type("Drugi redak");
    await expect(editorOf(page).locator("h1, h2, h3")).toHaveCount(0);
    await expect(editorOf(page).locator("p")).toHaveText(["Izmišljeni tekst", "Drugi redak"]);
  });

  test("a wider window brings the headings back to the toolbar", async ({ page }) => {
    await openEditor(page, 390);
    await expect(moreButton(page)).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(tool(page, "Naslov 3")).toBeVisible();
    await expect(moreButton(page)).toHaveCount(0);
  });
});

for (const width of [1440, 390]) {
  test(`axe: no WCAG 2.1 AA violations with each menu open (${width} px)`, async ({ page }) => {
    await openEditor(page, width);
    const menus = width === 390 ? [moreButton(page), viewButton(page)] : [viewButton(page)];
    for (const button of menus) {
      await button.click();
      await expect(page.getByRole("menu")).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
      await page.keyboard.press("Escape");
    }
  });
}
