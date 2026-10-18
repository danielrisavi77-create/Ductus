import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The editor shell on /rad (F-8 step 1): the toolbar above the sheet and the
 * heading list in the structure rail. Every test starts with an empty
 * IndexedDB (fresh browser context). Only made-up text is typed.
 */

const DURABLE = "Spremljeno na uređaju";
const BLOCKED = "Ova kartica ništa ne sprema dok je druga otvorena.";

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Tekst rada" });
const toolbarOf = (page: Page) => page.getByRole("toolbar", { name: "Oblikovanje teksta" });
const tool = (page: Page, name: string) => toolbarOf(page).getByRole("button", { name, exact: true });
const outlineOf = (page: Page) => page.getByRole("navigation", { name: "Naslovi u radu" });
const chipOf = (page: Page) => page.locator(".workspace__status .sync-chip");

async function openEditor(page: Page): Promise<void> {
  await page.goto("/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  await openStructure(page);
}

/** Below 1100 px the structure rail sits under the sheet, closed. */
async function openStructure(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Struktura rada" });
  if (await toggle.isVisible()) await toggle.click();
}

/** Types a block, turns it into a heading of `level` (or keeps a paragraph), then starts a new line. */
async function block(page: Page, text: string, level?: 1 | 2 | 3): Promise<void> {
  await page.keyboard.type(text);
  if (level) await tool(page, `Naslov ${level}`).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
}

test.describe("editor shell", () => {
  test("a heading set from the toolbar is pressed, listed in the structure and kept after a reload", async ({ page }) => {
    await openEditor(page);
    await expect(outlineOf(page)).toHaveCount(0);
    await expect(page.getByText("Naslovi će se pojaviti ovdje.")).toBeVisible();

    await editorOf(page).click();
    await page.keyboard.type("Uvod u temu");
    await tool(page, "Naslov 1").click();
    await expect(editorOf(page).locator("h1")).toHaveText("Uvod u temu");
    await expect(tool(page, "Naslov 1")).toHaveAttribute("aria-pressed", "true");
    await expect(tool(page, "Odlomak")).toHaveAttribute("aria-pressed", "false");
    await expect(outlineOf(page).getByRole("button")).toHaveText(["Uvod u temu"]);

    // The command went to the journal like typing: it is there after a reload.
    await expect(chipOf(page)).toHaveText(DURABLE);
    await page.reload();
    await expect(editorOf(page).locator("h1")).toHaveText("Uvod u temu");
    await openStructure(page);
    await expect(outlineOf(page).getByRole("button")).toHaveText(["Uvod u temu"]);
  });

  test("the paragraph button turns a heading back; bold, italic, undo and redo work on the selection", async ({ page }) => {
    await openEditor(page);
    await editorOf(page).click();
    await page.keyboard.type("Okvir rada");
    await tool(page, "Naslov 2").click();
    await expect(outlineOf(page).getByRole("button")).toHaveText(["Okvir rada"]);
    await tool(page, "Odlomak").click();
    await expect(editorOf(page).locator("h2")).toHaveCount(0);
    await expect(outlineOf(page)).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+a");
    await tool(page, "Podebljano").click();
    await expect(editorOf(page).locator("strong")).toHaveText("Okvir rada");
    await expect(tool(page, "Podebljano")).toHaveAttribute("aria-pressed", "true");
    await tool(page, "Kurziv").click();
    await expect(editorOf(page).locator("em")).toHaveText("Okvir rada");

    await tool(page, "Poništi").click();
    await expect(editorOf(page).locator("em")).toHaveCount(0);
    await tool(page, "Ponovi").click();
    await expect(editorOf(page).locator("em")).toHaveText("Okvir rada");
  });

  test("the structure lists headings by level, marks the current section and moves the cursor there", async ({ page }) => {
    await openEditor(page);
    await editorOf(page).click();
    await block(page, "Uvod", 1);
    await block(page, "Prvi odlomak teksta.");
    await block(page, "Pojmovi", 2);
    await page.keyboard.type("Drugi odlomak.");

    const items = outlineOf(page).locator(".outline__item");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveAttribute("data-level", "1");
    await expect(items.nth(1)).toHaveAttribute("data-level", "2");
    await expect(outlineOf(page).getByRole("button", { name: "Pojmovi" })).toHaveAttribute("aria-current", "location");

    // The editor has focus as soon as the click is handled, not a frame later:
    // a key typed in between would go to the button and be lost.
    const focusedAtOnce = await outlineOf(page).getByRole("button", { name: "Uvod" }).evaluate((button) => {
      // A pointer press moves focus to the button before the click.
      (button as HTMLElement).focus();
      (button as HTMLElement).click();
      return document.activeElement?.getAttribute("contenteditable") === "true";
    });
    expect(focusedAtOnce).toBe(true);

    await outlineOf(page).getByRole("button", { name: "Uvod" }).click();
    await expect(outlineOf(page).getByRole("button", { name: "Uvod" })).toHaveAttribute("aria-current", "location");
    // The cursor is at the start of the heading: typing goes in front of it.
    await page.keyboard.type("Novi ");
    await expect(editorOf(page).locator("h1")).toHaveText("Novi Uvod");
  });

  test("the toolbar is one Tab stop and the arrow keys move inside it", async ({ page }) => {
    await openEditor(page);
    await tool(page, "Odlomak").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tool(page, "Naslov 1")).toBeFocused();
    await page.keyboard.press("End");
    await expect(tool(page, "Ponovi")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(tool(page, "Odlomak")).toBeFocused();
    await expect(toolbarOf(page).locator('button[tabindex="0"]')).toHaveCount(1);
  });

  test("a second tab of the document: the toolbar says it is unavailable and changes nothing", async ({ page, context }) => {
    await openEditor(page);
    await editorOf(page).click();
    await page.keyboard.type("Tekst prve kartice");
    await expect(chipOf(page)).toHaveText(DURABLE);

    const second = await context.newPage();
    await second.goto("/rad");
    await expect(second.getByText(BLOCKED, { exact: false })).toBeVisible();
    await expect(tool(second, "Naslov 1")).toHaveAttribute("aria-disabled", "true");
    // `force`: Playwright waits for an enabled button, and this one says it is not.
    await tool(second, "Naslov 1").click({ force: true });
    await expect(editorOf(second).locator("h1")).toHaveCount(0);
    await expect(editorOf(page).locator("h1")).toHaveCount(0);
  });

  test("the shell with a heading has no axe violations", async ({ page }) => {
    await openEditor(page);
    await editorOf(page).click();
    await block(page, "Uvod", 1);
    await page.keyboard.type("Tekst.");
    await expect(outlineOf(page).getByRole("button")).toHaveText(["Uvod"]);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
