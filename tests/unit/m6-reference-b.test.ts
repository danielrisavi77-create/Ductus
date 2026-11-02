import { readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findForbiddenTerms, findForbiddenTermsInMarkup, PHRASE_BREAK } from "../../scripts/forbidden-terms/terms";

// DAN-514, M6.UX-R, PR 2: reference pages N-08 and N-12 (docs only, no product code).
const DIR = join(process.cwd(), "docs/design/ductura/m6-reference-b");
const PAGES = ["n08-komentari-prijedlozi-dorada.html", "n12-konzultacije.html"] as const;
const THEMES = ["svijetla", "tamna"] as const;
const WIDTHS = ["1440", "400"] as const;

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Every text node, plus the text of the attributes a person or a screen reader gets. */
function readings(html: string): { joined: string; spaced: string } {
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const attrs = [...body.matchAll(/\b(?:aria-label|aria-valuetext|title|alt|placeholder|value)="([^"]*)"/g)].map((m) => m[1]);
  const joined = decode(body.replace(/<[^>]*>/g, "") + PHRASE_BREAK + attrs.join(PHRASE_BREAK));
  const spaced = decode(body.replace(/<[^>]*>/g, " ") + " " + attrs.join(" "));
  return { joined, spaced };
}

describe("m6-reference-b pages", () => {
  for (const page of PAGES) {
    const html = readFileSync(join(DIR, page), "utf8");

    it(`${page}: no forbidden vocabulary in any text node or attribute`, () => {
      const { joined, spaced } = readings(html);
      expect(findForbiddenTermsInMarkup(joined, spaced).map((t) => t.entry)).toEqual([]);
      expect(findForbiddenTerms(spaced).map((t) => t.entry)).toEqual([]);
    });

    it(`${page}: no scripts, no remote resources, no icon sets`, () => {
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/(?:src|href)="https?:/i);
      expect(html).not.toMatch(/<svg|<img/i);
    });

    it(`${page}: lang is hr and every state section has a labelled heading and a stated state`, () => {
      expect(html).toMatch(/<html lang="hr">/);
      const sections = [...html.matchAll(/<section aria-labelledby="([^"]+)"[^>]*data-state="([^"]+)"/g)];
      expect(sections.length).toBeGreaterThanOrEqual(5);
      for (const [, id] of sections) expect(html).toContain(`id="${id}"`);
      const states = sections.map((s) => s[2]);
      expect(new Set(states).size).toBe(states.length);
    });
  }

  it("N-08 shows every state of the rework request (D-45), the direct-edit setting (D-244) and the empty/error/no-access cases", () => {
    const html = readFileSync(join(DIR, PAGES[0]), "utf8");
    for (const s of ["komentar", "prijedlog", "prihvaceno", "izravne-iskljucene", "izravne-ukljucene", "dorada-otvorena", "dorada-provedeno", "dorada-prihvacena", "dorada-ponovno", "dorada-nepristajanje", "promijenjeno-nakon-prihvacanja", "ucitavanje", "prazno", "pogreska", "nema-pristupa"]) {
      expect(html, s).toContain(`data-state="${s}"`);
    }
    expect(html).toContain("promijenjeno nakon prihvaćanja");
    expect(html).toContain("primijenjeni prijedlog");
  });

  it("N-12 shows the shared record, the conditional private part marked as such, and the empty/error/no-access cases", () => {
    const html = readFileSync(join(DIR, PAGES[1]), "utf8");
    for (const s of ["zapis", "popis", "biljeska-uvjetno", "ucitavanje", "prazno", "pogreska", "nema-pristupa"]) {
      expect(html, s).toContain(`data-state="${s}"`);
    }
    expect(html).toContain("Dogovoreno");
    expect(html).toContain("Isti zapis vidi i student");
  });

  it("the README table lists exactly the PNG files in snimke/, each a non-empty PNG", () => {
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    const expected = PAGES.flatMap((p) => THEMES.flatMap((t) => WIDTHS.map((w) => `${p.slice(0, 3)}-${t}-${w}.png`))).sort();
    expect(readdirSync(join(DIR, "snimke")).sort()).toEqual(expected);
    for (const name of expected) {
      expect(readme, name).toContain(name);
      const path = join(DIR, "snimke", name);
      expect(statSync(path).size).toBeGreaterThan(5000);
      expect(readFileSync(path).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }
  });
});
