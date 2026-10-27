import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Writing on /rad without a network (F-8, DAN-211; PLAN-DEMO F-8 E2E: network
 * cut, writing goes on, nothing is lost). Every test starts with a fresh
 * browser context, so an empty journal. Only made-up text is typed.
 *
 * The server is not part of saving yet (F-3 3c waits for B-8), so these tests
 * prove the device side: the text keeps reaching the journal offline, the
 * page says it has no network, and nothing ever claims the server has it.
 */

const DURABLE = "Spremljeno na uređaju";
const OFFLINE_SAVING = "Bez mreže. Tekst se i dalje sprema na ovom uređaju.";
const QUOTA = "Na uređaju nema dovoljno prostora, pa se promjene više ne spremaju. Izvezite tekst da ga ne izgubite.";
const FIRST = "Prvi odlomak izmišljenog rada, napisan s mrežom.";
const SECOND = "Drugi odlomak, napisan bez mreže.";

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Tekst rada" });
const chipOf = (page: Page) => page.locator(".workspace__status .sync-chip");
const bannerOf = (page: Page) => page.locator(".offline-banner[role=status]");
const offlineChipOf = (page: Page) => page.locator(".workspace__status .offline-chip");

/** The text of every block the journal stores for the only document. */
function stored(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
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
      return row ? row.document.nodes.map((node) => node.children.map((c) => c.text).join("")) : [];
    }
    return [];
  });
}

/** Records every text the save chip shows from the first render on. */
async function chipHistory(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { __ductusChip: seen });
    new MutationObserver(() => {
      const text = document.querySelector(".workspace__status .sync-chip")?.textContent ?? null;
      if (text !== null && text !== seen[seen.length - 1]) seen.push(text);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  return () => page.evaluate(() => [...(window as unknown as { __ductusChip: string[] }).__ductusChip]);
}

async function openEditor(page: Page): Promise<void> {
  await page.goto("/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
}

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe("writing without a network (F-8)", () => {
  test("network cut: writing goes on, the page says so, nothing is lost", async ({ page, context }, testInfo) => {
    const history = await chipHistory(page);
    await openEditor(page);
    await editorOf(page).click();
    await page.keyboard.type(FIRST);
    await expect.poll(() => stored(page)).toEqual([FIRST]);
    await expect(chipOf(page)).toHaveText(DURABLE);
    // Online: the live region is there, empty, and there is no offline mark.
    await expect(bannerOf(page)).toHaveText("");
    await expect(offlineChipOf(page)).toHaveCount(0);

    await context.setOffline(true);
    await expect(bannerOf(page)).toHaveText(OFFLINE_SAVING);
    await expect(offlineChipOf(page)).toHaveText("Bez mreže");
    await expect(offlineChipOf(page).locator("svg")).toHaveAttribute("aria-hidden", "true");

    // Writing goes on: the editor stays writable and every save reaches the device.
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    await page.keyboard.press("Enter");
    await page.keyboard.type(SECOND);
    await expect.poll(() => stored(page)).toEqual([FIRST, SECOND]);
    await expect(chipOf(page)).toHaveText(DURABLE);
    await expect(bannerOf(page)).toHaveText(OFFLINE_SAVING);
    await axe(page);
    await testInfo.attach(`${testInfo.project.name}-workspace-offline.png`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    // The network comes back: the offline notice goes, the text stays.
    await context.setOffline(false);
    await expect(bannerOf(page)).toHaveText("");
    await expect(offlineChipOf(page)).toHaveCount(0);
    await expect(chipOf(page)).toHaveText(DURABLE);

    // Nothing is lost: a reload brings back both paragraphs from the journal.
    await page.reload();
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
    await expect(editorOf(page).locator("p")).toHaveText([FIRST, SECOND]);
    expect(await stored(page)).toEqual([FIRST, SECOND]);

    // Nothing reaches the server yet, so the chip never claimed it did.
    expect((await history()).filter((text) => text.includes("poslužitelju"))).toEqual([]);
  });

  test("offline while the device refuses to save: the banner does not say the text is saved", async ({ page, context }) => {
    // Every IndexedDB write fails, as on a full device, once the test says so.
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
    await openEditor(page);
    await context.setOffline(true);
    await expect(bannerOf(page)).toHaveText(OFFLINE_SAVING);

    await page.evaluate(() => (window as unknown as { __ductusFill: () => void }).__ductusFill());
    await editorOf(page).click();
    await page.keyboard.type(FIRST);
    await expect(page.locator(".editor-notice[role=alert]")).toHaveText(QUOTA);
    await expect(chipOf(page)).toHaveText("Greška");
    // The banner says only what is true: there is no network.
    await expect(bannerOf(page)).toHaveText("Bez mreže.");
    await expect(offlineChipOf(page)).toHaveText("Bez mreže");
  });
});
