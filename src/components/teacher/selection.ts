/**
 * The marked passage of the live view as block offsets (DAN-86 step 2c).
 * Browser only. A selection counts only when both ends lie in the same
 * block of the text (`[data-node-id]` inside `root`); offsets are the length
 * of the block's text before each end, the same text `blockText` builds.
 */
export function selectedRange(root: HTMLElement, selection: Selection | null):
  { nodeId: string; start: number; end: number } | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const block = (node: Node | null) =>
    (node instanceof Element ? node : node?.parentElement ?? null)?.closest<HTMLElement>("[data-node-id]") ?? null;
  const startBlock = block(range.startContainer);
  if (!startBlock || startBlock !== block(range.endContainer) || !root.contains(startBlock)) return null;
  const offset = (container: Node, at: number) => {
    const before = document.createRange();
    before.selectNodeContents(startBlock);
    before.setEnd(container, at);
    return before.toString().length;
  };
  const nodeId = startBlock.dataset.nodeId;
  if (!nodeId) return null;
  return { nodeId, start: offset(range.startContainer, range.startOffset), end: offset(range.endContainer, range.endOffset) };
}

/** Selects `start` to `end` of the block's text and brings it into view ("Pokaži u tekstu"). */
export function selectInBlock(root: HTMLElement, nodeId: string, start: number, end: number): boolean {
  const block = [...root.querySelectorAll<HTMLElement>("[data-node-id]")].find((el) => el.dataset.nodeId === nodeId);
  if (!block) return false;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let at = 0;
  let started = false;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const length = text.textContent?.length ?? 0;
    if (!started && start <= at + length) {
      range.setStart(text, start - at);
      started = true;
    }
    if (started && end <= at + length) {
      range.setEnd(text, end - at);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      block.scrollIntoView({ block: "center" });
      return true;
    }
    at += length;
  }
  return false;
}
