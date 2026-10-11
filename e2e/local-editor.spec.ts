import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The local editor on /rad (F-3 step 1b, plan #197). Playwright gives every
 * test a fresh browser context, so every test starts with an empty IndexedDB.
 * Only made-up text is typed or pasted.
 */

const SAVED = "Spremljeno na uređaju";
const EDITING = "Uređivanje";
const ERROR = "Greška";
const BLOCKED = "Dokument je otvoren u drugoj kartici.";
const NODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Tekst rada" });
const chipOf = (page: Page) => page.locator(".sync-chip");
const noticeOf = (page: Page) => page.locator(".editor-notice[role=alert]");

async function openEditor(page: Page): Promise<void> {
  await page.goto("/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
}

async function typeInto(page: Page, text: string): Promise<void> {
  await editorOf(page).click();
  await page.keyboard.type(text);
}

const blockIds = (page: Page) => editorOf(page).locator(":scope > [data-node-id]")
  .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-node-id")));

/**
 * Rewrites the stored snapshot of the only journalled document: the second
 * block takes the first block's id, in the given letter case. Returns the
 * stored ids afterwards; `null` leaves the snapshot as it is (read only).
 */
function storedIds(page: Page, repeat: "same" | "upper" | null): Promise<string[]> {
  return page.evaluate(async (repeat) => {
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
      const store = db.transaction("snapshots", "readwrite").objectStore("snapshots");
      const [row] = await request(store.getAll()) as { document: { nodes: { id: string }[] } }[];
      const nodes = row!.document.nodes;
      if (repeat) {
        nodes[1]!.id = repeat === "upper" ? nodes[0]!.id.toUpperCase() : nodes[0]!.id;
        await request(store.put(row));
      }
      db.close();
      return nodes.map((node) => node.id);
    }
    throw new Error("no journal database");
  }, repeat);
}

/** The text of every block, as the editor holds it and as the journal stores it. */
async function shownAndStored(page: Page): Promise<{ shown: string[]; stored: string[] }> {
  return page.evaluate(async () => {
    const target = document.querySelector('[role="textbox"]') as unknown as {
      editor: { state: { doc: { forEach(f: (node: { textContent: string }) => void): void } } };
    };
    const shown: string[] = [];
    target.editor.state.doc.forEach((node) => shown.push(node.textContent));
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
      return { shown, stored: row!.document.nodes.map((node) => node.children.map((c) => c.text).join("")) };
    }
    throw new Error("no journal database");
  });
}

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe("local editor (#197)", () => {
  test("reload: saved text and word count come back, and the chip only says what is on the device", async ({ page }) => {
    await openEditor(page);
    await expect(chipOf(page)).toHaveText(EDITING);
    await typeInto(page, "Prva rečenica izmišljenog rada.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Drugi odlomak.");
    await expect(chipOf(page)).toHaveText(SAVED);
    await expect(page.getByText("6 riječi")).toBeVisible();

    await page.reload();
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    await expect(editorOf(page).locator("p")).toHaveText(["Prva rečenica izmišljenog rada.", "Drugi odlomak."]);
    await expect(chipOf(page)).toHaveText(SAVED);
    await expect(page.getByText("6 riječi")).toBeVisible();
  });

  test("9: right after a keystroke the chip says editing, never saved", async ({ page }) => {
    await openEditor(page);
    await typeInto(page, "Spremljeno");
    await expect(chipOf(page)).toHaveText(SAVED);
    await page.keyboard.type(" još");
    // The debounce has not run yet: the new text is not on the device.
    await expect(chipOf(page)).toHaveText(EDITING);
    await expect(chipOf(page)).toHaveText(SAVED);
  });

  // A browser may end the page before the pagehide flush commits, so what is
  // guaranteed is the text up to the last "Spremljeno na uređaju"; at most
  // the debounce window after it can be lost, and never while claimed saved.
  test("1: a reload right after typing keeps everything up to the last save", async ({ page }) => {
    await openEditor(page);
    await typeInto(page, "Spremljeni dio");
    await expect(chipOf(page)).toHaveText(SAVED);
    await page.keyboard.type(" i zadnja misao");
    await expect(chipOf(page)).toHaveText(EDITING);
    await page.reload();
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    const text = await editorOf(page).innerText();
    expect(["Spremljeni dio", "Spremljeni dio i zadnja misao"]).toContain(text.trim());
    await expect(chipOf(page)).toHaveText(SAVED);
  });

  test("4: a second tab is read-only and blocked, and takes over once the first closes", async ({ page, context }) => {
    await openEditor(page);
    await typeInto(page, "Tekst iz prve kartice");
    await expect(chipOf(page)).toHaveText(SAVED);

    const second = await context.newPage();
    await second.goto("/rad");
    await expect(chipOf(second)).toHaveText(BLOCKED);
    await expect(second.getByText("Ova kartica ništa ne sprema dok je druga otvorena.", { exact: false })).toBeVisible();
    await expect(editorOf(second)).toHaveAttribute("contenteditable", "false");
    await expect(editorOf(second)).toHaveAttribute("aria-readonly", "true");
    await axe(second);

    await typeInto(page, ", dopisan");
    await expect(chipOf(page)).toHaveText(SAVED);
    await page.close();

    // The journal is read again, so the text written after the second tab opened is there.
    await expect(editorOf(second)).toHaveAttribute("contenteditable", "true");
    await expect(editorOf(second)).toHaveText("Tekst iz prve kartice, dopisan");
    await expect(chipOf(second)).toHaveText(SAVED);
    await typeInto(second, " i nastavljen");
    await expect(chipOf(second)).toHaveText(SAVED);
    await second.reload();
    await expect(editorOf(second)).toHaveText("Tekst iz prve kartice, dopisan i nastavljen");
  });

  test("6: without IndexedDB the chip is an error and the editor stays read-only", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });
    });
    await page.goto("/rad");
    await expect(chipOf(page)).toHaveText(ERROR);
    await expect(noticeOf(page)).toHaveText(
      "Spremanje na ovom uređaju nije dostupno. Izvezi tekst da ga ne izgubiš.",
    );
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "false");
    await axe(page);
  });

  test("5: a full device is an error that stays while typing on, with an export", async ({ page }) => {
    await page.addInitScript(() => {
      const refuse = function (this: IDBObjectStore): IDBRequest {
        throw new DOMException("Made-up full device", "QuotaExceededError");
      };
      (window as unknown as { __ductusFull: () => void }).__ductusFull = () => {
        IDBObjectStore.prototype.put = refuse;
        IDBObjectStore.prototype.add = refuse;
      };
    });
    await openEditor(page);
    await page.evaluate(() => (window as unknown as { __ductusFull: () => void }).__ductusFull());
    await typeInto(page, "Tekst koji ne stane");
    await expect(chipOf(page)).toHaveText(ERROR);
    const alert = "Na uređaju nema dovoljno prostora, pa se promjene više ne spremaju. Izvezi tekst da ga ne izgubiš.";
    await expect(noticeOf(page)).toHaveText(alert);

    await page.keyboard.type(" i dalje");
    await expect(noticeOf(page)).toHaveText(alert);
    await expect(chipOf(page)).not.toHaveText(SAVED);
    await axe(page);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Izvezi tekst" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("ductus-rad.txt");
    const path = await file.path();
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(path, "utf8")).toBe("Tekst koji ne stane i dalje");
  });

  test("11: pasted rich HTML is reduced to the schema and gets fresh, unique ids", async ({ page }) => {
    await openEditor(page);
    await editorOf(page).click();
    await page.evaluate(() => {
      const html = [
        '<h1 data-node-id="evil">Izmišljeni naslov</h1>',
        '<p data-node-id="11111111-1111-4111-8111-111111111111">Prvi <b>podebljani</b> odlomak</p>',
        '<p data-node-id="11111111-1111-4111-8111-111111111111">Duplikat id-ja</p>',
        "<h4>Duboki naslov</h4>",
        "<ul><li>stavka jedan</li><li>stavka dva</li></ul>",
        "<table><tr><td>ćelija</td></tr></table>",
        '<img src="data:image/png;base64,AAAA" alt="slika">',
        "<script>window.__pasted = true</script>",
      ].join("");
      const data = new DataTransfer();
      data.setData("text/html", html);
      data.setData("text/plain", "Izmišljeni naslov");
      const target = document.querySelector('[role="textbox"]')!;
      const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      // Firefox hands an untrusted paste event no clipboard data; the same
      // ProseMirror paste pipeline (transformPasted included) then runs directly.
      if (!event.clipboardData?.getData("text/html")) {
        (target as unknown as { editor: { view: { pasteHTML(html: string): boolean } } }).editor.view.pasteHTML(html);
      }
    });
    await expect(chipOf(page)).toHaveText(SAVED);
    expect(await page.evaluate(() => (window as unknown as { __pasted?: boolean }).__pasted)).toBeUndefined();
    await expect(editorOf(page).locator("script, img, table")).toHaveCount(0);

    const ids = await editorOf(page).locator(":scope > [data-node-id]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-node-id")));
    expect(ids.length).toBeGreaterThan(3);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(NODE_ID);
      expect(id).not.toBe("11111111-1111-4111-8111-111111111111");
    }
    const text = await editorOf(page).innerText();
    expect(text).toContain("Izmišljeni naslov");
    expect(text).toContain("stavka dva");
    expect(text).toContain("ćelija");

    await page.reload();
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    expect(await editorOf(page).innerText()).toBe(text);
    const reloaded = await editorOf(page).locator(":scope > [data-node-id]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-node-id")));
    expect(reloaded).toEqual(ids);
  });

  test("10: pasted NUL and a lone surrogate never leave the chip saying saved over other text", async ({ page }) => {
    await openEditor(page);
    await editorOf(page).click();
    // A fresh document is not saved yet, so the chip below can only be the paste's.
    await expect(chipOf(page)).not.toHaveText(SAVED);
    await page.evaluate(() => {
      const text = "a\u0000b\uD800c";
      const data = new DataTransfer();
      data.setData("text/plain", text);
      const target = document.querySelector('[role="textbox"]')!;
      const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      // Firefox hands an untrusted paste event no clipboard data (see test 11).
      if (!event.clipboardData?.getData("text/plain")) {
        (target as unknown as { editor: { view: { pasteText(text: string): boolean } } }).editor.view.pasteText(text);
      }
    });
    await expect(chipOf(page)).toHaveText(SAVED);
    const saved = await shownAndStored(page);
    expect(saved.shown).toEqual(["ab\uFFFDc"]);
    expect(saved.stored).toEqual(saved.shown);

    await page.reload();
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    expect((await shownAndStored(page)).shown).toEqual(saved.shown);
  });

  test("14: axe finds nothing on the ready editor with saved text", async ({ page }) => {
    await openEditor(page);
    await typeInto(page, "Pristupačan izmišljeni tekst");
    await expect(chipOf(page)).toHaveText(SAVED);
    await axe(page);
  });

  test("stored ids: a reload gives every block its stored id back, and a new block keeps the rest", async ({ page }) => {
    await openEditor(page);
    await typeInto(page, "Prvi izmišljeni odlomak");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Drugi odlomak, čćžšđ");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Treći odlomak");
    await expect(chipOf(page)).toHaveText(SAVED);
    const ids = await blockIds(page);
    expect(ids).toHaveLength(3);
    expect(await storedIds(page, null)).toEqual(ids);

    for (let round = 0; round < 2; round++) {
      await page.reload();
      await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
      await expect(chipOf(page)).toHaveText(SAVED);
      expect(await blockIds(page)).toEqual(ids);
    }

    await editorOf(page).locator(":scope > p").last().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Četvrti odlomak");
    await expect(chipOf(page)).toHaveText(SAVED);
    const grown = await blockIds(page);
    expect(grown.slice(0, 3)).toEqual(ids);
    expect(grown).toHaveLength(4);
    await page.reload();
    await expect(chipOf(page)).toHaveText(SAVED);
    expect(await blockIds(page)).toEqual(grown);
    expect(await storedIds(page, null)).toEqual(grown);
  });

  for (const repeat of ["same", "upper"] as const) {
    test(`stored ids: a stored document repeating an id (${repeat} case) is refused, never repaired`, async ({ page }) => {
      await openEditor(page);
      await typeInto(page, "Prvi izmišljeni odlomak");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Drugi izmišljeni odlomak");
      await expect(chipOf(page)).toHaveText(SAVED);
      const tampered = await storedIds(page, repeat);
      expect(tampered[1]!.toLowerCase()).toBe(tampered[0]!.toLowerCase());

      await page.reload();
      await expect(noticeOf(page)).toContainText("Lokalni zapis nije moguće pouzdano pročitati.");
      await expect(editorOf(page)).toHaveAttribute("contenteditable", "false");
      await expect(editorOf(page)).toHaveAttribute("aria-readonly", "true");
      await expect(chipOf(page)).not.toHaveText(SAVED);
      // No block shows the repeated id under a new one: nothing was loaded.
      expect(await blockIds(page)).not.toContain(tampered[1]);
      await editorOf(page).click({ force: true });
      await page.keyboard.type("Ne smije ući");
      await expect(editorOf(page)).not.toContainText("Ne smije ući");
      // The journal keeps exactly what it held: refused, not repaired.
      expect(await storedIds(page, null)).toEqual(tampered);
    });
  }
});
