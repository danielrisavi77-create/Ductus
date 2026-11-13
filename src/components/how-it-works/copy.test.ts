import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesEn } from "@/lib/i18n/messages.en";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { isUiTextModule } from "../../../scripts/forbidden-terms/scan";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";

import HowItWorks from "./HowItWorks";

/** Every string of a nested catalogue block. */
function strings(block: unknown): string[] {
  if (typeof block === "string") return [block];
  if (block !== null && typeof block === "object") return Object.values(block).flatMap(strings);
  return [];
}

// DAN-431 (J-02), contract (a): docs/PRODUCT.md §5 "Rječnik sučelja".
describe("Kako Ductura radi: forbidden terms", () => {
  it("keeps its text in a module the scanner reads", () => {
    expect(isUiTextModule("src/lib/i18n/messages.hr.ts")).toBe(true);
    expect(isUiTextModule("src/lib/i18n/messages.en.ts")).toBe(true);
  });

  it("uses no forbidden term in the Croatian catalogue", () => {
    const texts = [...strings(messagesHr.howItWorks), messagesHr.shell.howItWorks];
    expect(texts.length).toBeGreaterThan(20);
    for (const text of texts) expect(findForbiddenTerms(text), text).toEqual([]);
  });

  it("uses no forbidden term in the English catalogue", () => {
    for (const text of [...strings(messagesEn.howItWorks), messagesEn.shell.howItWorks]) {
      expect(findForbiddenTerms(text), text).toEqual([]);
    }
  });

  it("shows no forbidden term in the rendered page", () => {
    const shown = renderToStaticMarkup(createElement(HowItWorks)).replace(/<[^>]+>/g, " ");
    expect(findForbiddenTerms(shown)).toEqual([]);
  });

  it("shows every catalogue string, and only from the catalogue", () => {
    const html = renderToStaticMarkup(createElement(HowItWorks));
    const unescape = (s: string) => s.replace(/&quot;/g, "\"").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
    for (const text of strings(messagesHr.howItWorks)) expect(unescape(html), text).toContain(text);
  });

  it("names both save states the way the editor shows them", () => {
    expect(messagesHr.howItWorks.saving.device.startsWith("Spremljeno na uređaju")).toBe(true);
    expect(messagesHr.howItWorks.saving.server.startsWith("Spremljeno na poslužitelju")).toBe(true);
  });

  // Review c.6821148088 on #1973: a work that reached SYNCED and is opened
  // again shows LOCAL_DURABLE (evidence-session.test.ts G3) while the server
  // holds the text, so "saved on this device" must not say the server lacks it.
  it("does not say the server lacks a text saved on this device", () => {
    const hr = messagesHr.howItWorks.saving.device;
    const en = messagesEn.howItWorks.saving.device;
    expect(hr).not.toMatch(/nije primio|nema tekst|nije stigao/);
    expect(en).not.toMatch(/server has not received|server does not have|not reached the server/);
    expect(hr).toMatch(/je li ga poslužitelj već primio/);
    expect(en).toMatch(/whether the server has received it/);
  });
});
