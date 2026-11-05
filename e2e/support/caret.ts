import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Puts the caret at the end of the editor's last block, where a writer continues the text, and
 * returns only once the editor still holds it there.
 *
 * A click and Control+End right after a load left the caret at the end of the citation
 * paragraph (DAN-348 N5), so the DOM selection is set directly, as a mouse selection would be.
 * That alone is not enough on the first focus after a load: ProseMirror (prosemirror-view
 * `handlers.focus`) writes its own selection back to the DOM 20 ms after focus, and a
 * transaction can do the same before it has read the pending `selectionchange`. A caret set
 * in that window is lost and the typed text lands where the click was (#936, run 41474947760).
 * The selection is therefore set, left to settle past that window, checked and set again
 * until it holds.
 */
export async function caretAtEnd(page: Page, editor: Locator): Promise<void> {
  await editor.click();
  await expect(async () => {
    const atEnd = await editor.evaluate(async (element) => {
      const last = element.lastElementChild;
      if (last === null) return false;
      const range = document.createRange();
      range.selectNodeContents(last);
      range.collapse(false);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const settled = window.getSelection()!;
      if (!settled.isCollapsed || settled.focusNode === null || !last.contains(settled.focusNode)) {
        return false;
      }
      const rest = document.createRange();
      rest.setStart(settled.focusNode, settled.focusOffset);
      rest.setEnd(last, last.childNodes.length);
      return rest.toString() === "";
    });
    expect(atEnd, "caret at the end of the last block").toBe(true);
  }).toPass({ timeout: 5_000 });
  await page.keyboard.press("End");
}
