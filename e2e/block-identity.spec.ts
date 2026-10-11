import { expect, test, type Page } from "@playwright/test";

import { blocksOf, openIdentityHarness, prepareIdentityHarness, withClipboard } from "./support/identity-harness";
import type { HarnessBlock } from "./support/identity-harness.entry";

/**
 * Block identity on the input paths that exist only in a browser: the
 * clipboard (keyboard copy, cut and paste), content copied from outside the
 * editor, drop, drag inside the editor, typing, and a page script touching the
 * DOM. Runs in every project, so in Chromium, Firefox and WebKit.
 *
 * The editor is the application's own (`createEditorExtensions`) on a bare
 * harness page. Only made-up text is used.
 *
 * What is a real user gesture and what is not:
 * - copy, cut, typing, Enter, Backspace and undo are real key presses;
 * - paste is a real key press, except in WebKit for content copied inside the
 *   editor (see `pasteEditorCopy`);
 * - drop and drag are events dispatched by the test into the editor's own
 *   handlers; the pointer gesture itself is not performed.
 */

const A = { id: "aaaaaaaa-0000-4000-8000-00000000000a", type: "paragraph", text: "Prvi blok." };
const B = { id: "bbbbbbbb-0000-4000-8000-00000000000b", type: "paragraph", text: "Drugi blok s napomenom." };
const C = { id: "cccccccc-0000-4000-8000-00000000000c", type: "paragraph", text: "Treći blok." };
const OUTSIDE_ID = "dddddddd-0000-4000-8000-00000000000d";
const MINTED = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KNOWN = [A.id, B.id, C.id, OUTSIDE_ID];

const SEED = {
  type: "doc",
  content: [A, B, C].map((block) => ({
    type: block.type,
    attrs: { nodeId: block.id },
    content: [{ type: "text", text: block.text }],
  })),
};

const editorOf = (page: Page) => page.locator("#editor .ProseMirror");

function expectNew(ids: string[]): void {
  for (const id of ids) {
    expect(id).toMatch(MINTED);
    expect(KNOWN).not.toContain(id);
  }
}

/** Every original still holds its id on its own text; returns the other blocks, which must all be new. */
function expectOriginalsKept(blocks: HarnessBlock[]): HarnessBlock[] {
  for (const original of [A, B, C]) {
    const holders = blocks.filter((block) => block.id === original.id);
    expect(holders).toHaveLength(1);
    expect(holders[0].text).toContain(original.text);
  }
  const others = blocks.filter((block) => !KNOWN.includes(block.id));
  expect(others).toHaveLength(blocks.length - 3);
  expectNew(others.map((block) => block.id));
  return others;
}

async function caret(page: Page, at: number | "start" | "end"): Promise<void> {
  await page.evaluate((where) => window.__identity!.caret(where), at);
}

async function selectBlock(page: Page, index: number): Promise<void> {
  await page.evaluate((i) => window.__identity!.selectBlock(i), index);
}

async function contentStart(page: Page, index: number): Promise<number> {
  return page.evaluate((i) => window.__identity!.contentStart(i), index);
}

/** Copies HTML from outside the editor with the keyboard, as from another page. */
async function copyFromOutside(page: Page, html: string): Promise<void> {
  await page.evaluate((markup) => {
    const source = document.querySelector<HTMLElement>("#source")!;
    source.innerHTML = markup;
    source.focus();
    getSelection()!.selectAllChildren(source);
  }, html);
  await page.keyboard.press("ControlOrMeta+c");
}

/** Ctrl+A, Ctrl+C in the editor; the copied HTML carries the id of every block. */
async function copyWholeDocument(page: Page): Promise<void> {
  await editorOf(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  const html = await page.evaluate(() => window.__identity!.copied.html);
  for (const block of [A, B, C]) {
    expect(html).toContain(`data-node-id="${block.id}"`);
  }
}

/**
 * Pastes what was copied or cut inside the editor. A real Ctrl+V in Chromium
 * and Firefox. The WebKit build Playwright ships does not keep what a page
 * writes to the clipboard in its own copy handler, so there the paste event is
 * dispatched by the test with exactly the data the editor's copy handler
 * produced; the editor's paste handling is the same code either way.
 */
async function pasteEditorCopy(page: Page, browserName: string): Promise<void> {
  if (browserName === "webkit") {
    await page.evaluate(() => window.__identity!.pasteCopied());
  } else {
    await page.keyboard.press("ControlOrMeta+v");
  }
}

/** The blocks once the document has `count` of them. */
async function blocksWhen(page: Page, count: number) {
  await expect.poll(async () => (await blocksOf(page)).length).toBe(count);
  return blocksOf(page);
}

test.describe("block identity in the browser", () => {
  // Playwright requires the first argument to be a destructuring pattern.
  test.beforeAll(async ({}, testInfo) => {
    // Bundling the harness is not part of any test's time.
    testInfo.setTimeout(180_000);
    await prepareIdentityHarness(testInfo.project.outputDir);
  });

  test.beforeEach(async ({ context, browserName }) => {
    if (browserName === "chromium") {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    }
  });

  for (const where of ["start", "end"] as const) {
    test(`the whole document copied and pasted at the ${where}: the originals keep their ids`, async ({ page, browserName }) => {
      await openIdentityHarness(page, SEED);
      await withClipboard(async () => {
        await copyWholeDocument(page);
        await caret(page, where);
        await pasteEditorCopy(page, browserName);
      });

      await expect(editorOf(page).locator("p")).not.toHaveCount(3);
      const blocks = await blocksOf(page);
      expectOriginalsKept(blocks);
      // The ids did not move to the pasted text at the other end of the document.
      const first = where === "start" ? blocks.length - 3 : 0;
      expect(blocks.slice(first, first + 3).map((block) => block.id)).toEqual([A.id, B.id, C.id]);

      await page.keyboard.press("ControlOrMeta+z");
      expect(await blocksWhen(page, 3)).toEqual([A, B, C]);
    });
  }

  test("the whole document copied and pasted inside a block: the id stays before the insertion", async ({ page, browserName }) => {
    await openIdentityHarness(page, SEED);
    await withClipboard(async () => {
      await copyWholeDocument(page);
      await caret(page, (await contentStart(page, 1)) + 5);
      await pasteEditorCopy(page, browserName);
    });

    await expect(editorOf(page).locator("p")).not.toHaveCount(3);
    const blocks = await blocksOf(page);
    expect(blocks[0]).toEqual(A);
    expect(blocks.at(-1)).toEqual(C);
    const holders = blocks.filter((block) => block.id === B.id);
    expect(holders).toHaveLength(1);
    expect(holders[0].text.startsWith(B.text.slice(0, 5))).toBe(true);
    expectNew(blocks.slice(1, -1).filter((block) => block.id !== B.id).map((block) => block.id));
  });

  test("content copied from outside and pasted in front of a block's text never brings its id attribute: in use, unknown, other spelling, malformed, repeated", async ({ page }) => {
    await openIdentityHarness(page, SEED);
    const outside = [B.id, OUTSIDE_ID, B.id.toUpperCase(), ` ${B.id} `, "not-a-uuid", "", "a".repeat(10_000), OUTSIDE_ID];
    const html = outside.map((id, i) => `<p data-node-id="${id}">Izvana ${i}.</p>`).join("");
    await withClipboard(async () => {
      await copyFromOutside(page, html);
      await caret(page, await contentStart(page, 1));
      await page.keyboard.press("ControlOrMeta+v");
    });

    await expect(editorOf(page)).toContainText("Izvana 7.");
    const others = expectOriginalsKept(await blocksOf(page));
    expect(others.map((block) => block.text).join("")).toContain("Izvana 0.");
    expect(others.length).toBeGreaterThanOrEqual(7);
  });

  test("content pasted over a selected block does not inherit that block's id", async ({ page }) => {
    await openIdentityHarness(page, SEED);
    await withClipboard(async () => {
      await copyFromOutside(page, `<p data-node-id="${B.id}">Zamjenski tekst.</p>`);
      await selectBlock(page, 1);
      await page.keyboard.press("ControlOrMeta+v");
    });

    await expect(editorOf(page)).toContainText("Zamjenski tekst.");
    const blocks = await blocksOf(page);
    expect(blocks.map((block) => block.text)).toEqual([A.text, "Zamjenski tekst.", C.text]);
    expect([blocks[0], blocks[2]]).toEqual([A, C]);
    expectNew([blocks[1].id]);

    await page.keyboard.press("ControlOrMeta+z");
    await expect(editorOf(page)).not.toContainText("Zamjenski tekst.");
    expect(await blocksOf(page)).toEqual([A, B, C]);
  });

  test("a block cut and pasted elsewhere is a new block; undo brings the original back with its id", async ({ page, browserName }) => {
    await openIdentityHarness(page, SEED);
    await withClipboard(async () => {
      await selectBlock(page, 1);
      await page.keyboard.press("ControlOrMeta+x");
      expect(await blocksWhen(page, 2)).toEqual([A, C]);
      expect(await page.evaluate(() => window.__identity!.copied.html)).toContain(`data-node-id="${B.id}"`);

      await caret(page, "end");
      await pasteEditorCopy(page, browserName);
    });

    await expect(editorOf(page)).toContainText(B.text);
    const blocks = await blocksOf(page);
    expect(blocks.slice(0, 2)).toEqual([A, C]);
    const pasted = blocks.filter((block) => block.text.includes(B.text));
    expect(pasted).toHaveLength(1);
    expectNew([pasted[0].id]);

    await page.keyboard.press("ControlOrMeta+z");
    await page.keyboard.press("ControlOrMeta+z");
    expect(await blocksWhen(page, 3)).toEqual([A, B, C]);
  });

  test("content dropped from outside never brings its id attribute", async ({ page }) => {
    await openIdentityHarness(page, SEED);
    await page.evaluate(
      ({ id }) => {
        const paragraphs = document.querySelectorAll("#editor .ProseMirror p");
        const box = paragraphs[paragraphs.length - 1]!.getBoundingClientRect();
        const data = new DataTransfer();
        data.setData("text/html", `<p data-node-id="${id}">Ispušteni tekst.</p><p data-node-id="${id}">I još jedan.</p>`);
        data.setData("text/plain", "Ispušteni tekst.");
        // Below the last block, inside the editor.
        document.querySelector("#editor .ProseMirror")!.dispatchEvent(
          new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true, clientX: box.left + 4, clientY: box.bottom + 40 }),
        );
      },
      { id: B.id },
    );

    await expect(editorOf(page)).toContainText("I još jedan.");
    const others = expectOriginalsKept(await blocksOf(page));
    expect(others.map((block) => block.text).join("")).toContain("I još jedan.");
  });

  for (const copy of [false, true]) {
    const title = copy
      ? "a block dragged as a copy inside the editor: the original keeps its id and the copy is new"
      : "a block dragged to another place inside the editor keeps its id";
    test(title, async ({ page }) => {
      await openIdentityHarness(page, SEED);
      await selectBlock(page, 1);
      await page.evaluate((asCopy) => {
        const paragraphs = document.querySelectorAll("#editor .ProseMirror p");
        const from = paragraphs[1]!.getBoundingClientRect();
        const to = paragraphs[2]!.getBoundingClientRect();
        const data = new DataTransfer();
        const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? { altKey: asCopy } : { ctrlKey: asCopy };
        const init = { dataTransfer: data, bubbles: true, cancelable: true, ...modifier };
        paragraphs[1]!.dispatchEvent(new DragEvent("dragstart", { ...init, clientX: from.left + 10, clientY: from.top + 6 }));
        paragraphs[2]!.dispatchEvent(new DragEvent("drop", { ...init, clientX: to.right - 2, clientY: to.bottom - 3 }));
        paragraphs[1]!.dispatchEvent(new DragEvent("dragend", init));
      }, copy);

      if (copy) {
        const blocks = await blocksWhen(page, 4);
        expect(blocks.slice(0, 3)).toEqual([A, B, C]);
        expect(blocks[3].text).toBe(B.text);
        expectNew([blocks[3].id]);
      } else {
        await expect.poll(async () => (await blocksOf(page)).map((block) => block.id)).toEqual([A.id, C.id, B.id]);
        expect(await blocksOf(page)).toEqual([A, C, B]);
      }
    });
  }

  test("typing in an empty editor: the block has its id before the first key, Enter makes a new one, Backspace joins into the first", async ({ page }) => {
    await openIdentityHarness(page);
    const [empty] = await blocksOf(page);
    expectNew([empty.id]);
    expect((await blocksOf(page))[0].id).toBe(empty.id);

    await editorOf(page).click();
    await page.keyboard.type("Prva rečenica.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Druga.");
    const [first, second] = await blocksWhen(page, 2);
    expect(first).toEqual({ id: empty.id, type: "paragraph", text: "Prva rečenica." });
    expect(second.text).toBe("Druga.");
    expectNew([second.id]);
    expect(second.id).not.toBe(first.id);

    await caret(page, await contentStart(page, 1));
    await page.keyboard.press("Backspace");
    expect(await blocksWhen(page, 1)).toEqual([{ id: empty.id, type: "paragraph", text: "Prva rečenica.Druga." }]);

    await page.keyboard.press("ControlOrMeta+z");
    expect((await blocksWhen(page, 2)).map((block) => block.id)).toEqual([first.id, second.id]);
  });

  for (const [name, twin] of [["exactly", A.id], ["in another letter case", A.id.toUpperCase()]] as const) {
    test(`initial content that holds an id twice, ${name}: repaired when the editor is created, and it says so`, async ({ page }) => {
      const warnings: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "warning") {
          warnings.push(message.text());
        }
      });
      const seed = structuredClone(SEED);
      seed.content[1].attrs.nodeId = twin;
      await openIdentityHarness(page, seed);

      const attributes = await editorOf(page).locator("[data-node-id]").evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-node-id")!),
      );
      expect([attributes[0], attributes[2]]).toEqual([A.id, C.id]);
      expectNew([attributes[1]]);
      expect((await blocksOf(page)).map((block) => block.id)).toEqual(attributes);
      await expect.poll(() => warnings.filter((text) => text.includes("replaceWithStoredDocument")).length).toBe(1);
    });
  }

  test("content without a repeated id raises no warning when the editor is created", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning") {
        warnings.push(message.text());
      }
    });
    await openIdentityHarness(page, SEED);

    expect((await blocksOf(page)).map((block) => block.id)).toEqual([A.id, B.id, C.id]);
    expect(warnings.filter((text) => text.includes("replaceWithStoredDocument"))).toEqual([]);
  });

  test("Enter at the very start of a block leaves its id with its text", async ({ page }) => {
    await openIdentityHarness(page, SEED);
    await caret(page, await contentStart(page, 1));
    await page.keyboard.press("Enter");

    const blocks = await blocksWhen(page, 4);
    expect(blocks.map((block) => block.text)).toEqual([A.text, "", B.text, C.text]);
    expect([blocks[0], blocks[2], blocks[3]]).toEqual([A, B, C]);
    expectNew([blocks[1].id]);
  });

  test("an id attribute rewritten in the page does not change which block holds which id", async ({ page }) => {
    await openIdentityHarness(page, SEED);
    for (const value of [A.id, OUTSIDE_ID, "x"]) {
      await page.evaluate((id) => {
        document.querySelectorAll("#editor .ProseMirror p")[1]!.setAttribute("data-node-id", id);
      }, value);
      await expect(editorOf(page).locator("p").nth(1)).toHaveAttribute("data-node-id", B.id);
      expect(await blocksOf(page)).toEqual([A, B, C]);
    }
  });
});
