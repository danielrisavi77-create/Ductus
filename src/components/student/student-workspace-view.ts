import type { StudentWorkspaceItem } from "@/server/institution/student-workspace";

/**
 * DAN-309 (M2.3-P02, contract on #1091, comment 6573005331): what "Moji
 * radovi" shows of the server's read. Pure functions over the items the read
 * returned: a filter only narrows that set, never adds to it and never asks
 * the server; a work state is told only from the server's fields, so a local
 * draft in the browser can never look like a work the server holds.
 */

export type WorkspaceFilter = {
  /** Words of the title or course name; blank keeps every item. */
  q: string;
  /** An academic year (`2026/2027`); blank keeps every year. */
  year: string;
};

/** One value of a `searchParams` entry, as a trimmed string ("" when absent or repeated oddly). */
export function paramOf(value: string | string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.trim().slice(0, 200) : "";
}

const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("hr");

/** The items that match every word of `q` and the year; the order of the read is kept. */
export function filterWorkspace(
  items: readonly StudentWorkspaceItem[],
  { q, year }: WorkspaceFilter,
): StudentWorkspaceItem[] {
  const words = fold(q).split(/\s+/u).filter((word) => word !== "");
  return items.filter((item) => {
    if (year !== "" && item.academicYear !== year) return false;
    const text = fold(`${item.title} ${item.courseName}`);
    return words.every((word) => text.includes(word));
  });
}

/** The academic years of the items, newest first; nothing that the read did not return. */
export function yearsOf(items: readonly StudentWorkspaceItem[]): string[] {
  return [...new Set(items.map((item) => item.academicYear))].sort().reverse();
}

/**
 * One proven state of the student's own work, in the order /rad decides it:
 * an unconfirmed notice comes first (a new version, or the first one), then
 * whether the work exists on the server and whether it was submitted.
 */
export type WorkState =
  | { kind: "newVersion"; version: number }
  | { kind: "notice" }
  | { kind: "notStarted" }
  | { kind: "inProgress" }
  | { kind: "submitted"; at: string; afterDeadline: boolean };

export function workState(item: StudentWorkspaceItem): WorkState {
  if (!item.acknowledged) {
    return item.currentVersion > 1 ? { kind: "newVersion", version: item.currentVersion } : { kind: "notice" };
  }
  if (item.documentId === null) return { kind: "notStarted" };
  if (item.submittedAt === null) return { kind: "inProgress" };
  return { kind: "submitted", at: item.submittedAt, afterDeadline: item.afterDeadline === true };
}

/** Where an item leads: /rad, which checks access and sends an unconfirmed notice first. */
export function itemHref(item: StudentWorkspaceItem): string {
  return `/rad?zadatak=${item.assignmentId}`;
}
