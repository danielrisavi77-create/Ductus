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
      target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
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

  test("14: axe finds nothing on the ready editor with saved text", async ({ page }) => {
    await openEditor(page);
    await typeInto(page, "Pristupačan izmišljeni tekst");
    await expect(chipOf(page)).toHaveText(SAVED);
    await axe(page);
  });
});
