import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { extractUiText, isUiTextModule } from "../../../scripts/forbidden-terms/scan";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import type { DocumentNode } from "@/domain/document";
import type { ParagraphHistoryEntry } from "@/domain/projection/replay-player";
import { messagesEn } from "@/lib/i18n/messages.en";
import { messagesHr } from "@/lib/i18n/messages.hr";

import {
  characters,
  describeChange,
  fill,
  gapWords,
  historyRows,
  nearestStep,
  paragraphOption,
  stepsOf,
} from "./replay-view";

// DAN-537 (rb 261): the words of the replay view. Synthetic texts only.
const t = messagesHr.replay;

const strings = (value: unknown): string[] =>
  typeof value === "string" ? [value] : Object.values(value as Record<string, unknown>).flatMap(strings);

const change = (index: number, after: string | null, source: "editor" | "paste" = "editor", before: string | null = null): ParagraphHistoryEntry =>
  ({ entry: "change", index, kind: "insert", source, before, after, removed: "", inserted: "x" });

describe("replay words (DAN-537)", () => {
  it("no text of the replay names a forbidden term or a measure of time", () => {
    for (const text of [...strings(messagesHr.replay)]) {
      expect({ text, found: findForbiddenTerms(text, "hr") }).toEqual({ text, found: [] });
      // D-143, D-239: no clock, speed, duration or pause.
      expect(text).not.toMatch(/\d:\d|sekund|minut|\bsat[ia]?\b|brzin|tempo|trajanj|pauz|vrijeme/i);
    }
    for (const text of strings(messagesEn.replay)) {
      expect({ text, found: findForbiddenTerms(text, "en") }).toEqual({ text, found: [] });
      expect(text).not.toMatch(/\d:\d|second|minute|hour|speed|tempo|duration|pause|time/i);
    }
  });

  it("keeps its text where the forbidden-terms scan reads it", () => {
    for (const [catalogue, words] of [["src/lib/i18n/messages.hr.ts", messagesHr.replay], ["src/lib/i18n/messages.en.ts", messagesEn.replay]] as const) {
      expect(isUiTextModule(catalogue)).toBe(true);
      const read = extractUiText(catalogue, readFileSync(path.resolve(catalogue), "utf8"), "catalogue").map((piece) => piece.text);
      for (const text of strings(words)) expect({ text, read: read.includes(text) }).toEqual({ text, read: true });
    }
  });

  it("fills placeholders and groups numbers as the rest of the UI", () => {
    expect(fill("Promjena {n} od {total}", { n: 12, total: 1284 })).toBe("Promjena 12 od 1\u00a0284");
    expect(fill("{missing} ostaje", {})).toBe("{missing} ostaje");
  });

  it("counts characters as a reader does", () => {
    expect(characters("ab")).toBe(2);
    expect(characters("👍")).toBe(1);
  });

  it("describes a change with the agreeing Croatian forms", () => {
    expect(describeChange(12, "insert", [{ ordinal: 2, removed: "", inserted: "a" }]))
      .toBe("Promjena 12: umetnut 1 znak u odlomku 2.");
    expect(describeChange(3, "delete", [{ ordinal: 1, removed: "abc", inserted: "" }]))
      .toBe("Promjena 3: obrisana 3 znaka u odlomku 1.");
    expect(describeChange(4, "replace", [{ ordinal: 5, removed: "abcde", inserted: "x".repeat(11) }]))
      .toBe("Promjena 4: obrisano 5 znakova i umetnuto 11 znakova u odlomku 5.");
    expect(describeChange(5, "format", [{ ordinal: 1, removed: "", inserted: "" }]))
      .toBe("Promjena 5: promijenjeno oblikovanje u odlomku 1.");
    expect(describeChange(6, "structure", [{ ordinal: 2, removed: "", inserted: "" }]))
      .toBe("Promjena 6: promijenjena vrsta odlomka 2.");
    expect(describeChange(7, "insert", [
      { ordinal: 1, removed: "", inserted: "ab" },
      { ordinal: 2, removed: "", inserted: "c" },
    ])).toBe("Promjena 7: umetnuta 2 znaka u odlomku 1; umetnut 1 znak u odlomku 2.");
    expect(describeChange(8, "delete", [])).toBe("Promjena 8.");
  });

  it("names every gap and where it lets the reader go", () => {
    expect(gapWords("starts_later", 1)).toEqual({ text: t.gapStartsLater, note: null, target: 1 });
    expect(gapWords("resumed", 5)).toEqual({ text: fill(t.gapBetween, { a: 4, b: 5 }), note: t.gapResumed, target: 5 });
    expect(gapWords("resumed", 1)).toEqual({ text: fill(t.gapBefore, { b: 1 }), note: t.gapResumed, target: 1 });
    expect(gapWords("not_resumed", 4)).toEqual({ text: fill(t.gapStopped, { a: 3 }), note: t.gapStoppedNote, target: 3 });
    expect(gapWords("not_resumed", 1)).toEqual({ text: t.gapStoppedStart, note: t.gapStoppedNote, target: null });
  });

  it("steps through every position, or only the paragraph's changes", () => {
    expect(stepsOf(3, null)).toEqual([0, 1, 2, 3]);
    const history = [change(2, "a"), { entry: "gap", gap: "resumed", beforeIndex: 4 } as const, change(5, "b")];
    expect(stepsOf(9, history)).toEqual([2, 5]);
    expect(nearestStep([2, 5], 4)).toBe(0);
    expect(nearestStep([2, 5], 5)).toBe(1);
    expect(nearestStep([2, 5], 1)).toBe(0);
  });

  it("shows the current, previous and first versions with the gaps between, newest first", () => {
    const history: ParagraphHistoryEntry[] = [
      change(1, "A"),
      change(2, "AB", "paste", "A"),
      // The verified document resumed from holds the paragraph as it was before the gap.
      { entry: "gap", gap: "resumed", beforeIndex: 3 },
      change(3, "ABC", "editor", "AB"),
      change(4, null, "editor", "ABC"),
    ];
    expect(historyRows(history, 0)).toEqual([]);
    expect(historyRows(history, 4)).toEqual([
      { row: "version", label: "Sadašnja (promjena 4)", text: t.historyDeleted, replacedBy: t.historyNotYet, source: "utipkano" },
      { row: "version", label: "Prethodna (promjena 3)", text: "„ABC”", replacedBy: "promjena 4", source: "utipkano" },
      { row: "gap", text: fill(t.gapBetween, { a: 2, b: 3 }) },
      { row: "version", label: "Prva zabilježena (promjena 1)", text: "„A”", replacedBy: "promjena 2", source: "utipkano" },
    ]);
    // Up to change 2 the paragraph has two versions and no gap yet.
    expect(historyRows(history, 2).map((row) => (row.row === "version" ? row.label : row.text))).toEqual([
      "Sadašnja (promjena 2)",
      "Prva zabilježena (promjena 1)",
    ]);
    expect(historyRows(history, 2)[0]).toMatchObject({ source: t.sources.paste });
  });

  it("shows where the record stopped at the last change it replays", () => {
    const history: ParagraphHistoryEntry[] = [change(1, "A"), { entry: "gap", gap: "not_resumed", beforeIndex: 2 }];
    expect(historyRows(history, 1)[0]).toEqual({ row: "gap", text: fill(t.gapStopped, { a: 1 }) });
  });

  it("says a version was replaced inside a resumed gap, and shows the verified text after it", () => {
    const history: ParagraphHistoryEntry[] = [
      change(1, "Staro"),
      { entry: "gap", gap: "resumed", beforeIndex: 2 },
      change(2, "Novo!", "editor", "Novo"),
    ];
    expect(historyRows(history, 2)).toEqual([
      { row: "version", label: "Sadašnja (promjena 2)", text: "„Novo!”", replacedBy: t.historyNotYet, source: "utipkano" },
      { row: "version", label: "Iz provjerenog nastavka (prije promjene 2)", text: "„Novo”", replacedBy: "promjena 2", source: t.historyUnobserved },
      { row: "gap", text: fill(t.gapBetween, { a: 1, b: 2 }) },
      { row: "version", label: "Prva zabilježena (promjena 1)", text: "„Staro”", replacedBy: t.historyInGap, source: "utipkano" },
    ]);
  });

  it("keeps the verified text a change deleted right after a resumed gap", () => {
    const history: ParagraphHistoryEntry[] = [
      { entry: "gap", gap: "resumed", beforeIndex: 2 },
      change(2, null, "editor", "Tekst iz nastavka."),
    ];
    expect(historyRows(history, 2)).toEqual([
      { row: "version", label: "Sadašnja (promjena 2)", text: t.historyDeleted, replacedBy: t.historyNotYet, source: "utipkano" },
      { row: "version", label: "Iz provjerenog nastavka (prije promjene 2)", text: "„Tekst iz nastavka.”", replacedBy: "promjena 2", source: t.historyUnobserved },
      { row: "gap", text: fill(t.gapBetween, { a: 1, b: 2 }) },
    ]);
  });

  it("shows the verified text after a gap for a paragraph no later change touched", () => {
    const history: ParagraphHistoryEntry[] = [change(1, "Staro"), { entry: "gap", gap: "resumed", beforeIndex: 2 }];
    expect(historyRows(history, 3, "Novo")).toEqual([
      { row: "version", label: t.historyResumedNow, text: "„Novo”", replacedBy: t.historyNotYet, source: t.historyUnobserved },
      { row: "gap", text: fill(t.gapBetween, { a: 1, b: 2 }) },
      { row: "version", label: "Prva zabilježena (promjena 1)", text: "„Staro”", replacedBy: t.historyInGap, source: "utipkano" },
    ]);
    // Unchanged across the gap: the version of change 1 is still the current one.
    expect(historyRows(history, 3, "Staro")[1]).toMatchObject({ label: "Sadašnja (promjena 1)", replacedBy: t.historyNotYet });
  });

  // One row per line: a version as "label | text | replaced by | source", a gap as "— text".
  const brief = (rows: ReturnType<typeof historyRows>) =>
    rows.map((row) => (row.row === "gap" ? `— ${row.text}` : `${row.label} | ${row.text} | ${row.replacedBy} | ${row.source}`));
  const stopped = (a: number) => `— ${fill(t.gapStopped, { a })}`;
  const between = (a: number, b: number) => `— ${fill(t.gapBetween, { a, b })}`;

  it.each<{ name: string; history: ParagraphHistoryEntry[]; at: number; current?: string | null; rows: string[] }>([
    {
      name: "K1 no gap: each version is replaced by the next change",
      history: [change(1, "A"), change(2, "AB", "editor", "A"), change(3, "ABC", "editor", "AB")],
      at: 3,
      current: "ABC",
      rows: [
        `Sadašnja (promjena 3) | „ABC” | ${t.historyNotYet} | utipkano`,
        "Prethodna (promjena 2) | „AB” | promjena 3 | utipkano",
        "Prva zabilježena (promjena 1) | „A” | promjena 2 | utipkano",
      ],
    },
    {
      name: "K2 the record stops at the last change it replays",
      history: [change(1, "A"), change(3, "AB", "editor", "A"), { entry: "gap", gap: "not_resumed", beforeIndex: 4 }],
      at: 3,
      current: "AB",
      rows: [stopped(3), `Sadašnja (promjena 3) | „AB” | ${t.historyNotYet} | utipkano`, "Prva zabilježena (promjena 1) | „A” | promjena 3 | utipkano"],
    },
    {
      name: "K2 the record stops after a change of another paragraph",
      history: [change(1, "A"), { entry: "gap", gap: "not_resumed", beforeIndex: 4 }],
      at: 3,
      current: "A",
      rows: [stopped(3), `Sadašnja (promjena 1) | „A” | ${t.historyNotYet} | utipkano`],
    },
    {
      name: "K2 before the last change replayed, the stop is not shown yet",
      history: [change(1, "A"), { entry: "gap", gap: "not_resumed", beforeIndex: 4 }],
      at: 2,
      current: "A",
      rows: [`Sadašnja (promjena 1) | „A” | ${t.historyNotYet} | utipkano`],
    },
    {
      name: "K3 a replacement inside a resumed gap is not credited to the next change",
      history: [change(1, "Staro"), { entry: "gap", gap: "resumed", beforeIndex: 2 }, change(2, "Novo!", "editor", "Novo")],
      at: 2,
      current: "Novo!",
      rows: [
        `Sadašnja (promjena 2) | „Novo!” | ${t.historyNotYet} | utipkano`,
        `Iz provjerenog nastavka (prije promjene 2) | „Novo” | promjena 2 | ${t.historyUnobserved}`,
        between(1, 2),
        `Prva zabilježena (promjena 1) | „Staro” | ${t.historyInGap} | utipkano`,
      ],
    },
    {
      name: "K4 a deletion right after the resumption keeps the verified text",
      history: [change(1, "Staro"), { entry: "gap", gap: "resumed", beforeIndex: 2 }, change(2, null, "editor", "Iz nastavka.")],
      at: 2,
      current: null,
      rows: [
        `Sadašnja (promjena 2) | ${t.historyDeleted} | ${t.historyNotYet} | utipkano`,
        `Iz provjerenog nastavka (prije promjene 2) | „Iz nastavka.” | promjena 2 | ${t.historyUnobserved}`,
        between(1, 2),
        `Prva zabilježena (promjena 1) | „Staro” | ${t.historyInGap} | utipkano`,
      ],
    },
    {
      name: "K5 a late start, a resumed gap the text survived, and a stop",
      history: [
        { entry: "gap", gap: "starts_later", beforeIndex: 1 },
        change(1, "A", "paste"),
        { entry: "gap", gap: "resumed", beforeIndex: 3 },
        change(3, "AB", "editor", "A"),
        { entry: "gap", gap: "not_resumed", beforeIndex: 5 },
      ],
      at: 4,
      current: "AB",
      rows: [
        stopped(4),
        `Sadašnja (promjena 3) | „AB” | ${t.historyNotYet} | utipkano`,
        between(2, 3),
        `Prva zabilježena (promjena 1) | „A” | promjena 3 | ${t.sources.paste}`,
        `— ${t.gapStartsLater}`,
      ],
    },
    {
      name: "K5 two resumed gaps in a row, with the text replaced inside them",
      history: [
        change(1, "A"),
        { entry: "gap", gap: "resumed", beforeIndex: 2 },
        { entry: "gap", gap: "resumed", beforeIndex: 3 },
        change(3, "XY", "editor", "X"),
      ],
      at: 3,
      current: "XY",
      rows: [
        `Sadašnja (promjena 3) | „XY” | ${t.historyNotYet} | utipkano`,
        `Iz provjerenog nastavka (prije promjene 3) | „X” | promjena 3 | ${t.historyUnobserved}`,
        between(2, 3),
        between(1, 2),
        `Prva zabilježena (promjena 1) | „A” | ${t.historyInGap} | utipkano`,
      ],
    },
    {
      name: "K6 a paragraph made right after the resumption has no verified text before it",
      history: [{ entry: "gap", gap: "resumed", beforeIndex: 2 }, change(2, "Novi")],
      at: 2,
      current: "Novi",
      rows: [`Sadašnja (promjena 2) | „Novi” | ${t.historyNotYet} | utipkano`, between(1, 2)],
    },
    {
      name: "K7 a gap after the current version: replaced inside it",
      history: [change(1, "Staro"), { entry: "gap", gap: "resumed", beforeIndex: 2 }],
      at: 3,
      current: "Novo",
      rows: [
        `${t.historyResumedNow} | „Novo” | ${t.historyNotYet} | ${t.historyUnobserved}`,
        between(1, 2),
        `Prva zabilježena (promjena 1) | „Staro” | ${t.historyInGap} | utipkano`,
      ],
    },
    {
      name: "K7 a gap after the current version: unchanged by it",
      history: [change(1, "Staro"), { entry: "gap", gap: "resumed", beforeIndex: 2 }],
      at: 3,
      current: "Staro",
      rows: [between(1, 2), `Sadašnja (promjena 1) | „Staro” | ${t.historyNotYet} | utipkano`],
    },
    {
      name: "K8 before the paragraph's first change: no history",
      history: [{ entry: "gap", gap: "starts_later", beforeIndex: 1 }, change(2, "A")],
      at: 1,
      current: null,
      rows: [],
    },
    { name: "K8 position 0", history: [change(1, "A")], at: 0, current: null, rows: [] },
  ])("lists the paragraph history in every class of input: $name", ({ history, at, current, rows }) => {
    expect(brief(historyRows(history, at, current))).toEqual(rows);
  });

  it("names a paragraph by its place and the start of its text", () => {
    const node = (text: string): DocumentNode =>
      ({ type: "paragraph", id: "p", children: [{ type: "text", text, marks: [] }] }) as unknown as DocumentNode;
    expect(paragraphOption(2, node("  Kratko.  "))).toBe("Odlomak 2: Kratko.");
    const long = paragraphOption(1, node(`${"a".repeat(59)} ${"b".repeat(10)}`));
    expect(long).toBe(`Odlomak 1: ${"a".repeat(59)}…`);
  });
});
