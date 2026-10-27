import { zagrebParts } from "@/components/summary/zagreb-time";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import type { WorkContextRead } from "./work-context-read";

export type WorkHeader = {
  /** The course, above the title; null without the student's own assignment. */
  eyebrow: string | null;
  /** "Rok: 13. studenoga 2026. u 23:59" in Zagreb time; null without one. */
  meta: string | null;
};

/**
 * The work header of /rad (Archivum S04). Only a "ready" read of the
 * student's own acknowledged assignment names the course and the deadline,
 * the same read that fills Upute; every other case shows neither, so the
 * header never tells a foreign, closed or unknown assignment apart from no
 * assignment (#711 attack A2). Nothing here is read that the page does not
 * already have.
 */
export function workHeader(work: WorkContextRead | null): WorkHeader {
  if (work === null || work.kind !== "ready") return { eyebrow: null, meta: null };
  const course = work.course.trim();
  const parts = zagrebParts(work.notice.dueAt);
  return {
    eyebrow: course.length > 0 ? course : null,
    meta: parts ? t.workspace.upute.due.replace("{date}", parts.date).replace("{time}", parts.time) : null,
  };
}
