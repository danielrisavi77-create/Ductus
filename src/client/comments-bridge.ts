/**
 * One page, two views of the same comments: on /rad the student's comment
 * panel stays beside the "Kako vidi nastavnik" view (#732 item 7), which
 * draws its own comment marks over the live text. Two signals keep them
 * together, inside one tab only; they carry no comment and nothing leaves
 * the page:
 * - the panel read the comments again (its refresh button, a reply), so the
 *   marks read them too, or the list and the text would disagree;
 * - "Prikaži u tekstu" in the panel, and a heading of the outline in the
 *   structure rail, show their place in the text on screen: while the
 *   teacher view is shown, that is the live text, not the editor the view
 *   replaced.
 */

const bus = new EventTarget();
const LOADED = "loaded";
/** What the rail asks to show: a comment thread's passage, or a block (a heading of the outline). */
export type ShowTarget = { readonly threadId: string } | { readonly nodeId: string };

const shows = new Map<string, (target: ShowTarget) => void>();

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

/** While the teacher view of `documentId` is shown, it shows what the rail asks for; returns the unregister. */
export function handleShowInText(documentId: string, show: (target: ShowTarget) => void): () => void {
  shows.set(documentId, show);
  return () => {
    if (shows.get(documentId) === show) shows.delete(documentId);
  };
}

/** True when the teacher view took the request; false means the rail shows it in its editor. */
export function showInText(documentId: string, target: ShowTarget): boolean {
  const show = shows.get(documentId);
  if (!show) return false;
  show(target);
  return true;
}
