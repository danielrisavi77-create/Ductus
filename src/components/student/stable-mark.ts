import type { SessionMark } from "@/client/session-marks";

/**
 * The session mark the /rad sheet keeps (#732 item 7). The page stamps every
 * server render with its time (`at`), and a soft navigation inside /rad (the
 * switch to "Kako vidi nastavnik" and back) renders the page again. A new
 * `at` for the same session would restart the sheet's whole writing session:
 * the lock, the load and the evidence open. The mark of the first render
 * under a session is kept while the session (its tag) stays the same; a new
 * session, or none, replaces it.
 */
export function stableMark(kept: SessionMark | null, next: SessionMark | null): SessionMark | null {
  return kept !== null && next !== null && kept.tag === next.tag ? kept : next;
}
