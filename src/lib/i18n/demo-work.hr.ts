import type { NoticeView } from "@/components/student/assignment-notice-read";

import type { WorkOverview } from "@/components/editor/SidePanels";

/**
 * Invented data in the shape of the real reads (FE-D9). `DEMO_ASSIGNMENT` is
 * only a fixture of SidePanels.test.ts: /rad never shows it, and Upute shows
 * the RLS read of `?zadatak=` or nothing (#476 contract 6280487079).
 * `DEMO_WORK` is the stage list of Rad on /rad until its read exists (#476).
 * No real course, teacher or student. It lives here because its text can be
 * shown, so the forbidden-terms scan reads it (UI_TEXT_MODULES,
 * "src/lib/i18n/**").
 */
export const DEMO_ASSIGNMENT: NoticeView = {
  assignmentId: "00000000-0000-4000-8000-000000000d09",
  versionNo: 1,
  title: "Esej: Lokalna samouprava i sudjelovanje građana",
  instructions:
    "Napiši esej od 2 000 do 2 500 riječi s uvodom, razradom, zaključkom i popisom literature. " +
    "Citiraj prema Uputama FPZG-a: (Prezime, godina: stranica).",
  workType: "essay",
  evidenceProfile: "basic",
  opensAt: "2026-10-12T07:00:00.000Z",
  dueAt: "2026-11-20T22:59:00.000Z",
  aiPurposes: ["formatting", "proofreading", "literature_search"],
  wordMin: null,
  wordMax: null,
  acknowledgedAt: "2026-10-14T16:20:00.000Z",
};

export const DEMO_WORK: WorkOverview = {
  stages: [
    { id: "tema", name: "Tema i istraživačko pitanje", state: "approved" },
    { id: "nacrt", name: "Nacrt strukture", state: "approved" },
    {
      id: "uvod",
      name: "Uvod i pregled literature",
      state: "returned",
      note: "Dodaj radove objavljene nakon 2015. i jasnije izdvoji istraživačko pitanje.",
    },
    { id: "razrada", name: "Razrada", state: "inProgress" },
    { id: "zakljucak", name: "Zaključak i sažetak", state: "notStarted" },
  ],
};
