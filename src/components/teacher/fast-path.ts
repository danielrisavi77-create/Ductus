import type { ProcessSummaryV1 } from "@/domain/projection/process-summary";
import { countHr } from "@/lib/i18n/hr";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { zagrebParts } from "../summary/zagreb-time";

const t = messagesHr.fastPath;

/**
 * The fast path of a teacher through the works of one assignment (F-11, D-80
 * point 2): the data shape and the pure parts of the screen.
 *
 * Until Backend gives the teacher the works of an assignment and the four
 * lines (B-11), the screen reads invented data of this shape
 * (`demo-fast-path.hr.ts`); only the source changes later.
 */

export type WorkState = "notice_pending" | "writing" | "revision_requested" | "submitted";

/** One block of the work's text, in the order of the document. */
export type TextBlock = { readonly kind: "heading" | "paragraph"; readonly text: string };

export type FastPathRecord = {
  readonly openRevisionRequests: number;
  /** Indexes into `blocks` of pasted paragraphs whose source was not given. */
  readonly pastesWithoutSource: readonly number[];
  readonly declaration: "not_submitted" | "submitted";
  readonly blocks: readonly TextBlock[];
  /** The same summary the student is shown (PRODUCT §5 rule 5). */
  readonly summary: ProcessSummaryV1;
};

export type FastPathStudent = {
  readonly id: string;
  readonly givenName: string;
  readonly surname: string;
  readonly work: WorkState;
  /** ISO instant, or null when there is no record yet. */
  readonly lastChangeAt: string | null;
  /** Null until the student has confirmed the notice: there is no record. */
  readonly record: FastPathRecord | null;
};

export type FastPathLoad =
  | { readonly state: "loading" }
  | { readonly state: "unavailable" }
  | { readonly state: "ready"; readonly students: readonly FastPathStudent[] };

/*
 * The Croatian alphabet, written out (as `hr.ts` writes out the months), so
 * the order does not depend on the ICU data of the host. dž, lj and nj are
 * one letter each. Letters outside it (q, w, x, y) take the place they have
 * in the Latin alphabet; anything else sorts after, by code point.
 */
const ALPHABET = [
  "a", "b", "c", "č", "ć", "d", "dž", "đ", "e", "f", "g", "h", "i", "j", "k", "l", "lj", "m",
  "n", "nj", "o", "p", "q", "r", "s", "š", "t", "u", "v", "w", "x", "y", "z", "ž",
];
const RANK = new Map(ALPHABET.map((letter, index) => [letter, index]));
const DIGRAPHS = new Set(["dž", "lj", "nj"]);

function letters(word: string): number[] {
  const lower = word.normalize("NFC").toLocaleLowerCase("hr");
  const out: number[] = [];
  for (let i = 0; i < lower.length; i += 1) {
    const pair = lower.slice(i, i + 2);
    if (DIGRAPHS.has(pair)) {
      out.push(RANK.get(pair)!);
      i += 1;
      continue;
    }
    const ch = lower[i]!;
    out.push(RANK.get(ch) ?? ALPHABET.length + ch.codePointAt(0)!);
  }
  return out;
}

/** Compares two words by the Croatian alphabet; case does not count. */
export function compareHr(a: string, b: string): number {
  const x = letters(a);
  const y = letters(b);
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    if (x[i] !== y[i]) return x[i]! - y[i]!;
  }
  return x.length - y.length;
}

/**
 * The students by surname, then given name (D-80). There is no other order:
 * not by a number, a state or a time.
 */
export function bySurname(students: readonly FastPathStudent[]): FastPathStudent[] {
  return [...students].sort(
    (a, b) => compareHr(a.surname, b.surname) || compareHr(a.givenName, b.givenName) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export function fullName(student: FastPathStudent): string {
  return `${student.givenName} ${student.surname}`;
}

export function whenText(iso: string | null): string {
  if (iso === null) return t.noRecord;
  const parts = zagrebParts(iso);
  return parts ? `${parts.date} ${t.at} ${parts.time}` : iso;
}

/** "Uvod, 2. odlomak": the heading above a block and its place under it. */
export function placeOf(blocks: readonly TextBlock[], index: number): string {
  let heading = "";
  let n = 0;
  for (let i = 0; i <= index && i < blocks.length; i += 1) {
    if (blocks[i]!.kind === "heading") {
      heading = blocks[i]!.text;
      n = 0;
    } else {
      n += 1;
    }
  }
  const place = `${n}. ${t.paragraph}`;
  return heading ? `${heading}, ${place}` : place;
}

export type FastPathLine = {
  readonly key: "lastChange" | "revisions" | "pastes" | "declaration" | "record";
  readonly label: string;
  readonly value: string;
};

/** The four lines of D-80 point 2 and the state of the record, as text. */
export function fastPathLines(student: FastPathStudent, record: FastPathRecord): FastPathLine[] {
  const { openRevisionRequests: open, pastesWithoutSource: pastes } = record;
  return [
    { key: "lastChange", label: t.lines.lastChange, value: whenText(student.lastChangeAt) },
    {
      key: "revisions",
      label: t.lines.revisions,
      value: open === 0 ? t.none : countHr(open, t.revisionForms.one, t.revisionForms.few, t.revisionForms.many),
    },
    {
      key: "pastes",
      label: t.lines.pastes,
      value: pastes.length === 0 ? t.none : `${pastes.length} · ${pastes.map((i) => placeOf(record.blocks, i)).join("; ")}`,
    },
    { key: "declaration", label: t.lines.declaration, value: t.declaration[record.declaration] },
    {
      key: "record",
      label: messagesHr.summary.recordState.label,
      value: messagesHr.summary.recordState[record.summary.recordState],
    },
  ];
}
