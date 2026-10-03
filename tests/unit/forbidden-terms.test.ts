import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { extractUiText, scanUiText } from "../../scripts/forbidden-terms/scan";
import { FORBIDDEN_TERMS, findForbiddenTerms, foldText } from "../../scripts/forbidden-terms/terms";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const entries = (text: string) => findForbiddenTerms(text).map((term) => term.entry);

describe("forbidden interface terms (PRODUCT.md 5)", () => {
  it.each([
    ["Sumnjivo lijepljenje", "sumnjivo"],
    ["Postoji sumnja na prepisivanje", "sumnjivo"],
    ["Nesumnjivo je tako", "sumnjivo"],
    ["Ocjena rizika: visoka", "rizik"],
    ["Rizični odlomci", "rizik"],
    ["Uočena ANOMALIJA u zapisu", "anomalija, anomaly"],
    ["Upozorenje o studentu", "upozorenje o studentu"],
    ["Upozorenja o studentima", "upozorenje o studentu"],
    ["Postotak AI-ja: 40 %", "AI postotak"],
    ["AI-postotak", "AI postotak"],
    ["Vjerojatnost umjetne inteligencije", "vjerojatnost"],
    ["Autentičnost rada", "autentičnost"],
    ["autenticnost", "autentičnost"],
    ["Ovo je napisao AI", "napisao AI"],
    ["Napisala umjetna inteligencija", "napisao AI"],
    ["AI je napisao odlomak", "napisao AI"],
    ["Verificirano autorstvo", "verificirano autorstvo"],
    ["Dokaz autorstva", "dokaz autorstva"],
    ["Kopirani tekst", "kopirano"],
    ["Prepisano iz izvora", "prepisano"],
    ["Nestali podaci", "nestali podaci"],
    ["Skriveni dio rada", "skriveno"],
    ["Spremljeno", "spremljeno (bez pojašnjenja)"],
    ["Promjene su spremljene.", "spremljeno (bez pojašnjenja)"],
    ["Suspicious paste", "suspicious"],
    ["Risk score", "risk"],
    ["AI percentage", "AI percentage"],
    ["Percentage of AI", "AI percentage"],
    ["Probability of AI use", "probability"],
    ["Authenticity check", "authenticity"],
    ["Written by AI", "written by AI"],
    ["Verified authorship", "verified authorship"],
    ["Proof of authorship", "proof of authorship"],
    ["Copied text", "copied"],
    ["Missing data", "missing data"],
    ["Hidden edits", "hidden"],
  ])("flags %j as %s", (text, entry) => {
    expect(entries(text)).toContain(entry);
  });

  it.each([
    "Spremljeno na uređaju",
    "Spremljeno na poslužitelju",
    "spremljeno na uredaju",
    "Predano",
    "Nespremljene promjene",
    "Spremi",
    "Zalijepljeno (izvor nije opažen)",
    "Praznina u zapisu",
    "Zapis je cjelovit i neizmijenjen od primitka",
    "Iz AI pomoćnika (model, 14:05)",
    "Kako je rad nastao, bez presude o autorstvu.",
    "Autentikacija nije uspjela",
    "Authentication failed",
    "Prijava putem AAI@EduHr",
    "Dokazi o predaji",
    "Kristina je napisala uvod",
  ])("allows %j", (text) => {
    expect(entries(text)).toEqual([]);
  });

  it("matches across case, diacritics, punctuation and invisible characters", () => {
    expect(foldText("AUTENTIČNOST")).toBe("autenticnost");
    expect(foldText("Skri­ven")).toBe("skriven");
    expect(foldText("Đak  –  rizik!")).toBe("dak rizik");
    expect(entries("dokaz autorstva")).toEqual(["dokaz autorstva"]);
  });

  it("gives every entry a replacement from the dictionary", () => {
    for (const term of FORBIDDEN_TERMS) expect(term.instead).not.toBe("");
  });
});

describe("interface text extraction", () => {
  it("reads rendered component text and skips code", () => {
    const source = `
      import { hidden } from "./hidden";
      export const metadata = { title: "Skriveni naslov" };
      // Skriveno u komentaru
      export function Panel({ isHidden, label }: { isHidden: boolean; label: string }) {
        return (
          <section className="hidden" data-state="hidden" aria-label="Rizik panel">
            <h2>Sumnjivo</h2>
            {isHidden ? "Nestali podaci" : label}
            {isHidden && "Kopirano"}
            {t("status.hidden")}
            {state === "hidden" ? null : <p title={isHidden ? "Prepisano" : "Predano"}>ok</p>}
          </section>
        );
      }`;
    const texts = extractUiText("app/panel.tsx", source, "component").map((entry) => entry.text.trim());
    expect(texts.sort()).toEqual(
      ["Kopirano", "Nestali podaci", "Predano", "Prepisano", "Rizik panel", "Skriveni naslov", "Sumnjivo", "ok"].sort(),
    );
  });

  it("reads every catalogue value but not keys or imports", () => {
    const source = `
      import { plural } from "./hidden-helpers";
      export const messages = { "status.hidden": "Praznina u zapisu", saved: \`Spremljeno \${place}\` };`;
    const texts = extractUiText("src/lib/i18n/messages.ts", source, "catalogue").map((entry) => entry.text);
    expect(texts).toEqual(["Praznina u zapisu", "Spremljeno  "]);
  });
});

describe("repository scan", () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it("fails on a forbidden term in a message catalogue", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    mkdirSync(path.join(root, "src", "lib", "i18n"), { recursive: true });
    mkdirSync(path.join(root, "app"));
    writeFileSync(path.join(root, "src", "lib", "i18n", "messages.json"), '{"gap": {"label": "Nestali podaci"}}\n');
    writeFileSync(path.join(root, "src", "lib", "i18n", "messages.test.ts"), 'export const x = "Sumnjivo";\n');
    writeFileSync(path.join(root, "app", "page.tsx"), "export default () => <p>Spremljeno na uređaju</p>;\n");
    const findings = scanUiText(root);
    expect(findings.map((f) => [f.file, f.line, f.terms.map((t) => t.entry)])).toEqual([
      ["src/lib/i18n/messages.json", 1, ["nestali podaci"]],
    ]);
  });

  it("finds no forbidden term in the interface text of this repository", () => {
    const report = scanUiText(REPO_ROOT).map(
      (f) => `${f.file}:${f.line} "${f.text.trim()}" → ${f.terms.map((t) => `${t.entry} (umjesto: ${t.instead})`).join(", ")}`,
    );
    expect(report).toEqual([]);
  });
});
