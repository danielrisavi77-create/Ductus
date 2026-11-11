import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesEn } from "@/lib/i18n/messages.en";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { isUiTextModule } from "../../../scripts/forbidden-terms/scan";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import type { WorkLanguageSave } from "./work-language";
import WorkLanguageCard from "./WorkLanguageCard";

// Invented assignment only. Contract: #1836 c.6791532518.
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const w = messagesHr.teacher.workLanguage;
const card = (initial: WorkLanguageSave | null = null, current: "hr" | "en" = "hr") =>
  renderToStaticMarkup(createElement(WorkLanguageCard, { assignmentId: ID, versionNo: 3, current, initial }));
const decode = (html: string) => html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("DAN-386 work language card (P02c)", () => {
  it("shows the language in force as the checked choice and offers no change yet", () => {
    const html = card(null, "en");
    expect(html).toContain(w.heading);
    expect(html).toContain("Sada: engleski.");
    expect(html).toMatch(/checked="" value="en"/);
    expect(html).not.toMatch(/checked="" value="hr"/);
    expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${w.saveIdle}</button>`));
    expect(html).not.toContain(w.consequence.replace("{n}", "4"));
    expect(html).not.toContain(w.reload);
    // The card names its own language only in text; the page keeps lang="hr".
    expect(html).not.toContain("lang=");
  });

  it("after a save says the version in force and locks, without a button to send again", () => {
    const html = card({ kind: "saved", version: 4 });
    expect(html).toContain(w.saved.replace("{n}", "4"));
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<button");
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toContain(`href="/nastavnik/zadatak/${ID}/uredi"`);
  });

  it.each(["conflict", "forbidden", "unauthorized", "unavailable"] as const)(
    "a %s locks the card and offers only a fresh read (negative: never resent)", (kind) => {
      const html = card({ kind });
      expect(decode(html)).toContain(w.errors[kind]);
      expect(html).toContain('role="alert"');
      expect(html).toMatch(/<fieldset[^>]*disabled=""/);
      expect(html).toMatch(/<button[^>]*disabled=""/);
      expect(html).toContain(w.reload);
    },
  );

  it("an invalid choice can still be corrected", () => {
    const html = card({ kind: "invalid" });
    expect(html).toContain(w.errors.invalid);
    expect(html).not.toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).not.toContain(w.reload);
  });

  it("has the same keys in both catalogues and no forbidden term (PRODUCT §5)", () => {
    const keys = (o: object): string[] => Object.entries(o).flatMap(([k, v]) =>
      typeof v === "object" ? keys(v).map((x) => `${k}.${x}`) : [k]);
    expect(keys(messagesEn.teacher.workLanguage)).toEqual(keys(w));
    const texts = (o: object): string[] => Object.values(o).flatMap((v) => typeof v === "object" ? texts(v) : [v]);
    for (const text of texts(w)) expect(findForbiddenTerms(text)).toEqual([]);
    expect(isUiTextModule("src/lib/i18n/messages.hr.ts")).toBe(true);
  });
});
