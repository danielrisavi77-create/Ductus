import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The quote paragraph in the editor on /rad (E1 part 2, #823, DAN-326,
 * contract issuecomment-6412639687, QA criterion §4): the "Blok-citat"
 * button, Mod-Shift-b (not bold), "> ", Enter and Backspace at the edges of a
 * quote, pasted HTML, the "Više" menu on a phone, and the journal keeping the
 * quote over a reload. Only made-up text is typed or pasted.
 */

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Tekst rada" });
const toolbarOf = (page: Page) => page.getByRole("toolbar", { name: "Oblikovanje teksta" });
const quoteButton = (page: Page) => toolbarOf(page).getByRole("button", { name: "Blok-citat", exact: true });
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

/** Waits until the editor itself has read the caret the browser just moved (bullet-item.spec.ts). */
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

test.describe("quote paragraph (E1)", () => {
  test("the button and Mod-Shift-b turn a line into a quote and back; one undo; never bold", async ({ page }) => {
    await openEditor(page);
    await editorOf(page).click();
    await page.keyboard.type("Navod iz izvora");
    await expect(quoteButton(page)).toHaveAttribute("aria-pressed", "false");
    // The history joins changes less than 500 ms apart into one undo step.
    await page.waitForTimeout(600);
    await quoteButton(page).click();
    expect(await blocksOf(page)).toEqual([["quote", "Navod iz izvora"]]);
    await expect(quoteButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect(editorOf(page)).toBeFocused();
    await page.keyboard.press("ControlOrMeta+z");
    expect(await blocksOf(page)).toEqual([["p", "Navod iz izvora"]]);
    await page.keyboard.press("ControlOrMeta+Shift+b");
    expect(await blocksOf(page)).toEqual([["quote", "Navod iz izvora"]]);
    await expect(editorOf(page).locator("strong")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+b");
    expect(await blocksOf(page)).toEqual([["p", "Navod iz izvora"]]);
  });

  test("'> ', Enter and Backspace at the edges of a quote; the ids stay apart; the journal keeps it", async ({ page }) => {
    await openEditor(page);
    await editorOf(page).click();
    await page.keyboard.type("> Prvi navod");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Drugi navod");
    await page.keyboard.press("Enter");
    // Enter on an empty quote paragraph leaves the quote.
    await page.keyboard.press("Enter");
    await page.keyboard.type("Odlomak");
    expect(await blocksOf(page)).toEqual([["quote", "Prvi navod"], ["quote", "Drugi navod"], ["p", "Odlomak"]]);

    await editorOf(page).locator("p", { hasText: "Drugi navod" }).click();
    await page.keyboard.press("Home");
    await caretAtBlockStart(page);
    await page.keyboard.press("Backspace");
    expect(await blocksOf(page)).toEqual([["quote", "Prvi navod"], ["p", "Drugi navod"], ["p", "Odlomak"]]);

    const ids = await editorOf(page).locator(":scope > [data-node-id]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-node-id")));
    expect(new Set(ids).size).toBe(3);
    await expect(page.locator(".workspace__status")).toContainText("Spremljeno na uređaju");
    await page.reload();
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    expect(await blocksOf(page)).toEqual([["quote", "Prvi navod"], ["p", "Drugi navod"], ["p", "Odlomak"]]);
    expect(await editorOf(page).locator(":scope > [data-node-id]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-node-id"))))
      .toEqual(ids);
  });

  // As every paste in ProseMirror, the first pasted block flows into the
  // block the caret is in and takes its type; the rest keep their own.
  test("pasted HTML: blockquote paragraphs become quote paragraphs, a list inside stays a list", async ({ page }) => {
    await openEditor(page);
    await editorOf(page).click();
    await page.keyboard.type("Uvod");
    await page.keyboard.press("Enter");
    await paste(page, [
      "<p>prvi</p>",
      '<blockquote data-node-id="11111111-1111-4111-8111-111111111111"><p>dva</p><p>tri</p></blockquote>',
      "<blockquote>četiri</blockquote>",
      "<blockquote><ul><li>pet</li></ul></blockquote>",
      "<p>šest</p>",
    ].join(""));
    const blocks = await blocksOf(page);
    expect(blocks).toEqual([
      ["p", "Uvod"], ["p", "prvi"], ["quote", "dva"], ["quote", "tri"], ["quote", "četiri"], ["item", "pet"], ["p", "šest"],
    ]);
    const ids = await editorOf(page).locator(":scope > [data-node-id]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-node-id")));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("11111111-1111-4111-8111-111111111111");
  });

  test("screenshots, dark and white sheet; no accessibility violation on the toolbar and the text", async ({ page }) => {
    await openEditor(page);
    await editorOf(page).click();
    await page.keyboard.type("Odlomak prije navoda.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("> Prvi odlomak navoda koji se prenosi doslovno.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Drugi odlomak istog navoda.");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("- Stavka popisa");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Odlomak poslije navoda.");
    const results = await new AxeBuilder({ page }).include(".editor-toolbar").include('[role="textbox"]').analyze();
    expect(results.violations).toEqual([]);
    await test.info().attach("e1-citat-tamni-1440", { body: await page.screenshot(), contentType: "image/png" });
    await toolbarOf(page).getByRole("button", { name: "Prikaz" }).click();
    await page.getByRole("menu", { name: "Prikaz" }).getByRole("menuitemradio", { name: "Bijeli list" }).click();
    await test.info().attach("e1-citat-bijeli-1440", { body: await page.screenshot(), contentType: "image/png" });
  });
});

test.describe("quote paragraph on a phone (390 px)", () => {
  test("Blok-citat moves into Više after the list and runs the same command", async ({ page }) => {
    await openEditor(page, 390);
    await editorOf(page).click();
    await page.keyboard.type("Navod s telefona");
    await expect(quoteButton(page)).toHaveCount(0);
    await moreButton(page).click();
    await expect(moreMenu(page).getByRole("menuitemcheckbox")).toHaveText([/Naslov 1/, /Naslov 2/, /Naslov 3/, /Popis/, /Blok-citat/]);
    const item = moreMenu(page).getByRole("menuitemcheckbox", { name: "Blok-citat", exact: true });
    await expect(item).toHaveAttribute("aria-checked", "false");
    await item.click();
    expect(await blocksOf(page)).toEqual([["quote", "Navod s telefona"]]);
    await expect(editorOf(page)).toBeFocused();
    await moreButton(page).click();
    await expect(item).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await test.info().attach("e1-citat-tamni-390", { body: await page.screenshot(), contentType: "image/png" });
  });
});
