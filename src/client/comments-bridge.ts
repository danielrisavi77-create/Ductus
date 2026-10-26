/**
 * One page, two views of the same comments: on /rad the student's comment
 * panel stays beside the "Kako vidi nastavnik" view (#732 item 7), which
 * draws its own comment marks over the live text. Two signals keep them
 * together, inside one tab only; they carry no comment and nothing leaves
 * the page:
 * - the panel read the comments again (its refresh button, a reply), so the
 *   marks read them too, or the list and the text would disagree;
 * - "Prikaži u tekstu" in the panel shows the passage in the text on screen:
 *   while the teacher view is shown, that is the live text, not the editor
 *   the view replaced.
 */

const bus = new EventTarget();
const LOADED = "loaded";
const shows = new Map<string, (threadId: string) => void>();

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

/** While the teacher view of `documentId` is shown, it shows a thread's passage; returns the unregister. */
export function handleShowInText(documentId: string, show: (threadId: string) => void): () => void {
  shows.set(documentId, show);
  return () => {
    if (shows.get(documentId) === show) shows.delete(documentId);
  };
}

/** True when the teacher view took the request; false means the panel shows it in its editor. */
export function showInText(documentId: string, threadId: string): boolean {
  const show = shows.get(documentId);
  if (!show) return false;
  show(threadId);
  return true;
}
