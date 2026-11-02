import { expect, test, type Page } from "@playwright/test";

import { installSourceHarness, openSourceHarness, prepareSourceHarness } from "./support/source-harness";

/**
 * M3.5-P01, D-54 spike (DAN-390, contract #1091 `issuecomment-6579115692`):
 * how the production `SourceObserver` labels typed, assistive and scripted
 * input in real engines. Labelling only: every path below reaches the
 * document, none is refused, and no label is shown or judged. A script never
 * earns `editor`, `keyless-input` or a clipboard source; it is `unattributed`.
 * Every text is invented.
 */

const ATTRIBUTED_BY_SCRIPT = ["editor", "keyless-input", "paste", "cut", "drop", "system-replacement"];

const sources = (page: Page) => page.evaluate(() => window.__source!.sources());
const text = (page: Page) => page.evaluate(() => window.__source!.text());

async function onlyUnattributed(page: Page) {
  const seen = await sources(page);
  expect(seen.length, "the scripted change reached the document as a change").toBeGreaterThan(0);
  expect(seen.filter((source) => ATTRIBUTED_BY_SCRIPT.includes(source))).toEqual([]);
  expect(new Set(seen)).toEqual(new Set(["unattributed"]));
}

test.describe("input origin (D-54)", () => {
  // Playwright requires the first argument to be a destructuring pattern.
  test.beforeAll(async ({}, testInfo) => {
    // Bundling the harness is not part of any test's time.
    testInfo.setTimeout(180_000);
    await prepareSourceHarness(testInfo.project.outputDir);
  });

  test.beforeEach(async ({ context, page }) => {
    await installSourceHarness(context);
    await openSourceHarness(page);
  });

  // The record of the spike (docs/spikes/M3.5-P01.md): per engine, which input
  // kinds arrived, with their trust, and which sources were recorded.
  test.afterEach(async ({ page }, testInfo) => {
    const record = await page.evaluate(() => ({ signals: window.__source!.signals(), sources: window.__source!.sources() }));
    testInfo.annotations.push({ type: "d54-record", description: JSON.stringify(record) });
  });

  test("keys typed on the keyboard are editor", async ({ page }) => {
    await page.keyboard.type("Sunce zalazi");
    expect(await text(page)).toBe("Sunce zalazi");
    expect(await sources(page)).toEqual(Array.from("Sunce zalazi", () => "editor"));
  });

  test("text that arrives without a key is keyless-input, not editor", async ({ page }) => {
    // What dictation, an on-screen keyboard or a switch device does: a
    // trusted insertion with no keydown behind it.
    await page.keyboard.insertText("rijeka teče");
    expect(await text(page)).toBe("rijeka teče");
    expect(new Set(await sources(page))).toEqual(new Set(["keyless-input"]));
  });

  test("execCommand from a script is unattributed and not refused", async ({ page }) => {
    await page.evaluate(() => document.execCommand("insertText", false, "oblak nad brdom"));
    expect(await text(page)).toBe("oblak nad brdom");
    await onlyUnattributed(page);
  });

  test("forged key and input events do not lend a source to a DOM change", async ({ page }) => {
    await page.evaluate(() => {
      const dom = document.querySelector("#editor .ProseMirror")!;
      dom.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
      dom.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "a", bubbles: true, cancelable: true }));
      const paragraph = dom.querySelector("p")!;
      paragraph.textContent = "a";
    });
    await expect.poll(() => text(page)).toBe("a");
    await onlyUnattributed(page);
  });

  test("a direct DOM change is unattributed and not refused", async ({ page }) => {
    await page.keyboard.type("Lipa");
    await page.evaluate(() => window.__source!.reset());
    await page.evaluate(() => {
      document.querySelector("#editor .ProseMirror p")!.textContent = "Lipa cvate";
    });
    await expect.poll(() => text(page)).toBe("Lipa cvate");
    await onlyUnattributed(page);
  });

  test("a change through the editor API is unattributed", async ({ page }) => {
    await page.evaluate(() => window.__source!.scripted("vjetar puše"));
    expect(await text(page)).toBe("vjetar puše");
    await onlyUnattributed(page);
  });

  test("a forged paste event is never a paste", async ({ page }) => {
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "kiša pada");
      const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      document.querySelector("#editor .ProseMirror")!.dispatchEvent(event);
    });
    // Whether an engine lets a forged paste carry its data differs; what it
    // must never be, if it lands, is a paste.
    const seen = await sources(page);
    expect(seen.filter((source) => source !== "unattributed")).toEqual([]);
  });
});
