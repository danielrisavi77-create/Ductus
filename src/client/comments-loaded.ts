/**
 * One page, two readers of the same comments: on /rad the student's comment
 * panel and the comment marks of the "Kako vidi nastavnik" view (#732 item 7)
 * each read GET /api/comments. When the panel reads them again (its refresh
 * button, a reply), the marks must follow, or the list and the text would
 * disagree. This is that signal, inside one tab only; it carries no comment
 * and nothing leaves the page.
 */

const bus = new EventTarget();
const LOADED = "loaded";

/** The panel has read the comments of `documentId` again. */
export function announceCommentsLoaded(documentId: string): void {
  bus.dispatchEvent(new CustomEvent<string>(LOADED, { detail: documentId }));
}

/** Calls `listener` after every announcement for `documentId`; returns the unsubscribe. */
export function onCommentsLoaded(documentId: string, listener: () => void): () => void {
  const handle = (event: Event) => {
    if ((event as CustomEvent<string>).detail === documentId) listener();
  };
  bus.addEventListener(LOADED, handle);
  return () => bus.removeEventListener(LOADED, handle);
}
