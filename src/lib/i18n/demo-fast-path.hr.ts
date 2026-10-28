import type { FastPathStudent, TextBlock } from "@/components/teacher/fast-path";
import type { ProcessSummaryV1 } from "@/domain/projection/process-summary";

/**
 * Invented students and texts for the fast path (F-11) in the unit and e2e
 * tests only; the page reads the route (B-11c, #757). Every name and
 * sentence here is made up; none belongs to a real person. It lives in
 * `src/lib/i18n/` so the forbidden-terms scan reads it. The order here is
 * deliberately not by surname: the screen sorts.
 */

const TEXT_A: readonly TextBlock[] = [
  { kind: "heading", text: "Uvod" },
  { kind: "paragraph", text: "Gradske knjižnice u izmišljenom gradu Lipovcu otvorene su šest dana u tjednu i primaju sve stanovnike bez članarine." },
  { kind: "paragraph", text: "Rad opisuje kako su se čitaonice mijenjale u posljednjih deset godina i što o tome kažu izmišljeni zapisi gradskog vijeća." },
  { kind: "heading", text: "Analiza" },
  { kind: "paragraph", text: "Broj posudbi rastao je sporije od broja posjeta, jer su ljudi sve češće dolazili čitati i učiti na licu mjesta." },
  { kind: "paragraph", text: "Izmišljeno istraživanje navodi da čitaonice popodne služe kao tihi prostor za učenje, a ujutro kao mjesto susreta." },
  { kind: "paragraph", text: "Takva podjela dana traži drukčiji raspored osoblja nego što ga knjižnica ima danas." },
];

const TEXT_B: readonly TextBlock[] = [
  { kind: "heading", text: "Uvod" },
  { kind: "paragraph", text: "Ovaj izmišljeni rad pita mogu li male knjižnice u četvrtima zamijeniti jednu veliku središnju knjižnicu." },
  { kind: "heading", text: "Rasprava" },
  { kind: "paragraph", text: "Male knjižnice bliže su čitateljima, ali svaka ima manje knjiga i kraće radno vrijeme." },
  { kind: "paragraph", text: "Zaključak rada je da obje vrste trebaju jedna drugu i da ih treba planirati zajedno." },
];

function summary(recordState: ProcessSummaryV1["recordState"], sessions: number): ProcessSummaryV1 {
  return {
    summaryFormat: "ductus-process-summary-v1",
    sessions: {
      evidenceKind: "observed",
      breakAboveMinutes: 30,
      count: sessions,
      items: [
        { from: "2026-10-14T16:02:00.000Z", to: "2026-10-14T17:10:00.000Z" },
        { from: "2026-10-17T08:15:00.000Z", to: "2026-10-17T08:42:00.000Z" },
      ].slice(0, sessions),
    },
    pastes: {
      evidenceKind: "observed",
      listedAboveCharacters: 200,
      listed: [{ at: { from: "2026-10-14T16:30:00.000Z", to: "2026-10-14T16:31:00.000Z" }, characters: 412, origin: "not_observed" }],
      smallerCount: 2,
    },
    gaps: {
      evidenceKind: "observed",
      items:
        recordState === "has_gaps"
          ? [{ previousEndedAt: "2026-10-14T17:10:00.000Z", nextStartedAt: "2026-10-14T17:40:00.000Z" }]
          : [],
    },
    recordState,
  };
}

export const DEMO_FAST_PATH: readonly FastPathStudent[] = [
  {
    id: "demo-student-3",
    givenName: "Lana",
    surname: "Ćiriličić",
    work: "writing",
    lastChangeAt: "2026-10-16T19:05:00.000Z",
    record: { pastesWithoutSource: 0, blocks: TEXT_B, summary: summary("complete", 1) },
  },
  {
    id: "demo-student-1",
    givenName: "Ivan",
    surname: "Čitalić",
    work: "writing",
    lastChangeAt: "2026-10-17T08:42:00.000Z",
    record: { pastesWithoutSource: 3, blocks: TEXT_A, summary: summary("has_gaps", 2) },
  },
  {
    id: "demo-student-4",
    givenName: "Matej",
    surname: "Šiljalić",
    work: "notice_pending",
    lastChangeAt: null,
    record: null,
  },
  {
    id: "demo-student-2",
    givenName: "Petra",
    surname: "Bilježnić",
    work: "submitted",
    lastChangeAt: "2026-10-15T16:30:00.000Z",
    record: { pastesWithoutSource: 0, blocks: TEXT_A, summary: summary("complete", 2) },
  },
];
