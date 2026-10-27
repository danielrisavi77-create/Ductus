import { zagrebParts } from "@/components/summary/zagreb-time";
import { messagesHr } from "@/lib/i18n/messages.hr";

const years: Record<string, string> = messagesHr.teacher.course.years;

/** `2026/2027` as `2026./2027.`, the form the course form shows. */
export function yearHr(year: string): string {
  return years[year] ?? year.replace(/^(\d{4})\/(\d{4})$/, "$1./$2.");
}

/**
 * `31. listopada 2026. u 23:59`, always in Europe/Zagreb: the page renders on
 * the server, so the clock of neither host nor browser may decide it.
 */
export function dueHr(iso: string): string {
  const parts = zagrebParts(iso);
  return parts === null ? iso : `${parts.date} ${messagesHr.teacherCourses.at} ${parts.time}`;
}
