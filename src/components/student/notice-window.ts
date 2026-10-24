// FE-D8 (#476 row 05): where the assignment stands in time when the notice
// is read. The page decides it once on the server from the version's dates;
// the server is what refuses writing before `opens_at` (evidence_open_work,
// "not_accepting"), so before then the notice is shown without the
// confirmation that would open the editor. Nothing refuses work after the
// due date, so past it the notice only says so.
export type NoticeWindow = "notOpen" | "open" | "pastDue";

/** `now` in milliseconds; a date that does not parse never closes anything. */
export function noticeWindow(opensAt: string, dueAt: string, now: number): NoticeWindow {
  const opens = Date.parse(opensAt);
  const due = Date.parse(dueAt);
  if (!Number.isNaN(opens) && now < opens) return "notOpen";
  if (!Number.isNaN(due) && now > due) return "pastDue";
  return "open";
}
