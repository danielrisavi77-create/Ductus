import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { accessLogDaysOf } from "@/domain/privacy/access-log-days";
import { messagesEn } from "@/lib/i18n/messages.en";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { extractUiText, isUiTextModule } from "../../../scripts/forbidden-terms/scan";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { AccessLogDays, AccessLogUnavailable, dayHeading, readerLabel } from "./AccessLogView";

// DAN-294 (S-42, contract on #1836, c.6814737263). Invented names and ids only.
const a = messagesHr.accessLog;
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
type Row = Record<string, unknown>;
const row = (n: number, iso: string, over: Row = {}): Row => ({
  entry_id: id(n), opened_at: new Date(iso), surface: "live_view", reader_role: "mentor",
  reader_given_name: "Nastavnik", reader_family_name: "B", ...over,
});
const strings = (value: unknown): string[] =>
  typeof value === "string" ? [value] : typeof value === "object" && value !== null ? Object.values(value).flatMap(strings) : [];
const days = (rows: Row[]) => accessLogDaysOf(rows)!;
const html = (rows: Row[], olderHref: string | null = null) => renderToStaticMarkup(createElement(AccessLogDays, { days: days(rows), olderHref }));

describe("DAN-294 S-42 view", () => {
  it("empty: the empty note, no list and no older link", () => {
    const out = html([], "/x?stranica=2");
    expect(out).toContain(a.empty);
    expect(out).not.toContain("<ul");
    expect(out).not.toContain(a.older);
  });

  it("filled: one section per day, newest first, each row time, who and what", () => {
    const out = html([
      row(1, "2026-11-09T10:40:00Z", { reader_role: "teacher", reader_family_name: "C", surface: "process_summary" }),
      row(2, "2026-11-10T13:10:00Z"),
    ]);
    expect(out.indexOf("Utorak, 10. 11. 2026.")).toBeLessThan(out.indexOf("Ponedjeljak, 9. 11. 2026."));
    expect(out).toContain('<time class="access-log__time" dateTime="2026-11-10T13:10:00.000Z">14:10–14:15</time>');
    expect(out).toContain(`Nastavnik B · ${a.roles.mentor}`);
    expect(out).toContain(`Nastavnik C · ${a.roles.teacher}`);
    expect(out).toContain(a.surfaces.process_summary);
    expect(out.match(/<li /g)).toHaveLength(2);
    expect(out).toMatch(/<section[^>]*aria-labelledby="dan-2026-11-10"/);
  });

  it("each opening in one window is its own row; nothing counted, summed or timed", () => {
    const out = html([row(1, "2026-11-10T13:10:00Z"), row(2, "2026-11-10T13:10:00Z"), row(3, "2026-11-10T13:10:00Z")]);
    expect(out.match(/<li /g)).toHaveLength(3);
    expect(out).not.toMatch(/\b[0-9]+\s*(puta|posjet|otvaranj|minuta ukupno|min\b|h\b)/i);
    expect(out).not.toMatch(/ukupno|trajanje|broj/i);
  });

  it("a reader without a name is the role alone; an unknown role or surface stays visible", () => {
    const out = html([
      row(1, "2026-11-10T13:10:00Z", { reader_given_name: null, reader_family_name: null, reader_role: "seminar_teacher" }),
      row(2, "2026-11-10T13:05:00Z", { reader_role: "owner", surface: "elsewhere" }),
    ]);
    expect(out).toContain(`<span>${a.roleAlone.seminar_teacher}</span>`);
    expect(out).toContain(`Nastavnik B · ${a.roles.unknown}`);
    expect(out).toContain(a.surfaces.unknown);
  });

  it("the older link is a plain link to the given address, only when given", () => {
    expect(html([row(1, "2026-11-10T13:10:00Z")], "/rad/x/dnevnik-pristupa?stranica=2"))
      .toContain(`<a class="access-log__more" href="/rad/x/dnevnik-pristupa?stranica=2">${a.older}</a>`);
    expect(html([row(1, "2026-11-10T13:10:00Z")])).not.toContain(a.older);
  });

  it("on the autumn change two windows with one Zagreb wall clock keep distinct instants", () => {
    const out = html([row(1, "2026-10-25T00:00:00Z"), row(2, "2026-10-25T01:00:00Z")]);
    expect(out.match(/>02:00–02:05</g)).toHaveLength(2);
    expect(out).toContain('dateTime="2026-10-25T00:00:00.000Z"');
    expect(out).toContain('dateTime="2026-10-25T01:00:00.000Z"');
  });

  it("truncated: a status note that older openings exist, and only then", () => {
    const one = [row(1, "2026-11-10T13:10:00Z")];
    expect(renderToStaticMarkup(createElement(AccessLogDays, { days: days(one), olderHref: null, truncated: true })))
      .toContain(`<p class="access-log__note" role="status">${a.truncated}</p>`);
    expect(html(one)).not.toContain(a.truncated);
  });

  it("error: an alert and a retry link", () => {
    const out = renderToStaticMarkup(createElement(AccessLogUnavailable, { retryHref: "/rad/x/dnevnik-pristupa" }));
    expect(out).toContain(`role="alert">${a.unavailable}`);
    expect(out).toContain(`href="/rad/x/dnevnik-pristupa">${a.retry}</a>`);
  });

  it("headings and labels", () => {
    expect(dayHeading(days([row(1, "2026-03-29T00:55:00Z")])[0]!)).toBe("Nedjelja, 29. 3. 2026.");
    const [entry] = days([row(1, "2026-11-10T13:10:00Z", { reader_given_name: null, reader_family_name: null })])[0]!.entries;
    expect(readerLabel(entry!)).toBe(a.roleAlone.mentor);
  });

  it("no catalogue text of the screen uses a forbidden term", () => {
    const texts = JSON.stringify(a);
    expect(findForbiddenTerms(texts)).toEqual([]);
    expect(findForbiddenTerms(html([row(1, "2026-11-10T13:10:00Z")], "/x"))).toEqual([]);
  });

  it("keeps its text where the forbidden-terms scan reads it", () => {
    for (const [catalogue, words] of [["src/lib/i18n/messages.hr.ts", messagesHr.accessLog], ["src/lib/i18n/messages.en.ts", messagesEn.accessLog]] as const) {
      expect(isUiTextModule(catalogue)).toBe(true);
      const read = extractUiText(catalogue, readFileSync(path.resolve(catalogue), "utf8"), "catalogue").map((piece) => piece.text);
      for (const text of strings(words)) expect({ text, read: read.includes(text) }).toEqual({ text, read: true });
    }
  });
});
