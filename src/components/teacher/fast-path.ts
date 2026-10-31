import type { ProcessSummaryV1 } from "@/domain/projection/process-summary";
import { compareHr } from "@/domain/text/compare-hr";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { zagrebParts } from "../summary/zagreb-time";

export { compareHr };

const t = messagesHr.fastPath;

/**
 * The fast path of a teacher through the works of one assignment (F-11, D-80
 * point 2): the data shape and the pure parts of the screen. The shape is the
 * answer of B-11c (#757 "Oblik odgovora"), read by `src/client/fast-path.ts`.
 */

export type WorkState = "notice_pending" | "writing" | "submitted";

/** The block kinds of #757: the document's own type names (F-150 point 1, E1). */
export const TEXT_BLOCK_KINDS = ["heading", "paragraph", "bulletItem", "quote"] as const;

/** One block of the work's text, in the order of the document. */
export type TextBlock = { readonly kind: (typeof TEXT_BLOCK_KINDS)[number]; readonly text: string };

/** Blocks as the read-only views draw them: a run of items is one list, a run of quotes one quote. */
export type TextRun = { readonly kind: TextBlock["kind"]; readonly texts: readonly string[] };

/**
 * Consecutive bullet items are one list and consecutive quotes one block
 * quote, as `manuscript-blocks.ts` groups them for the submission views (E1),
 * so the fast path shows the same shape; every other block stands alone.
 */
export function textRuns(blocks: readonly TextBlock[]): TextRun[] {
  const runs: { kind: TextBlock["kind"]; texts: string[] }[] = [];
  for (const block of blocks) {
    const last = runs.at(-1);
    if (last?.kind === block.kind && (block.kind === "bulletItem" || block.kind === "quote")) last.texts.push(block.text);
    else runs.push({ kind: block.kind, texts: [block.text] });
  }
  return runs;
}

export type FastPathRecord = {
  /** How many pastes have no source; their place in the text is not known (#757). */
  readonly pastesWithoutSource: number;
  readonly blocks: readonly TextBlock[];
  /** The same summary the student is shown (PRODUCT §5 rule 5). */
  readonly summary: ProcessSummaryV1;
};

export type FastPathStudent = {
  readonly id: string;
  /** Both null when the account has no name (#757 D1); never a stand-in. */
  readonly givenName: string | null;
  readonly surname: string | null;
  readonly work: WorkState;
  /** ISO instant on a whole minute, or null when there is no record yet. */
  readonly lastChangeAt: string | null;
  /** Null until the student has confirmed the notice: there is no record. */
  readonly record: FastPathRecord | null;
};

export type FastPathLoad =
  | { readonly state: "loading" }
  | { readonly state: "unavailable" }
  | { readonly state: "signedOut" }
  | { readonly state: "pickAssignment" }
  | { readonly state: "ready"; readonly students: readonly FastPathStudent[]; readonly stale: boolean };

const byId = (a: FastPathStudent, b: FastPathStudent) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The students by surname, then given name, then id; those without a name
 * last, by id (D-80, #757 D1). There is no other order: not by a number, a
 * state or a time, and not the order the server sent.
 */
export function bySurname(students: readonly FastPathStudent[]): FastPathStudent[] {
  return [...students].sort((a, b) => {
    if (a.surname === null || b.surname === null) {
      return a.surname === b.surname ? byId(a, b) : a.surname === null ? 1 : -1;
    }
    return compareHr(a.surname, b.surname) || compareHr(a.givenName ?? "", b.givenName ?? "") || byId(a, b);
  });
}

export function fullName(student: FastPathStudent): string {
  return student.surname === null ? t.unnamed : `${student.givenName} ${student.surname}`;
}

export function whenText(iso: string | null): string {
  if (iso === null) return t.noRecord;
  const parts = zagrebParts(iso);
  return parts ? `${parts.date} ${t.at} ${parts.time}` : iso;
}

export type FastPathLine = {
  readonly key: "lastChange" | "pastes" | "record";
  readonly label: string;
  readonly value: string;
};

/** The lines of D-80 point 2 the demo has (#757 O2, O3) and the state of the record, as text. */
export function fastPathLines(student: FastPathStudent, record: FastPathRecord): FastPathLine[] {
  const pastes = record.pastesWithoutSource;
  return [
    { key: "lastChange", label: t.lines.lastChange, value: whenText(student.lastChangeAt) },
    { key: "pastes", label: t.lines.pastes, value: pastes === 0 ? t.none : String(pastes) },
    {
      key: "record",
      label: messagesHr.summary.recordState.label,
      value: messagesHr.summary.recordState[record.summary.recordState],
    },
  ];
}
