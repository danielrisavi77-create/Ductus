import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  UI_TEXT_MODULES,
  extractUiText,
  findMisplacedUiText,
  isUiTextModule,
  scanUiText,
} from "../../scripts/forbidden-terms/scan";
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
    // Derived forms: the stem may sit inside a word.
    ["Posumnjati u rad", "sumnjivo"],
    ["Osumnjičen", "sumnjivo"],
    ["Nema razloga za posumnjati", "sumnjivo"],
    ["Nerizičan rad", "rizik"],
    ["Neautentično", "autentičnost"],
    ["Inauthentic", "authenticity"],
    // English equivalents (D-90, point 3).
    ["Suspected paste", "suspicious"],
    ["Likelihood of AI use", "probability"],
    ["Warning about the student", "warning about the student"],
    ["Warnings about students", "warning about the student"],
    ["Alert regarding this student", "warning about the student"],
    ["Student warning", "warning about the student"],
    ["Student alerts", "warning about the student"],
    ["Saved", "saved (without saying where)"],
    ["All changes saved.", "saved (without saying where)"],
    ["Saved locally", "saved (without saying where)"],
    ["Saved on disk", "saved (without saying where)"],
    ["Spremljeno lokalno", "spremljeno (bez pojašnjenja)"],
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
    // Words that only resemble `sumnj` once diacritics are folded away.
    "Razumniji prijedlog",
    "Šumniji prostor",
    "Sumarni pregled",
    "U sumrak",
    "Sumporna kiselina",
    "Sum njihovih radova",
    "Saved on this device",
    "Saved on the server",
    "Saved to your device",
    "Unsaved changes",
    "Save",
    "Submitted",
    "Warning about the deadline",
    "Notice to students",
    "Asterisk marks a required field",
    "Briefly",
  ])("allows %j", (text) => {
    expect(entries(text)).toEqual([]);
  });

  it("matches across case, diacritics, punctuation and invisible characters", () => {
    expect(foldText("AUTENTIČNOST")).toBe("autenticnost");
    expect(foldText("Skri\u00ADven")).toBe("skriven");
    expect(foldText("Đak  –  rizik!")).toBe("dak rizik");
    expect(entries("dokaz\u00A0autorstva")).toEqual(["dokaz autorstva"]);
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

  const write = (relative: string, content: string): void => {
    const file = path.join(root!, ...relative.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  const scanned = () => scanUiText(root!).map((f) => [f.file, f.line, f.terms.map((t) => t.entry)]);

  it("reads state labels in src/domain", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    mkdirSync(path.join(root, "app"));
    write(
      "src/domain/sync/labels.ts",
      [
        'import { hidden } from "./hidden";',
        'type State = "hidden" | "risk";',
        "export const LABELS: Record<string, { label: string }> = {",
        '  LOCAL_DURABLE: { label: "Spremljeno lokalno" },',
        '  SYNCED: { label: "Spremljeno na poslužitelju" },',
        '  "status.hidden": { label: `Praznina u zapisu` },',
        "};",
        "",
      ].join("\n"),
    );
    expect(scanned()).toEqual([["src/domain/sync/labels.ts", 4, ["spremljeno (bez pojašnjenja)"]]]);
  });

  it("reads every interface text module and metadata under app, in Croatian and English", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    write("src/lib/i18n/hr.ts", 'export const hr = { gap: "Skriveni dio rada" };\n');
    write("src/domain/sync/labels.ts", 'export const LABELS = { done: "Copied text" };\n');
    write("src/domain/review/messages.ts", 'export const MESSAGES = { note: "Ocjena rizika" };\n');
    write("src/features/submit/copy.ts", 'export const COPY = { done: "Hidden edits" };\n');
    write("src/domain/serverSync/contract.ts", 'export const MESSAGES = { failed: "Posumnjali smo u zapis." };\n');
    write("src/editor/schema.ts", 'export const placeholder = "Saved";\n');
    write("app/api/status/route.ts", 'export const metadata = { title: "Warning about the student" };\n');
    write("app/review/page.tsx", "export default () => (\n  <main>\n    <h1>Sumnjivo</h1>\n    <p>Risk score</p>\n  </main>\n);\n");
    expect(scanned().sort()).toEqual([
      ["app/api/status/route.ts", 1, ["warning about the student"]],
      ["app/review/page.tsx", 3, ["sumnjivo"]],
      ["app/review/page.tsx", 4, ["risk"]],
      ["src/domain/review/messages.ts", 1, ["rizik"]],
      ["src/domain/serverSync/contract.ts", 1, ["sumnjivo"]],
      ["src/domain/sync/labels.ts", 1, ["copied"]],
      ["src/editor/schema.ts", 1, ["saved (without saying where)"]],
      ["src/features/submit/copy.ts", 1, ["hidden"]],
      ["src/lib/i18n/hr.ts", 1, ["skriveno"]],
    ]);
  });

  // The strings the review reproduced as false findings (PR #45, review of cc5b80d).
  const TECHNICAL_MODULE = [
    'el.setAttribute("aria-hidden", "true");',
    'input.type = "hidden";',
    'Object.assign(el.style, { overflow: "hidden" });',
    'const READ = "select id, saved_at from drafts where is_hidden = false";',
    'const WRITE = "update x set copied_from = $1";',
    'const SOURCE = "paste:copied";',
    'const COLUMN = "risk_level";',
    'log.info("draft saved");',
    'throw new Error("checkpoint saved twice");',
    "const QUERY = `select saved_at from drafts where id = ${id} and is_hidden`;",
    "",
  ].join("\n");

  it("does not read technical strings in modules that hold no interface text", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    for (const file of [
      "src/application/evidence/evidence-outbox.ts",
      "src/adapters/evidence/repository.ts",
      "src/lib/journal/atomic-dexie-journal.ts",
      "src/editor/interop.ts",
      "src/domain/sync/journal-types.ts",
      "app/api/status/route.ts",
    ]) {
      write(file, TECHNICAL_MODULE);
    }
    expect(scanned()).toEqual([]);
    expect(findMisplacedUiText(root)).toEqual([]);
  });

  it("still reads the same strings once they sit in an interface text module", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    mkdirSync(path.join(root, "app"));
    write("src/domain/sync/labels.ts", TECHNICAL_MODULE);
    expect(scanned().map(([, line]) => line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("reads only the attributes a person reads or hears in a component", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    mkdirSync(path.join(root, "app"));
    write(
      "src/components/Panel.tsx",
      [
        'const STYLE = { overflow: "hidden" };',
        "export const Panel = ({ open }: { open: boolean }) => (",
        '  <form id="risk" name="hidden" role="alert" className="hidden risk" data-state="copied" style={STYLE}>',
        '    <input type="hidden" name="saved" aria-hidden="true" />',
        '    <a href="/hidden/risk" data-risk="hidden" className={open ? "saved" : "hidden"}>Dalje</a>',
        '    <img alt="Skriveni dio rada" />',
        '    <input placeholder="Saved" />',
        '    <button aria-label="Ocjena rizika" title={open ? "Copied text" : "Predano"} />',
        "  </form>",
        ");",
        "",
      ].join("\n"),
    );
    expect(scanned()).toEqual([
      ["src/components/Panel.tsx", 6, ["skriveno"]],
      ["src/components/Panel.tsx", 7, ["saved (without saying where)"]],
      ["src/components/Panel.tsx", 8, ["rizik"]],
      ["src/components/Panel.tsx", 8, ["copied"]],
    ]);
  });

  it("does not read test files, declaration files or JSON outside the catalogues", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    mkdirSync(path.join(root, "app"));
    write("src/domain/sync/labels.test.ts", 'export const x = "Sumnjivo";\n');
    write("src/domain/sync/labels.spec.ts", 'export const x = "Sumnjivo";\n');
    write("src/domain/sync/labels.d.ts", 'export declare const x: "Sumnjivo";\n');
    write("src/domain/sync/fixture.json", '{"x": "Sumnjivo"}\n');
    write("src/domain/sync/labels.ts", 'export const x = "Spremljeno na uređaju";\n');
    expect(scanned()).toEqual([]);
  });

  it("finds no forbidden term in the interface text of this repository", () => {
    const report = scanUiText(REPO_ROOT).map(
      (f) => `${f.file}:${f.line} "${f.text.trim()}" → ${f.terms.map((t) => `${t.entry} (umjesto: ${t.instead})`).join(", ")}`,
    );
    expect(report).toEqual([]);
  });
});

describe("interface text outside the scanned modules", () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });
  const write = (relative: string, content: string): void => {
    const file = path.join(root!, ...relative.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  const misplaced = (at: string): string[] => findMisplacedUiText(at).map((t) => `${t.file}:${t.line} "${t.text.trim()}"`);

  it("lists the modules whose every string is read", () => {
    expect(UI_TEXT_MODULES).toEqual([
      "src/lib/i18n/**",
      "**/labels.ts",
      "**/messages.ts",
      "**/copy.ts",
      "src/domain/serverSync/**",
      "src/editor/schema.ts",
    ]);
    for (const file of [
      "src/lib/i18n/hr.ts",
      "src/lib/i18n/plural/rules.ts",
      "src/domain/sync/labels.ts",
      "labels.ts",
      "app/review/messages.ts",
      "src/features/submit/copy.ts",
      "src/domain/serverSync/bootstrap.ts",
      "src/domain/serverSync/checkpoints.ts",
      "src/domain/serverSync/contract.ts",
      "src/editor/schema.ts",
    ]) {
      expect(isUiTextModule(file), file).toBe(true);
    }
    for (const file of [
      "src/domain/sync/states.ts",
      "src/domain/sync/sync-labels.ts",
      "src/domain/sync/labels.tsx",
      "src/domain/serverSyncX/contract.ts",
      "src/editor/interop.ts",
      "src/editor/schema.ts.bak",
      "src/lib/journal/atomic-dexie-journal.ts",
      "src/application/evidence/evidence-outbox.ts",
      "app/api/status/route.ts",
      "tests/lib/i18n/hr.ts",
    ]) {
      expect(isUiTextModule(file), file).toBe(false);
    }
  });

  it("reports Croatian text in a module the scan does not read", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    write("src/application/evidence/evidence-outbox.ts", 'export const FAILED = "Zapis nije poslan na poslužitelj.";\n');
    write("src/domain/sync/states.ts", "// Greška u komentaru\nexport const note = (n: number) => `Preostalo ${n} riječi`;\n");
    write("src/editor/interop.ts", 'export const HINT = "POČNI PISATI";\n');
    write("app/api/status/route.ts", 'export const body = { message: "Đak nije pronađen" };\n');
    write("src/domain/sync/drain.ts", 'export const A = "Greška";\nexport const B = "(Uređivanje)";\nexport const C = "nije pronađeno";\n');
    expect(misplaced(root).sort()).toEqual([
      'app/api/status/route.ts:1 "Đak nije pronađen"',
      'src/application/evidence/evidence-outbox.ts:1 "Zapis nije poslan na poslužitelj."',
      'src/domain/sync/drain.ts:1 "Greška"',
      'src/domain/sync/drain.ts:2 "(Uređivanje)"',
      'src/domain/sync/drain.ts:3 "nije pronađeno"',
      'src/domain/sync/states.ts:2 "Preostalo   riječi"',
      'src/editor/interop.ts:1 "POČNI PISATI"',
    ]);
  });

  it("does not report text the scan reads, tests, declarations, keys, types or comments", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    write("src/lib/i18n/hr.ts", 'export const hr = { word: "riječ" };\n');
    write("src/domain/sync/labels.ts", 'export const LABELS = { ERROR: "Greška" };\n');
    write("src/domain/review/messages.ts", 'export const MESSAGES = { none: "Nema bilješki" };\n');
    write("src/domain/serverSync/contract.ts", 'export const FAILED = "Rad nije pronađen na poslužitelju.";\n');
    write("src/editor/schema.ts", 'export const DEFAULT_PLACEHOLDER = "Počni pisati…";\n');
    write("app/layout.ts", 'export const metadata = { title: "Početna" };\n');
    write("app/page.tsx", "export default () => <p>Uređivanje</p>;\n");
    write("src/domain/sync/states.test.ts", 'export const x = "Greška";\n');
    write("src/domain/sync/states.spec.ts", 'export const x = "Greška";\n');
    write("src/domain/sync/states.d.ts", 'export declare const x: "Greška";\n');
    write(
      "src/domain/sync/states.ts",
      '// Greška u komentaru\nexport type Code = "citanje" | "greška";\nexport const CODES = { "naziv-prazan": "naziv_prazan", "šifra": 1 };\n',
    );
    expect(misplaced(root)).toEqual([]);
  });

  it("does not report a single lower-case word, which is data rather than a label", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    mkdirSync(path.join(root, "app"));
    write(
      "src/domain/diff/diff.ts",
      'const MODALS = new Set(["može", "mogu", "upućuje", "  riječ  ", "naziv-prazan", "šifra_rada"]);\n' +
        'const LABEL = "Može";\nconst PHRASE = "može biti";\n',
    );
    expect(misplaced(root)).toEqual(['src/domain/diff/diff.ts:2 "Može"', 'src/domain/diff/diff.ts:3 "može biti"']);
  });

  it("finds no Croatian text outside the scanned modules of this repository", () => {
    expect(
      misplaced(REPO_ROOT),
      "Tekst sučelja stoji u modulu koji provjera zabranjenih izraza ne čita. Premjesti ga u modul s popisa " +
        "UI_TEXT_MODULES (scripts/forbidden-terms/scan.ts) ili proširi popis ako je cijeli modul tekst sučelja. " +
        "Izuzeci po datoteci nisu dopušteni.",
    ).toEqual([]);
  });
});
