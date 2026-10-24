/**
 * Whether the right panel of /rad may show the invented Upute and Rad data
 * (FE-D9, src/lib/i18n/demo-work.hr.ts). Only the local demo journal without
 * any session does; a signed-in person sees the empty states until the reads
 * exist, so no invented rule or teacher's note is shown as theirs (F-110 t.1).
 */
export function showsInventedPanels(journal: { scope: string | null; signedIn: boolean }): boolean {
  return journal.scope !== null && !journal.signedIn;
}
