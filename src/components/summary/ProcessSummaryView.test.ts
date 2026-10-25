import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import type { ProcessSummaryV1 } from "@/domain/projection/process-summary";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { extractUiText, isUiTextModule } from "../../../scripts/forbidden-terms/scan";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { ProcessSummaryView } from "./ProcessSummaryView";
import { zagrebParts } from "./zagreb-time";

const t = messagesHr.summary;

// Invented summary (no real student data); times are whole UTC minutes.
function summaryWith(overrides: Partial<ProcessSummaryV1> = {}): ProcessSummaryV1 {
  return {
    summaryFormat: "ductus-process-summary-v1",
    sessions: {
      evidenceKind: "observed",
      breakAboveMinutes: 30,
      count: 2,
      items: [
        { from: "2026-10-14T18:02:00.000Z", to: "2026-10-14T19:10:00.000Z" },
        { from: "2026-10-25T22:40:00.000Z", to: "2026-10-26T00:15:00.000Z" },
      ],
    },
    pastes: {
      evidenceKind: "observed",
      listedAboveCharacters: 200,
      listed: [
        { at: { from: "2026-10-14T18:30:00.000Z", to: "2026-10-14T18:31:00.000Z" }, characters: 412, origin: "not_observed" },
        { at: { from: "2026-10-25T23:00:00.000Z", to: "2026-10-25T23:01:00.000Z" }, characters: 201, origin: "not_observed" },
        { at: { from: "2026-10-25T23:05:00.000Z", to: "2026-10-25T23:06:00.000Z" }, characters: 9001, origin: "not_observed" },
      ],
      smallerCount: 3,
    },
    gaps: {
      evidenceKind: "observed",
      items: [{ previousEndedAt: "2026-10-14T19:10:00.000Z", nextStartedAt: "2026-10-14T19:40:00.000Z" }],
    },
    recordState: "has_gaps",
    ...overrides,
  };
}

const EMPTY: ProcessSummaryV1 = {
  summaryFormat: "ductus-process-summary-v1",
  sessions: { evidenceKind: "observed", breakAboveMinutes: 45, count: 0, items: [] },
  pastes: { evidenceKind: "observed", listedAboveCharacters: 150, listed: [], smallerCount: 0 },
  gaps: { evidenceKind: "observed", items: [] },
  recordState: "complete",
};

function render(summary: ProcessSummaryV1, extra: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(ProcessSummaryView, { summary, ...extra }));
}

/*
 * Text is read from the element tree the component returns, not by parsing
 * HTML: the view is made of host elements only, so the tree is exactly what
 * React renders, and no markup has to be taken apart with patterns.
 */
type Element = ReactElement<{ children?: ReactNode; "data-number"?: string }>;

function tree(summary: ProcessSummaryV1): Element {
  return ProcessSummaryView({ summary }) as Element;
}

function childrenOf(node: ReactNode): ReactNode[] {
  if (Array.isArray(node)) return node.flatMap(childrenOf);
  return isValidElement(node) ? [node] : [];
}

/** Visible text of a node, as React renders it. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node as Element).props.children);
  return "";
}

/** Every element under `node`, itself included, that `match` accepts. */
function findAll(node: ReactNode, match: (element: Element) => boolean): Element[] {
  return childrenOf(node).flatMap((element) => {
    const own = element as Element;
    return [...(match(own) ? [own] : []), ...findAll(own.props.children, match)];
  });
}

/** Text of every element carrying `data-number="<name>"`. */
function numbered(view: Element, name: string): string[] {
  return findAll(view, (element) => element.props["data-number"] === name).map(textOf);
}

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("ProcessSummaryView: one view for every reader", () => {
  it("gives byte-identical markup for the same summary whatever the host time zone", () => {
    const markups = ["UTC", "America/Los_Angeles", "Asia/Tokyo", "Pacific/Kiritimati", "Europe/Zagreb"].map((zone) => {
      process.env.TZ = zone;
      return render(summaryWith());
    });
    // The zone change is real for this process, so the test can fail.
    process.env.TZ = "Asia/Tokyo";
    const tokyo = new Date("2026-10-14T18:02:00.000Z").getHours();
    process.env.TZ = "America/Los_Angeles";
    expect(new Date("2026-10-14T18:02:00.000Z").getHours()).not.toBe(tokyo);
    expect(new Set(markups).size).toBe(1);
  });

  it("has no input about who reads it: an extra prop changes nothing", () => {
    const plain = render(summaryWith());
    expect(render(summaryWith(), { role: "teacher" })).toBe(plain);
    expect(render(summaryWith(), { role: "student", viewer: "mentor" })).toBe(plain);
    // @ts-expect-error the props are the summary alone
    createElement(ProcessSummaryView, { summary: summaryWith(), role: "teacher" });
  });

  it("says the same summary is shown to the student and the teacher, in one caption", () => {
    const markup = render(summaryWith());
    expect(markup).toContain(t.sameForEveryone);
    expect(markup).not.toContain("Isti prikaz vidi nastavnik");
    expect(markup).not.toContain("Isti prikaz vidi student");
  });

  it("does not depend on a generated id or the render position", () => {
    const alone = render(summaryWith());
    const nested = renderToStaticMarkup(
      createElement("main", null, createElement("p", null, "x"), createElement(ProcessSummaryView, { summary: summaryWith() })),
    );
    expect(nested).toContain(alone);
  });
});

describe("ProcessSummaryView: Europe/Zagreb times", () => {
  it("writes summer and winter times in Zagreb, across the October change", () => {
    const text = textOf(tree(summaryWith()));
    // 18:02 UTC on 14 Oct is 20:02 in summer time.
    expect(text).toContain("14. listopada 2026. od 20:02 do 21:10");
    // 22:40 UTC on 25 Oct is 23:40 in winter time; the session runs past midnight.
    expect(text).toContain("od 25. listopada 2026. u 23:40 do 26. listopada 2026. u 01:15");
    expect(text).toContain(t.timeNote);
  });

  it("matches the IANA Europe/Zagreb zone over many years and every change", () => {
    const zone = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Zagreb",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const months = ["siječnja", "veljače", "ožujka", "travnja", "svibnja", "lipnja", "srpnja", "kolovoza", "rujna", "listopada", "studenoga", "prosinca"];
    const instants: number[] = [];
    for (let at = Date.UTC(2020, 0, 1); at < Date.UTC(2036, 0, 1); at += 31 * 3_600_000 + 13 * 60_000) instants.push(at);
    for (let year = 2020; year < 2036; year += 1) {
      for (const month of [2, 9]) {
        const last = new Date(Date.UTC(year, month + 1, 0));
        const change = Date.UTC(year, month, last.getUTCDate() - last.getUTCDay(), 1);
        for (const delta of [-61, -60, -1, 0, 1, 59, 60]) instants.push(change + delta * 60_000);
      }
    }
    // One assertion at the end: a list of differences, not thousands of expects.
    const differences: string[] = [];
    for (const at of instants) {
      const parts = Object.fromEntries(zone.formatToParts(at).map((part) => [part.type, part.value]));
      const expected = `${Number(parts.day)}. ${months[Number(parts.month) - 1]} ${parts.year}. ${parts.hour}:${parts.minute}`;
      const own = zagrebParts(new Date(at).toISOString());
      const actual = own ? `${own.date} ${own.time}` : "null";
      if (actual !== expected) differences.push(`${new Date(at).toISOString()}: ${actual} != ${expected}`);
    }
    expect(instants.length).toBeGreaterThan(4000);
    expect(differences).toEqual([]);
  }, 30_000);

  it("shows an unreadable instant as written, never as another time", () => {
    expect(zagrebParts("not-a-time")).toBeNull();
    const view = tree(summaryWith({ gaps: { evidenceKind: "observed", items: [{ previousEndedAt: "x", nextStartedAt: "y" }] } }));
    expect(textOf(view)).toContain(`${t.gaps.item}: x – y`);
  });
});

describe("ProcessSummaryView: thresholds, pastes, gaps and evidence kind", () => {
  it("puts the threshold next to every number", () => {
    const view = tree(summaryWith());
    const [sessions] = numbered(view, "sessions");
    expect(sessions).toContain(`${t.sessions.count}: 2`);
    expect(sessions).toContain(`${t.sessions.threshold} 30 minuta`);

    const pastes = numbered(view, "paste");
    expect(pastes).toHaveLength(3);
    for (const paste of pastes) expect(paste).toContain(`${t.pastes.listedThreshold} 200 znakova`);

    const [smaller] = numbered(view, "smaller-pastes");
    expect(smaller).toContain(`${t.pastes.smaller}: 3`);
    expect(smaller).toContain(`${t.pastes.smallerThreshold} 200 znakova`);
  });

  it("names a threshold without its internal label (#732 item 12)", () => {
    const text = textOf(tree(summaryWith()));
    expect(text).toContain("prag: nova sesija počinje nakon stanke dulje od 30 minuta");
    expect(text).not.toMatch(/P-0\d/);
  });

  it("follows the configured thresholds, not fixed values", () => {
    const view = tree(EMPTY);
    expect(numbered(view, "sessions")[0]).toContain(`${t.sessions.threshold} 45 minuta`);
    expect(numbered(view, "smaller-pastes")[0]).toContain(`${t.pastes.smallerThreshold} 150 znakova`);
    expect(textOf(view)).toContain(`${t.pastes.noneListed} (${t.pastes.listedThreshold} 150 znakova)`);
    expect(textOf(view)).not.toContain("30 minuta");
    expect(textOf(view)).not.toContain("200 znak");
  });

  it("agrees Croatian forms with the numbers", () => {
    const one = summaryWith({
      sessions: { evidenceKind: "observed", breakAboveMinutes: 1, count: 0, items: [] },
      pastes: {
        evidenceKind: "observed",
        listedAboveCharacters: 0,
        listed: [{ at: { from: "2026-01-10T10:00:00.000Z", to: "2026-01-10T10:01:00.000Z" }, characters: 1, origin: "not_observed" }],
        smallerCount: 0,
      },
    });
    const text = textOf(tree(one));
    expect(text).toContain(`${t.sessions.threshold} 1 minute`);
    expect(text).toContain(`${t.pastes.size}: 1 znak `);
    expect(text).toContain(`${t.pastes.listedThreshold} 0 znakova`);
    expect(text).toContain("10. siječnja 2026. od 11:00 do 11:01");
  });

  it("lists each large paste with its size and 'izvor nije opažen', in record order, with no total or share", () => {
    const view = tree(summaryWith());
    const pastes = numbered(view, "paste");
    expect(pastes.map((paste) => paste.match(/Veličina: (\d+)/)?.[1])).toEqual(["412", "201", "9001"]);
    for (const paste of pastes) expect(paste).toContain(t.pastes.origins.not_observed);
    const text = textOf(view);
    expect(text).not.toContain(String(412 + 201 + 9001));
    expect(text).not.toMatch(/%|udio|ukupno|zbroj/i);
  });

  it("shows gaps as 'praznina u zapisu' with the explanation, and the record state", () => {
    const text = textOf(tree(summaryWith()));
    expect(text).toContain(`${t.recordState.label}: ${t.recordState.has_gaps}`);
    expect(text).toContain(t.gaps.explanation);
    expect(text).toContain(`${t.gaps.item}: 14. listopada 2026. od 21:10 do 21:40`);

    const empty = textOf(tree(EMPTY));
    expect(empty).toContain(`${t.recordState.label}: ${t.recordState.complete}`);
    expect(empty).toContain(t.gaps.none);
    expect(empty).toContain(t.sessions.none);
    expect(t.recordState.complete).toBe("Zapis je cjelovit");
    expect(t.recordState.has_gaps).toBe("Zapis ima praznine (vidi popis)");
  });

  it("names the kind of evidence on every item and every number", () => {
    const view = tree(summaryWith());
    const kind = `${t.evidenceKind}: ${t.evidenceKinds.observed}`;
    const items = findAll(view, (element) => element.type === "li").map(textOf);
    expect(items).toHaveLength(2 + 3 + 1);
    for (const item of items) expect(item).toContain(kind);
    for (const name of ["sessions", "smaller-pastes"]) expect(numbered(view, name)[0]).toContain(kind);
  });
});

describe("ProcessSummaryView: interface vocabulary", () => {
  it("renders no word from the forbidden vocabulary", () => {
    for (const summary of [summaryWith(), EMPTY]) {
      const text = textOf(tree(summary));
      expect(findForbiddenTerms(text)).toEqual([]);
    }
    for (const text of Object.values(t).flatMap(function leaves(value: unknown): string[] {
      return typeof value === "string" ? [value] : Object.values(value as object).flatMap(leaves);
    })) {
      expect(findForbiddenTerms(text), text).toEqual([]);
    }
  });

  it("keeps its text where the forbidden-terms scan reads it", () => {
    const catalogue = "src/lib/i18n/messages.hr.ts";
    expect(isUiTextModule(catalogue)).toBe(true);
    const read = extractUiText(catalogue, readFileSync(path.resolve(catalogue), "utf8"), "catalogue").map((piece) => piece.text);
    for (const text of [t.title, t.sameForEveryone, t.gaps.explanation, t.pastes.origins.not_observed, t.recordState.has_gaps]) {
      expect(read).toContain(text);
    }
  });
});
