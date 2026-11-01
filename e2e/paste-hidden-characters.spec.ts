import { expect, test, type Page } from "@playwright/test";

/**
 * docs/TESTING.md 3, scenarios 19 and 20 (DAN-232): a paste of more than
 * 100,000 characters, and zero-width and bidi characters, on the local editor
 * at /rad. The editor changes only NUL and lone surrogates on the way to the
 * journal (src/editor/storable-text.ts); every other character, invisible or
 * not, is shown and stored exactly as pasted and survives a reload. Runs in
 * every project of playwright.config.ts. Only made-up text is pasted.
 */

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Tekst rada" });

async function openEditor(page: Page): Promise<void> {
  await page.goto("/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
}

/** A plain-text paste through the editor's own paste pipeline. */
async function pastePlain(page: Page, text: string): Promise<void> {
  await editorOf(page).click();
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    const target = document.querySelector('[role="textbox"]')!;
    const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    // Firefox hands an untrusted paste event no clipboard data; the same
    // ProseMirror paste pipeline then runs directly (e2e/local-editor.spec.ts 10).
    if (!event.clipboardData?.getData("text/plain")) {
      (target as unknown as { editor: { view: { pasteText(text: string): boolean } } }).editor.view.pasteText(text);
    }
  }, text);
}

/** Block texts in the editor state, in the DOM, and in the journal's snapshot. */
function shownAndStored(page: Page): Promise<{ shown: string[]; dom: string[]; stored: string[] }> {
  return page.evaluate(async () => {
    const target = document.querySelector('[role="textbox"]') as unknown as HTMLElement & {
      editor: { state: { doc: { forEach(f: (node: { textContent: string }) => void): void } } };
    };
    const shown: string[] = [];
    target.editor.state.doc.forEach((node) => shown.push(node.textContent));
    const dom = [...target.querySelectorAll(":scope > [data-node-id]")].map((node) => node.textContent ?? "");
    const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    for (const { name } of await indexedDB.databases()) {
      const db = await request(indexedDB.open(name!));
      if (!db.objectStoreNames.contains("snapshots")) {
        db.close();
        continue;
      }
      const store = db.transaction("snapshots", "readonly").objectStore("snapshots");
      const [row] = await request(store.getAll()) as { document: { nodes: { children: { text: string }[] }[] } }[];
      db.close();
      return { shown, dom, stored: row ? row.document.nodes.map((node) => node.children.map((c) => c.text).join("")) : [] };
    }
    return { shown, dom, stored: [] };
  });
}

/** Waits until the editor state, the DOM and the journal all hold exactly the given blocks. */
async function storedAs(page: Page, blocks: string[], timeout = 30_000): Promise<void> {
  await expect.poll(async () => {
    const { shown, dom, stored } = await shownAndStored(page);
    return [shown, dom, stored].every((list) => JSON.stringify(list) === JSON.stringify(blocks));
  }, { timeout }).toBe(true);
}

const codePoints = (text: string) => [...text].map((c) => c.codePointAt(0)!.toString(16).padStart(4, "0"));

// Zero-width: ZWSP, ZWNJ, ZWJ, word joiner, BOM. Bidi: LRM, RLM, LRE, RLE,
// PDF, LRO, RLO, LRI, RLI, FSI, PDI. Each one sits between two letters.
const HIDDEN = [
  "​", "‌", "‍", "⁠", "﻿",
  "‎", "‏", "‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩",
];
const HIDDEN_TEXT = "Izmišljen " + HIDDEN.map((c, i) => `${String.fromCharCode(97 + i)}${c}`).join("") + "kraj";

test.describe("TESTING.md 3, scenarios 19 and 20: large and invisible pastes (DAN-232)", () => {
  test("19: a paste of 100,001 characters is shown and stored whole and survives a reload", async ({ page }) => {
    test.setTimeout(120_000);
    // 100 lines of 1,000 characters plus one, with letters outside ASCII; each
    // line becomes one paragraph.
    const lines = Array.from({ length: 100 }, (_, i) =>
      `${String(i).padStart(3, "0")} ` + "Izmišljena rečenica za veliko lijepljenje č ć đ š ž. ".repeat(20).slice(0, 996));
    lines[99] += "!";
    expect(lines.join("").length).toBe(100_001);

    await openEditor(page);
    await pastePlain(page, lines.join("\n"));
    await storedAs(page, lines);

    await page.reload();
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    await storedAs(page, lines);
  });

  test("20: zero-width and bidi characters are shown and stored as pasted, code point by code point", async ({ page }) => {
    await openEditor(page);
    await pastePlain(page, HIDDEN_TEXT);
    await storedAs(page, [HIDDEN_TEXT]);
    const { stored } = await shownAndStored(page);
    expect(codePoints(stored[0]!)).toEqual(codePoints(HIDDEN_TEXT));
    for (const c of HIDDEN) expect(stored[0]).toContain(c);

    await page.reload();
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    await storedAs(page, [HIDDEN_TEXT]);
    expect(codePoints((await shownAndStored(page)).shown[0]!)).toEqual(codePoints(HIDDEN_TEXT));
  });

  test("20: typing right after a paste that ends inside a right-to-left override lands after the paste", async ({ page }) => {
    // The paste ends with RLO and no closing PDF, so the caret sits in an
    // override the paste opened.
    const pasted = "prije ‮obrnuto";
    await openEditor(page);
    await pastePlain(page, pasted);
    await storedAs(page, [pasted]);
    await page.keyboard.type("X");
    await storedAs(page, [`${pasted}X`]);
  });
});
