import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The bullet list item in the editor on /rad (E1 part 1, #823, DAN-326,
 * contract issuecomment-6412639687, QA criterion §4): the "Popis" button,
 * Mod-Shift-8, "- " and "* ", Enter, Backspace and Tab at the edges of an
 * item, pasted HTML, the "Više" menu on a phone, and the journal keeping the
 * item over a reload. Only made-up text is typed or pasted.
 */

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Tekst rada" });
const toolbarOf = (page: Page) => page.getByRole("toolbar", { name: "Oblikovanje teksta" });
const listButton = (page: Page) => toolbarOf(page).getByRole("button", { name: "Popis", exact: true });
const moreButton = (page: Page) => toolbarOf(page).getByRole("button", { name: "Više" });
const moreMenu = (page: Page) => page.getByRole("menu", { name: "Više alata" });

async function openEditor(page: Page, width = 1440): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
}

/** Type and text of every block, as the editor shows them. */
async function blocksOf(page: Page): Promise<[string, string][]> {
  return editorOf(page).locator(":scope > *").evaluateAll((nodes) =>
    nodes.map((node) => {
      const block = node.getAttribute("data-block");
      return [block === "bullet-item" ? "item" : block === "quote" ? "quote" : node.tagName.toLowerCase(), node.textContent ?? ""];
    }));
}

/**
 * Waits until the editor itself has read the caret the browser just moved
 * (Home is the browser's, and the editor reads it on selectionchange), so
 * the next key goes to the editor's own handler, not to the browser.
 */
async function caretAtBlockStart(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const target = document.querySelector('[role="textbox"]') as unknown as {
      editor: { state: { selection: { $from: { parentOffset: number } } } };
    };
    return target.editor.state.selection.$from.parentOffset;
  })).toBe(0);
}

async function paste(page: Page, html: string): Promise<void> {
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData("text/html", value);
    data.setData("text/plain", "izmisljeno");
    const target = document.querySelector('[role="textbox"]')!;
    const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    // Firefox hands an untrusted paste event no clipboard data (local-editor.spec.ts 11).
    if (!event.clipboardData?.getData("text/html")) {
      (target as unknown as { editor: { view: { pasteHTML(html: string): boolean } } }).editor.view.pasteHTML(value);
    }
  }, html);
}

test.describe("bullet item (E1)", () => {
  test("the button turns a line into an item and back; one undo; the item has the bullet and the button is pressed", async ({ page }) => {
    await openEditor(page);
    await editorOf(page).click();
    await page.keyboard.type("Prva stavka");
    await expect(listButton(page)).toHaveAttribute("aria-pressed", "false");
    // The history joins changes less than 500 ms apart into one undo step.
    await page.waitForTimeout(600);
    await listButton(page).click();
    expect(await blocksOf(page)).toEqual([["item", "Prva stavka"]]);
    await expect(listButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect(editorOf(page)).toBeFocused();
    await expect(editorOf(page).locator("p[data-block=bullet-item]")).toHaveCSS("display", "list-item");
    await page.keyboard.press("ControlOrMeta+z");
    expect(await blocksOf(page)).toEqual([["p", "Prva stavka"]]);
    await page.keyboard.press("ControlOrMeta+Shift+8");
    expect(await blocksOf(page)).toEqual([["item", "Prva stavka"]]);
    await listButton(page).click();
    expect(await blocksOf(page)).toEqual([["p", "Prva stavka"]]);
  });

  test("Enter, Backspace and Tab at the edges of an item; the ids stay apart; the journal keeps the items", async ({ page }) => {
    await openEditor(page);
    await editorOf(page).click();
    await page.keyboard.type("- Prva");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Druga");
    await page.keyboard.press("Enter");
    // Enter on an empty item leaves the list.
    await page.keyboard.press("Enter");
    await page.keyboard.type("Odlomak");
    expect(await blocksOf(page)).toEqual([["item", "Prva"], ["item", "Druga"], ["p", "Odlomak"]]);

    // Backspace at the start of an item gives a paragraph; the text stays.
    await editorOf(page).locator("p", { hasText: "Druga" }).click();
    await page.keyboard.press("Home");
    await caretAtBlockStart(page);
    await page.keyboard.press("Backspace");
    expect(await blocksOf(page)).toEqual([["item", "Prva"], ["p", "Druga"], ["p", "Odlomak"]]);

    // There is no nesting: Tab and Shift+Tab change nothing in the text.
    await editorOf(page).locator("p", { hasText: "Prva" }).click();
    const before = await editorOf(page).innerHTML();
    await page.keyboard.press("Tab");
    await editorOf(page).focus();
    await page.keyboard.press("Shift+Tab");
    expect(await editorOf(page).innerHTML()).toBe(before);

    const ids = await editorOf(page).locator(":scope > [data-node-id]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-node-id")));
    expect(new Set(ids).size).toBe(3);
    await expect(page.locator(".workspace__status")).toContainText("Spremljeno na uređaju");
    await page.reload();
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    expect(await blocksOf(page)).toEqual([["item", "Prva"], ["p", "Druga"], ["p", "Odlomak"]]);
    expect(await editorOf(page).locator(":scope > [data-node-id]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-node-id"))))
      .toEqual(ids);
  });

  // As every paste in ProseMirror, the first pasted block flows into the
  // block the caret is in and takes its type; the rest keep their own.
  test("pasted HTML: ul items become items, nested ones follow, ol and Word lists stay paragraphs, blockquote is a quote (E1 part 2)", async ({ page }) => {
    await openEditor(page);
    await editorOf(page).click();
    await page.keyboard.type("Uvod");
    await page.keyboard.press("Enter");
    await paste(page, [
      '<ul><li data-node-id="11111111-1111-4111-8111-111111111111">jedan</li><li><p>dva</p></li>',
      "<li>tri<ul><li>četiri</li></ul></li></ul>",
      "<ol><li>pet</li></ol>",
      "<blockquote><p>šest</p></blockquote>",
      "<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'>sedam</p>",
    ].join(""));
    const blocks = await blocksOf(page);
    expect(blocks.slice(0, 1)).toEqual([["p", "Uvod"]]);
    expect(blocks.slice(1)).toEqual([
      ["p", "jedan"], ["item", "dva"], ["item", "tri"], ["item", "četiri"], ["p", "pet"], ["quote", "šest"], ["p", "sedam"],
    ]);
    const ids = await editorOf(page).locator(":scope > [data-node-id]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-node-id")));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("11111111-1111-4111-8111-111111111111");
  });

  test("screenshots, dark and white sheet; no accessibility violation on the toolbar and the text", async ({ page }) => {
    await openEditor(page);
    await editorOf(page).click();
    await page.keyboard.type("Odlomak prije popisa.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("- Prva stavka popisa");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Druga stavka popisa");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Odlomak poslije popisa.");
    const results = await new AxeBuilder({ page }).include(".editor-toolbar").include('[role="textbox"]').analyze();
    expect(results.violations).toEqual([]);
    await test.info().attach("e1-popis-bijeli-1440", { body: await page.screenshot(), contentType: "image/png" });
    await toolbarOf(page).getByRole("button", { name: "Prikaz" }).click();
    await page.getByRole("menu", { name: "Prikaz" }).getByRole("menuitemradio", { name: "Tamni list" }).click();
    await test.info().attach("e1-popis-tamni-1440", { body: await page.screenshot(), contentType: "image/png" });
  });
});

test.describe("bullet item on a phone (390 px)", () => {
  test("Popis moves into Više after the headings and runs the same command", async ({ page }) => {
    await openEditor(page, 390);
    await editorOf(page).click();
    await page.keyboard.type("Stavka s telefona");
    await expect(listButton(page)).toHaveCount(0);
    await moreButton(page).click();
    await expect(moreMenu(page).getByRole("menuitemcheckbox")).toHaveText([/Naslov 1/, /Naslov 2/, /Naslov 3/, /Popis/, /Blok-citat/]);
    const item = moreMenu(page).getByRole("menuitemcheckbox", { name: "Popis", exact: true });
    await expect(item).toHaveAttribute("aria-checked", "false");
    await item.click();
    expect(await blocksOf(page)).toEqual([["item", "Stavka s telefona"]]);
    await expect(editorOf(page)).toBeFocused();
    await moreButton(page).click();
    await expect(item).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await test.info().attach("e1-popis-bijeli-390", { body: await page.screenshot(), contentType: "image/png" });
  });
});
