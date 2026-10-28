import type { WorkContextRead } from "./work-context-read";

/**
 * The heading above the text on /rad (F-8 point 5). Only a "ready" read, the
 * same one that already fills the top bar and Upute, names the assignment;
 * every other read (no `?zadatak=`, a foreign, unknown or closed assignment,
 * a failed read) gives the same neutral text, so the heading never tells
 * those cases apart (#711 attack A2). Display only: the document id stays as
 * it is until #711 F1.
 */
export function sheetTitle(read: WorkContextRead, neutral: string): string {
  if (read.kind !== "ready") return neutral;
  const title = read.notice.title.trim();
  return title.length > 0 ? title : neutral;
}
