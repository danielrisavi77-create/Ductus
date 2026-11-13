import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesEn } from "@/lib/i18n/messages.en";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { isUiTextModule } from "../../../scripts/forbidden-terms/scan";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import type { WorkLanguageExceptionSave } from "./work-language";
import WorkLanguageExceptionCard from "./WorkLanguageExceptionCard";

// Invented assignment and student only. Contract: #1836 c.6858305983.
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STUDENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DOC = "izmisljeni rad/a";
const w = messagesHr.teacher.workLanguageException;
const PAGE = `/nastavnik/zadatak/${ID}/rad/izmisljeni%20rad%2Fa/jezik`;
const card = (
  exception: "hr" | "en" | null, initial: WorkLanguageExceptionSave | null = null, assignmentLanguage: "hr" | "en" = "hr",
) => renderToStaticMarkup(createElement(WorkLanguageExceptionCard, {
  assignmentId: ID, documentId: DOC, studentId: STUDENT, assignmentLanguage, exception, initial,
}));
const decode = (html: string) => html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("DAN-386 one work's language exception card (P02d)", () => {
  it("without an exception checks 'as the assignment' and names the assignment language", () => {
    const html = decode(card(null, null, "en"));
    expect(html).toContain("Jezik zadatka: engleski.");
    expect(html).toContain("Za ovaj rad sada vrijedi: engleski.");
    expect(html).toContain("Kao zadatak (engleski)");
    expect(html).toMatch(/checked="" value=""/);
    expect(html).not.toMatch(/checked="" value="(hr|en)"/);
    // Nothing changed yet, so nothing to send.
    expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${w.save}</button>`));
    expect(html).not.toContain(w.reload);
    expect(html).not.toContain("lang=");
  });

  it("with an exception checks that language and says it is in force", () => {
    const html = decode(card("en"));
    expect(html).toContain("Jezik zadatka: hrvatski.");
    expect(html).toContain("Za ovaj rad sada vrijedi: engleski.");
    expect(html).toMatch(/checked="" value="en"/);
    expect(html).not.toMatch(/checked="" value=""/);
  });

  it("an exception equal to the assignment language is still shown as an exception", () => {
    // A stored override that equals the assignment keeps the work on that language even if the assignment changes.
    const html = card("hr", null, "hr");
    expect(html).toMatch(/checked="" value="hr"/);
    expect(html).not.toMatch(/checked="" value=""/);
  });

  it("after a save says the language in force and stays usable for a further change", () => {
    const html = decode(card("en", { kind: "saved", language: "en" }));
    expect(html).toContain(w.saved.replace("{language}", "engleski"));
    expect(html).toContain('role="status"');
    expect(html).not.toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).not.toContain(w.reload);
  });

  it("after a confirmed removal names the language the server answered, not the one read (Codex #1986)", () => {
    // The assignment's language changed since the read: the removal answers English, the card read Croatian.
    const html = decode(card(null, { kind: "saved", language: "en" }, "hr"));
    expect(html).toContain(w.saved.replace("{language}", "engleski"));
    expect(html).toContain(w.current.replace("{language}", "engleski"));
    expect(html).not.toContain(w.current.replace("{language}", "hrvatski"));
  });

  it.each(["conflict", "forbidden", "unauthorized", "unavailable"] as const)(
    "a %s locks the card and offers only a fresh read (negative: never resent)", (kind) => {
      const html = card(null, { kind });
      expect(decode(html)).toContain(w.errors[kind]);
      expect(html).toContain('role="alert"');
      expect(html).toMatch(/<fieldset[^>]*disabled=""/);
      expect(html).toMatch(/<button[^>]*disabled=""/);
      expect(html).toContain(`href="${PAGE}"`);
      expect(html).toContain(w.reload);
    },
  );

  it("an invalid choice can still be corrected", () => {
    const html = card(null, { kind: "invalid" });
    expect(html).toContain(w.errors.invalid);
    expect(html).not.toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).not.toContain(w.reload);
  });

  it("the reload link names the work by its document id, never by the student id", () => {
    const html = renderToStaticMarkup(createElement(WorkLanguageExceptionCard, {
      assignmentId: ID.toUpperCase(), documentId: DOC, studentId: STUDENT.toUpperCase(), assignmentLanguage: "hr", exception: null,
      initial: { kind: "unavailable" },
    }));
    expect(html).toContain(`href="${PAGE}"`);
    expect(html.toLowerCase()).not.toContain(STUDENT);
  });

  it("has the same keys in both catalogues and no forbidden term (PRODUCT §5)", () => {
    const keys = (o: object): string[] => Object.entries(o).flatMap(([k, v]) =>
      typeof v === "object" ? keys(v).map((x) => `${k}.${x}`) : [k]);
    expect(keys(messagesEn.teacher.workLanguageException)).toEqual(keys(w));
    const texts = (o: object): string[] => Object.values(o).flatMap((v) => typeof v === "object" ? texts(v) : [v]);
    for (const text of texts(w)) expect(findForbiddenTerms(text)).toEqual([]);
    expect(isUiTextModule("src/lib/i18n/messages.hr.ts")).toBe(true);
  });
});
