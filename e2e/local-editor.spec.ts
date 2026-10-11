import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The local editor on /rad (F-3 step 1b, plan #197). Playwright gives every
 * test a fresh browser context, so every test starts with an empty IndexedDB.
 * Only made-up text is typed or pasted.
 */

const NODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BLOCKED = "Ova kartica ništa ne sprema dok je druga otvorena.";
const QUOTA = "Na uređaju nema dovoljno prostora, pa se promjene više ne spremaju. Izvezi tekst da ga ne izgubiš.";
const STALE = "Dokument je u međuvremenu promijenjen na drugom mjestu, pa ova kartica više ne sprema. Izvezi tekst, zatim ponovno učitaj stranicu.";
const editorOf = (page: Page) => page.getByRole("textbox", { name: "Tekst rada" });
/** The provider's phase, for states whose notice is not the point of the test. */
const phaseOf = (page: Page) => page.locator(".editor-surface");
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
      return { shown, stored: row ? row.document.nodes.map((node) => node.children.map((c) => c.text).join("")) : [] };
    }
    return { shown, stored: [] };
  });
}

/**
 * Waits until the journal stores exactly the text the editor shows. The save
 * chip is step 1b-3, so this reads the journal itself, not what the UI claims.
 */
async function journalled(page: Page): Promise<void> {
  await expect.poll(async () => {
    const { shown, stored } = await shownAndStored(page);
    return JSON.stringify(shown) === JSON.stringify(stored);
  }).toBe(true);
}

/**
 * Lets a test fill the device and free it again: while full, every IndexedDB
 * write fails as a browser over its quota fails it.
 */
async function deviceSpace(page: Page): Promise<{ fill(): Promise<void>; free(): Promise<void> }> {
  await page.addInitScript(() => {
    const { put, add } = IDBObjectStore.prototype;
    const refuse = function (this: IDBObjectStore): IDBRequest {
      throw new DOMException("Made-up full device", "QuotaExceededError");
    };
    Object.assign(window, {
      __ductusFill: () => Object.assign(IDBObjectStore.prototype, { put: refuse, add: refuse }),
      __ductusFree: () => Object.assign(IDBObjectStore.prototype, { put, add }),
    });
  });
  const call = (name: string) => async () => {
    await page.evaluate((name) => (window as unknown as Record<string, () => void>)[name]!(), name);
  };
  return { fill: call("__ductusFill"), free: call("__ductusFree") };
}

/** The text the export button gives, read from the downloaded file. */
async function exported(page: Page): Promise<string> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Izvezi tekst" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("ductus-rad.txt");
  const { readFile } = await import("node:fs/promises");
  return readFile(await file.path(), "utf8");
}

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe("local editor (#197)", () => {
  test("reload: saved text and word count come back", async ({ page }) => {
    await openEditor(page);
    await typeInto(page, "Prva rečenica izmišljenog rada.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Drugi odlomak.");
    await journalled(page);
    await expect(page.getByText("6 riječi")).toBeVisible();

    await page.reload();
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    await expect(editorOf(page).locator("p")).toHaveText(["Prva rečenica izmišljenog rada.", "Drugi odlomak."]);
    await journalled(page);
    await expect(page.getByText("6 riječi")).toBeVisible();
  });

  // A browser may end the page before the pagehide flush commits, so what is
  // guaranteed is the text up to the last save; at most the debounce window
  // after it can be lost, and a commit is whole or absent, never a part.
  test("1: a reload right after typing keeps everything up to the last save", async ({ page }) => {
    await openEditor(page);
    await typeInto(page, "Spremljeni dio");
    await journalled(page);
    await page.keyboard.type(" i zadnja misao");
    await page.reload();
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    const text = await editorOf(page).innerText();
    expect(["Spremljeni dio", "Spremljeni dio i zadnja misao"]).toContain(text.trim());
    // What is shown after the reload is the journal's text, nothing else.
    expect((await shownAndStored(page)).stored).toEqual([text.trim()]);
  });

  test("4: a second tab is read-only and blocked, and takes over once the first closes", async ({ page, context }) => {
    await openEditor(page);
    await typeInto(page, "Tekst iz prve kartice");
    await journalled(page);

    const second = await context.newPage();
    await second.goto("/rad");
    await expect(phaseOf(second)).toHaveAttribute("data-phase", "blocked");
    await expect(second.getByText(BLOCKED, { exact: false })).toBeVisible();
    await expect(editorOf(second)).toHaveAttribute("contenteditable", "false");
    // Nothing is loaded before the lock: the blocked tab shows no text at all.
    await expect(editorOf(second)).toHaveText("");
    await expect(editorOf(second)).toHaveAttribute("aria-readonly", "true");
    await axe(second);

    await typeInto(page, ", dopisan");
    await journalled(page);
    await page.close();

    // The journal is read again, so the text written after the second tab opened is there.
    await expect(editorOf(second)).toHaveAttribute("contenteditable", "true");
    await expect(editorOf(second)).toHaveText("Tekst iz prve kartice, dopisan");
    await expect(phaseOf(second)).toHaveAttribute("data-phase", "ready");
    await expect(second.getByText(BLOCKED, { exact: false })).toHaveCount(0);
    await typeInto(second, " i nastavljen");
    await journalled(second);
    await second.reload();
    await expect(editorOf(second)).toHaveText("Tekst iz prve kartice, dopisan i nastavljen");
  });

  test("6: without IndexedDB the author is told and the editor stays read-only", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });
    });
    await page.goto("/rad");
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "unavailable");
    await expect(noticeOf(page)).toHaveText(
      "Spremanje na ovom uređaju nije dostupno. Izvezi tekst da ga ne izgubiš.",
    );
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "false");
    await axe(page);
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
    await journalled(page);
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

  test("10: pasted NUL and a lone surrogate are shown as the journal stores them", async ({ page }) => {
    await openEditor(page);
    await editorOf(page).click();
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
    await journalled(page);
    const saved = await shownAndStored(page);
    expect(saved.shown).toEqual(["ab\uFFFDc"]);
    expect(saved.stored).toEqual(saved.shown);

    await page.reload();
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    expect((await shownAndStored(page)).shown).toEqual(saved.shown);
  });

  test("10: typing after a repaired paste mid-text lands right after the paste", async ({ page }) => {
    await openEditor(page);
    await typeInto(page, "prijeposlije");
    await expect(editorOf(page)).toHaveText("prijeposlije");
    await page.evaluate(() => {
      const target = document.querySelector('[role="textbox"]')!;
      const { editor } = target as unknown as {
        editor: { commands: { setTextSelection(pos: number): boolean }; view: { pasteText(text: string): boolean } };
      };
      // Position 6 is after "prije": the paragraph opens at 0, its text at 1.
      editor.commands.setTextSelection(6);
      editor.view.pasteText(" a\u0000\uD800 ");
    });
    await page.keyboard.type("X");
    await expect(editorOf(page)).toHaveText("prije a\uFFFD Xposlije");
  });

  test("5: a full device is an error that stays while typing on, with an export", async ({ page }) => {
    const device = await deviceSpace(page);
    await openEditor(page);
    await device.fill();
    await typeInto(page, "Tekst koji ne stane");
    await expect(noticeOf(page)).toHaveText(QUOTA);

    await page.keyboard.type(" i dalje");
    await expect(noticeOf(page)).toHaveText(QUOTA);
    await axe(page);
    expect(await exported(page)).toBe("Tekst koji ne stane i dalje");
  });

  test("5: once the device has room again, the next save lifts the error and keeps all the text", async ({ page }) => {
    const device = await deviceSpace(page);
    await openEditor(page);
    await device.fill();
    await typeInto(page, "Napisano bez prostora");
    await expect(noticeOf(page)).toHaveText(QUOTA);

    await device.free();
    await page.keyboard.type(" i nakon");
    await expect(noticeOf(page)).toBeEmpty();
    await expect(page.getByRole("button", { name: "Izvezi tekst" })).toHaveCount(0);
    await journalled(page);

    await page.reload();
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    await expect(editorOf(page)).toHaveText("Napisano bez prostora i nakon");
    await expect(noticeOf(page)).toBeEmpty();
  });

  test("the export keeps every paragraph, an empty one too, and the letters as typed", async ({ page }) => {
    const device = await deviceSpace(page);
    await openEditor(page);
    await device.fill();
    await typeInto(page, "Prvi čćžšđ");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Treći ŽĆ!");
    await expect(noticeOf(page)).toHaveText(QUOTA);
    expect(await exported(page)).toBe("Prvi čćžšđ\n\n\n\nTreći ŽĆ!");
  });

  test("a journal moved by another writer stops saving here for good, with an export of the shown text", async ({ page }) => {
    await openEditor(page);
    await typeInto(page, "Tekst ove kartice");
    await journalled(page);
    // Another writer: the stored sequence moves on behind this tab's back.
    await page.evaluate(async () => {
      const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      for (const { name } of await indexedDB.databases()) {
        const db = await request(indexedDB.open(name!));
        if (!db.objectStoreNames.contains("meta")) {
          db.close();
          continue;
        }
        const store = db.transaction("meta", "readwrite").objectStore("meta");
        const [row] = await request(store.getAll()) as { localSeq: number }[];
        row!.localSeq += 1;
        await request(store.put(row));
        db.close();
        return;
      }
      throw new Error("no journal database");
    });

    await page.keyboard.type(" i dalje");
    await expect(noticeOf(page)).toHaveText(STALE);
    await page.keyboard.type(" još");
    await expect(noticeOf(page)).toHaveText(STALE);
    await expect(editorOf(page)).toHaveText("Tekst ove kartice i dalje još");
    expect(await exported(page)).toBe("Tekst ove kartice i dalje još");
  });

  test("a refused wait for the lock tells the author instead of staying blocked", async ({ page }) => {
    await page.addInitScript(() => {
      const { locks } = navigator;
      const request = locks.request.bind(locks) as (...args: unknown[]) => Promise<unknown>;
      Object.defineProperty(locks, "request", {
        value: (name: string, options: { ifAvailable?: boolean }, callback: (lock: Lock | null) => unknown) =>
          options.ifAvailable
            ? request(name, options, () => callback(null))
            : Promise.reject(new DOMException("Made-up refusal", "InvalidStateError")),
      });
    });
    await page.goto("/rad");
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "unavailable");
    await expect(noticeOf(page)).toHaveText(
      "Spremanje na ovom uređaju nije dostupno. Izvezi tekst da ga ne izgubiš.",
    );
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "false");
  });

  test("keyboard focus on the editor is visible", async ({ page }) => {
    await openEditor(page);
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      if (await editorOf(page).evaluate((el) => el === document.activeElement)) break;
    }
    await expect(editorOf(page)).toBeFocused();
    const style = await editorOf(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return { visible: el.matches(":focus-visible"), outline: s.outlineStyle, width: s.outlineWidth };
    });
    expect(style).toEqual({ visible: true, outline: "solid", width: "2px" });
  });

  // Browsers match :focus-visible on a text field after a click as well; the
  // writer always sees where typing goes (app/globals.css).
  test("mouse focus on the editor is visible as well", async ({ page }) => {
    await openEditor(page);
    await editorOf(page).click();
    await expect(editorOf(page)).toBeFocused();
    const style = await editorOf(page).evaluate((el) => ({
      visible: el.matches(":focus-visible"),
      outline: getComputedStyle(el).outlineStyle,
    }));
    expect(style).toEqual({ visible: true, outline: "solid" });
  });

  test("14: axe finds nothing on the ready editor with saved text", async ({ page }) => {
    await openEditor(page);
    await typeInto(page, "Pristupačan izmišljeni tekst");
    await journalled(page);
    await axe(page);
  });

  test("stored ids: a reload gives every block its stored id back, and a new block keeps the rest", async ({ page }) => {
    await openEditor(page);
    await typeInto(page, "Prvi izmišljeni odlomak");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Drugi odlomak, čćžšđ");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Treći odlomak");
    await journalled(page);
    const ids = await blockIds(page);
    expect(ids).toHaveLength(3);
    expect(await storedIds(page, null)).toEqual(ids);

    for (let round = 0; round < 2; round++) {
      await page.reload();
      await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
      expect(await blockIds(page)).toEqual(ids);
    }

    await editorOf(page).locator(":scope > p").last().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Četvrti odlomak");
    await journalled(page);
    const grown = await blockIds(page);
    expect(grown.slice(0, 3)).toEqual(ids);
    expect(grown).toHaveLength(4);
    await page.reload();
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    expect(await blockIds(page)).toEqual(grown);
    expect(await storedIds(page, null)).toEqual(grown);
  });

  test("stored text the editor would change on entry is refused, never shown as loaded", async ({ page }) => {
    await openEditor(page);
    await typeInto(page, "Izmišljeni odlomak");
    await journalled(page);
    // A journal holding only a snapshot with a lone surrogate: valid to the
    // saver, but the editor would show U+FFFD instead of what is stored.
    await page.evaluate(async () => {
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
        const tx = db.transaction(["snapshots", "pending"], "readwrite");
        const snapshots = tx.objectStore("snapshots");
        const [row] = await request(snapshots.getAll()) as { document: { nodes: { children: { text: string }[] }[] } }[];
        row!.document.nodes[0]!.children[0]!.text = "a\uD800b";
        await request(snapshots.put(row));
        await request(tx.objectStore("pending").clear());
        db.close();
        return;
      }
      throw new Error("no journal database");
    });

    await page.reload();
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "recovery");
    await expect(noticeOf(page)).toContainText("Lokalni zapis nije moguće pouzdano pročitati.");
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "false");
    await expect(editorOf(page)).toHaveText("");
    expect((await shownAndStored(page)).stored).toEqual(["a\uD800b"]);
  });

  for (const repeat of ["same", "upper"] as const) {
    test(`stored ids: a stored document repeating an id (${repeat} case) is refused, never repaired`, async ({ page }) => {
      await openEditor(page);
      await typeInto(page, "Prvi izmišljeni odlomak");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Drugi izmišljeni odlomak");
      await journalled(page);
      const tampered = await storedIds(page, repeat);
      expect(tampered[1]!.toLowerCase()).toBe(tampered[0]!.toLowerCase());

      await page.reload();
      await expect(phaseOf(page)).toHaveAttribute("data-phase", "recovery");
      await expect(noticeOf(page)).toContainText("Lokalni zapis nije moguće pouzdano pročitati.");
      await expect(editorOf(page)).toHaveAttribute("contenteditable", "false");
      await expect(editorOf(page)).toHaveAttribute("aria-readonly", "true");
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
