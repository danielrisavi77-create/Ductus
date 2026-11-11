import { AtomicDexieJournal } from "@/lib/journal/atomic-dexie-journal";

import { LOGOUT_HOLD_LIMIT_MS } from "./logout-hold";
import type { SessionWatch } from "./session-end";

/**
 * What this device holds of one work before it is submitted (DAN-699, #1876):
 * clear, held (text the server does not have, or a stopped recorder), or
 * unknown. Unknown never lets the submission through.
 */
export type DocumentHoldRead = "clear" | "held" | "unknown";

export type DocumentHoldOptions = {
  timeoutMs?: number;
  peek?: (scope: string, documentId: string) => Promise<boolean>;
};

/**
 * Reads the journal of the page's scope for one document, under the same
 * limit as the sign-out read. A browser without IndexedDB keeps no journal:
 * clear. No scope, a failure or the limit: unknown, so the submission waits.
 */
export async function readDocumentHold(
  scope: string | null,
  documentId: string,
  options: DocumentHoldOptions = {},
): Promise<DocumentHoldRead> {
  if (typeof indexedDB === "undefined" || !indexedDB) return "clear";
  if (!scope) return "unknown";
  const {
    timeoutMs = LOGOUT_HOLD_LIMIT_MS,
    peek = (s: string, id: string) => AtomicDexieJournal.peekDocumentHold(s, id),
  } = options;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"unknown">((resolve) => { timer = setTimeout(() => resolve("unknown"), timeoutMs); });
  try {
    const read = Promise.resolve()
      .then(() => peek(scope, documentId))
      .then((held): DocumentHoldRead => (held ? "held" : "clear"))
      .catch((): "unknown" => "unknown");
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
  }
}

export type GatedSubmit<T> =
  | { kind: "sent"; outcome: T }
  | { kind: "held"; device: "held" | "unknown" }
  | { kind: "stopped" };

/**
 * The guard of one click (review c.6788770331 on #1904): true only while the
 * watcher taken at the click is still the one in `watchRef` (the component is
 * mounted; its cleanup clears the ref), the load is the same, and that
 * watcher's session has not ended (the browser's record is read again).
 */
export function sendGuard(
  watchRef: { readonly current: SessionWatch | null },
  generationRef: { readonly current: number },
): () => boolean {
  const watch = watchRef.current;
  const generation = generationRef.current;
  return () => watch !== null && watchRef.current === watch && generationRef.current === generation && !watch.ended();
}

/**
 * The submission request, sent only once the device was read again right
 * before it and holds nothing of the work (#1836 c.6786016677): a check made
 * when the page loaded says nothing of text saved since. Held or unknown:
 * no request. `live` is asked after the read and before the send: the page
 * may have left or the session ended while the device was read (stopped).
 */
export async function submitWhenClear<T>(
  read: () => Promise<DocumentHoldRead>,
  send: () => Promise<T>,
  live: () => boolean,
): Promise<GatedSubmit<T>> {
  const device = await read();
  if (device !== "clear") return { kind: "held", device };
  if (!live()) return { kind: "stopped" };
  return { kind: "sent", outcome: await send() };
}
