import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

import { ENTITY_NAMES, decodeEntities } from "../../scripts/forbidden-terms/entities";
import {
  INLINE_ELEMENTS,
  TECHNICAL_ATTRIBUTES,
  UI_TEXT_MODULES,
  extractUiText,
  findMisplacedUiText,
  isUiTextModule,
  jsxTextValue,
  scanUiText,
} from "../../scripts/forbidden-terms/scan";
import {
  FORBIDDEN_TERMS,
  PHRASE_BREAK,
  findForbiddenTerms,
  findForbiddenTermsInMarkup,
  foldPhrases,
  foldText,
} from "../../scripts/forbidden-terms/terms";

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

  // Gender, number and case of each entry, and the forms derived from it (QA of 232c9f4).
  it.each([
    ["Sumnjivih odlomaka", "sumnjivo"],
    ["Bez sumnji", "sumnjivo"],
    ["Rizici", "rizik"],
    ["Rizična rečenica", "rizik"],
    ["Visokorizični odlomci", "rizik"],
    ["Niskorizičan rad", "rizik"],
    ["Anomalije u zapisu", "anomalija, anomaly"],
    ["Anomalan zapis", "anomalija, anomaly"],
    ["Anomalne promjene", "anomalija, anomaly"],
    ["Upozorenjima o studenticama", "upozorenje o studentu"],
    ["Postotak umjetne inteligencije: 40 %", "AI postotak"],
    ["Postoci AI-ja", "AI postotak"],
    ["Postotci AI-ja", "AI postotak"],
    ["Postotkom AI-ja", "AI postotak"],
    ["AI postoci", "AI postotak"],
    ["Vjerojatnosti", "vjerojatnost"],
    ["S vjerojatnošću od 80 %", "vjerojatnost"],
    ["Rad je autentičan", "autentičnost"],
    ["Neautentičan odlomak", "autentičnost"],
    ["Autentična verzija", "autentičnost"],
    ["Autentični radovi", "autentičnost"],
    ["Autentičnošću rada", "autentičnost"],
    ["Napisalo AI", "napisao AI"],
    ["Napisao ga je AI", "napisao AI"],
    ["AI ga je napisao", "napisao AI"],
    ["Umjetna inteligencija je napisala odlomak", "napisao AI"],
    ["Verificiranog autorstva", "verificirano autorstvo"],
    ["Dokazi autorstva", "dokaz autorstva"],
    ["Dokaz o autorstvu", "dokaz autorstva"],
    ["Dokazima o autorstvu", "dokaz autorstva"],
    ["Kopirana rečenica", "kopirano"],
    ["Kopiran odlomak", "kopirano"],
    ["Prekopirano", "kopirano"],
    ["Iskopiran odlomak", "kopirano"],
    ["Prepisana rečenica", "prepisano"],
    ["Prepisani odlomci", "prepisano"],
    ["Nestalih podataka", "nestali podaci"],
    ["Nestalim podacima", "nestali podaci"],
    ["Nestao podatak", "nestali podaci"],
    ["Skrivena izmjena", "skriveno"],
    ["Skrivenih dijelova", "skriveno"],
    ["Spremljen", "spremljeno (bez pojašnjenja)"],
    ["Spremljena verzija", "spremljeno (bez pojašnjenja)"],
    ["Suspiciously fast", "suspicious"],
    ["Risky paragraphs", "risk"],
    ["Anomaly detected", "anomaly"],
    ["Anomalies", "anomaly"],
    ["Anomalous edits", "anomaly"],
    ["Alerts on students", "warning about the student"],
    ["Percentage of artificial intelligence", "AI percentage"],
    ["Probabilities", "probability"],
    ["Authentic work", "authenticity"],
    ["Authentically written", "authenticity"],
    ["Unauthentic", "authenticity"],
    ["AI-generated text", "written by AI"],
    ["AI-written", "written by AI"],
    ["AI wrote this paragraph", "written by AI"],
    ["Generated by artificial intelligence", "written by AI"],
    ["Proofs of authorship", "proof of authorship"],
    ["Copy-pasted", "copied"],
  ])("flags the form %j as %s", (text, entry) => {
    expect(entries(text)).toContain(entry);
  });

  it("tells Croatian entries from English ones", () => {
    for (const term of FORBIDDEN_TERMS) expect(["hr", "en"], term.entry).toContain(term.lang);
    const croatian = (text: string) => findForbiddenTerms(text, "hr").map((term) => term.entry);
    expect(croatian("Hidden risk, anomaly, saved")).toEqual([]);
    expect(croatian("Hidden rizik")).toEqual(["rizik"]);
    expect(findForbiddenTerms("Hidden rizik", "en").map((term) => term.entry)).toEqual(["hidden"]);
    expect(entries("Hidden rizik")).toEqual(["rizik", "hidden"]);
  });

  it.each([
    "Authenticated",
    "Authenticator app",
    "Postotak riješenih zadataka",
    "Kopija rada",
    "Umjetna inteligencija nije dopuštena u ovom zadatku",
    "AI pomoćnik je napisao prijedlog",
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

  it("reads the props of the project's own components, value and children", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    write(
      "src/components/View.tsx",
      [
        "export const View = ({ n, where, label }: { n: number; where: string; label: unknown }) => (",
        "  <section>",
        '    <Toast message="Copied text" heading="Hidden edits" />',
        '    <Badge children="Risk score" />',
        '    <input type="submit" value="Saved" />',
        '    <Field description={label as string} defaultValue="Probability" />',
        '    <meta name="description" content="Missing data" />',
        "  </section>",
        ");",
        "",
      ].join("\n"),
    );
    expect(scanned()).toEqual([
      ["src/components/View.tsx", 3, ["copied"]],
      ["src/components/View.tsx", 3, ["hidden"]],
      ["src/components/View.tsx", 4, ["risk"]],
      ["src/components/View.tsx", 5, ["saved (without saying where)"]],
      ["src/components/View.tsx", 6, ["probability"]],
      ["src/components/View.tsx", 7, ["missing data"]],
    ]);
  });

  // The components QA reproduced as unread (PR #45, QA of 232c9f4), each reported once.
  it("reads the Croatian component text QA found unread", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    write(
      "src/components/Status.tsx",
      [
        "export const Status = ({ n }: { n: number }) => (",
        "  <section>",
        '    <Toast message="Kopirano" heading="Sumnjivo" />',
        '    <Badge children="Rizik" />',
        '    <input type="submit" value="Spremljeno" />',
        '    <p>{"Spremljeno " + n}</p>',
        "  </section>",
        ");",
        "",
      ].join("\n"),
    );
    expect(scanned()).toEqual([
      ["src/components/Status.tsx", 3, ["kopirano"]],
      ["src/components/Status.tsx", 3, ["sumnjivo"]],
      ["src/components/Status.tsx", 4, ["rizik"]],
      ["src/components/Status.tsx", 5, ["spremljeno (bez pojašnjenja)"]],
      ["src/components/Status.tsx", 6, ["spremljeno (bez pojašnjenja)"]],
    ]);
  });

  it("reads both sides of + and the expressions inside a template", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    write(
      "src/components/Line.tsx",
      [
        "export const Line = ({ n, where, open }: { n: number; where: string; open: boolean }) => (",
        "  <section>",
        '    <p>{"Saved " + n}</p>',
        '    <p>{n + " saved"}</p>',
        '    <p>{"Saved on " + "this device"}</p>',
        '    <p>{"Saved on this device, " + n + " words"}</p>',
        '    <p>{"Proof of " + ("author" + "ship")}</p>',
        '    <p>{where + ": " + (open ? "Missing data" : "Predano")}</p>',
        '    <p>{`Stanje: ${open ? "Hidden edits" : "Predano"}`}</p>',
        '    <Field hint={"Risk " + n} title={`${n} ${"copied" + where}`} />',
        "    <p>{n + n}</p>",
        "  </section>",
        ");",
        "",
      ].join("\n"),
    );
    expect(scanned()).toEqual([
      ["src/components/Line.tsx", 3, ["saved (without saying where)"]],
      ["src/components/Line.tsx", 4, ["saved (without saying where)"]],
      ["src/components/Line.tsx", 7, ["proof of authorship"]],
      ["src/components/Line.tsx", 8, ["missing data"]],
      ["src/components/Line.tsx", 9, ["hidden"]],
      ["src/components/Line.tsx", 10, ["risk"]],
      ["src/components/Line.tsx", 10, ["copied"]],
    ]);
  });

  it("does not read technical attributes, whatever their value", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    const attributes = [...TECHNICAL_ATTRIBUTES, "data-state", "data-risk"];
    write(
      "src/components/Technical.tsx",
      [
        "export const Technical = ({ open }: { open: boolean }) => (",
        "  <section>",
        ...attributes.map((name) => `    <x-item ${name}="hidden saved risk copied" />`),
        ...attributes.map((name) => `    <x-item ${name}={open ? "hidden" : "saved " + "copied"} />`),
        "  </section>",
        ");",
        "",
      ].join("\n"),
    );
    expect(scanned()).toEqual([]);
    expect(attributes.length).toBeGreaterThan(40);
  });

  it("keeps every attribute that carries text off the technical list", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    const attributes = [
      "alt",
      "title",
      "placeholder",
      "label",
      "aria-label",
      "aria-description",
      "aria-placeholder",
      "aria-roledescription",
      "aria-valuetext",
      "value",
      "defaultValue",
      "children",
      "content",
      "message",
      "heading",
      "summary",
    ];
    for (const name of attributes) expect(TECHNICAL_ATTRIBUTES.has(name), name).toBe(false);
    write(
      "src/components/Texts.tsx",
      ["export const Texts = () => (", "  <section>", ...attributes.map((name) => `    <x-item ${name}="Hidden edits" />`), "  </section>", ");", ""].join(
        "\n",
      ),
    );
    expect(scanned()).toEqual(attributes.map((_, index) => ["src/components/Texts.tsx", index + 3, ["hidden"]]));
  });

  it("reads what generateMetadata and generateImageMetadata return", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    write(
      "app/drafts/page.tsx",
      [
        "export async function generateMetadata({ params }: { params: { id: string } }) {",
        '  const address = "/hidden/" + params.id;',
        '  const pick = () => { return "saved"; };',
        '  if (params.id === "risk") return { title: "Copied text" };',
        '  return { title: "Suspicious drafts", alternates: { canonical: address } };',
        "}",
        "export default () => <p>Predano</p>;",
        "",
      ].join("\n"),
    );
    write("app/notes/page.ts", 'export const generateMetadata = async () => ({ title: "Risk score" });\n');
    write("app/review/layout.ts", 'export const generateMetadata = function () {\n  return { description: "Missing data" };\n};\n');
    write("app/icons/icon.tsx", 'export function generateImageMetadata() {\n  return [{ id: "small", alt: "Hidden edits" }];\n}\n');
    write("app/api/status/route.ts", 'export function buildMetadata() {\n  return { title: "Hidden edits" };\n}\n');
    expect(scanned().sort()).toEqual([
      ["app/drafts/page.tsx", 4, ["copied"]],
      ["app/drafts/page.tsx", 5, ["suspicious"]],
      ["app/icons/icon.tsx", 2, ["hidden"]],
      ["app/notes/page.ts", 1, ["risk"]],
      ["app/review/layout.ts", 2, ["missing data"]],
    ]);
  });

  it("reads the web app manifest", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    write(
      "app/manifest.ts",
      'export default function manifest() {\n  return { name: "Ductus risk", short_name: "Ductus", display: "standalone" };\n}\n',
    );
    write("app/pwa/manifest.ts", 'export default () => ({ description: "Proof of authorship" });\n');
    write("app/manifest.json", '{\n  "name": "Ductus",\n  "description": "Hidden edits"\n}\n');
    write("app/pwa/manifest.webmanifest", '{\n  "short_name": "Saved"\n}\n');
    write("app/pwa/settings.json", '{"name": "Hidden edits"}\n');
    write("src/manifest.json", '{"name": "Hidden edits"}\n');
    write("src/manifest.ts", 'export const name = "Hidden edits";\n');
    expect(scanned().sort()).toEqual([
      ["app/manifest.json", 3, ["hidden"]],
      ["app/manifest.ts", 2, ["risk"]],
      ["app/pwa/manifest.ts", 1, ["proof of authorship"]],
      ["app/pwa/manifest.webmanifest", 2, ["saved (without saying where)"]],
    ]);
  });

  it("reads the alt export of opengraph-image and twitter-image", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    write(
      "app/opengraph-image.tsx",
      'export const alt = "Proof of authorship";\nexport const contentType = "image/png";\nexport default () => <div>Predano</div>;\n',
    );
    write("app/drafts/twitter-image.ts", 'export const alt = "Hidden edits";\nexport const runtime = "edge";\n');
    write("app/drafts/image-helpers.ts", 'export const alt = "Hidden edits";\n');
    expect(scanned().sort()).toEqual([
      ["app/drafts/twitter-image.ts", 1, ["hidden"]],
      ["app/opengraph-image.tsx", 1, ["proof of authorship"]],
    ]);
  });

  // The three metadata files QA reproduced as unread (PR #45, QA of 232c9f4).
  it("reads the Croatian metadata QA found unread", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    write("app/x/page.tsx", 'export async function generateMetadata() {\n  return { title: "Sumnjivi radovi" };\n}\n');
    write("app/manifest.ts", 'export default () => ({\n  name: "Ductus rizik",\n});\n');
    write("app/opengraph-image.tsx", 'export const alt = "Dokaz autorstva";\n');
    expect(scanned().sort()).toEqual([
      ["app/manifest.ts", 2, ["rizik"]],
      ["app/opengraph-image.tsx", 1, ["dokaz autorstva"]],
      ["app/x/page.tsx", 2, ["sumnjivo"]],
    ]);
  });

  it("scans a tree that has no app or no src directory", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    expect(scanned()).toEqual([]);
    expect(findMisplacedUiText(root)).toEqual([]);
    write("src/domain/sync/labels.ts", 'export const x = "Hidden edits";\n');
    expect(scanned()).toEqual([["src/domain/sync/labels.ts", 1, ["hidden"]]]);
    rmSync(path.join(root, "src"), { recursive: true, force: true });
    write("app/page.tsx", "export default () => <p>Risk score</p>;\n");
    write("app/api/status/route.ts", 'export const body = { message: "Đak nije pronađen" };\n');
    expect(scanned()).toEqual([["app/page.tsx", 1, ["risk"]]]);
    expect(findMisplacedUiText(root).map((t) => t.file)).toEqual(["app/api/status/route.ts"]);
  });

  // Review of 232c9f4: Croatian entries without a diacritic in a module outside the list.
  it("checks every string of every module against the Croatian entries", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    write("src/domain/sync/state-text.ts", 'export const A = "Spremljeno lokalno";\nexport const B = "Sumnjivo";\n');
    write("app/api/x/route.ts", 'export const GET = () => Response.json({ error: "Rad je skriven" });\n');
    write("src/application/evidence/evidence-outbox.ts", "export const note = (n: number) => `Kopirano ${n} puta`;\n");
    write(
      "src/components/Table.tsx",
      [
        'const COLUMNS = [{ label: "Prepisano" }, { label: "Hidden" }];',
        'const STATES: Record<string, string> = { gap: "Nestali podaci", done: "Predano" };',
        "export const Table = () => (",
        '  <table title="Ocjena rizika">',
        '    <caption>{COLUMNS.length > 1 ? "Dokaz autorstva" : STATES.done}</caption>',
        "  </table>",
        ");",
        "",
      ].join("\n"),
    );
    expect(scanned().sort()).toEqual([
      ["app/api/x/route.ts", 1, ["skriveno"]],
      ["src/application/evidence/evidence-outbox.ts", 1, ["kopirano"]],
      ["src/components/Table.tsx", 1, ["prepisano"]],
      ["src/components/Table.tsx", 2, ["nestali podaci"]],
      ["src/components/Table.tsx", 4, ["rizik"]],
      ["src/components/Table.tsx", 5, ["dokaz autorstva"]],
      ["src/domain/sync/state-text.ts", 1, ["spremljeno (bez pojašnjenja)"]],
      ["src/domain/sync/state-text.ts", 2, ["sumnjivo"]],
    ]);
  });

  it("does not take word lists, keys, types, comments, tests or allowed wording for Croatian entries", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    write(
      "src/domain/diff/diff.ts",
      [
        "// Sumnjivo u komentaru",
        'import { rizik } from "./rizik";',
        'type State = "skriveno" | "kopirano";',
        'const MODALS = new Set(["može", "mogu", "upućuje", "vjerojatno", "navodno", "autentikacija"]);',
        'export const CODES = { "rizik": 1, "spremljeno": 2 };',
        'export const STATE = "Spremljeno na uređaju";',
        "",
      ].join("\n"),
    );
    write("src/domain/diff/diff.test.ts", 'export const x = "Sumnjivo";\n');
    write("src/domain/diff/diff.d.ts", 'export declare const x: "Sumnjivo";\n');
    write("src/domain/diff/words.json", '{"x": "Sumnjivo"}\n');
    expect(scanned()).toEqual([]);
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
      "app/**/manifest.ts",
    ]);
    for (const file of [
      "app/manifest.ts",
      "app/pwa/manifest.ts",
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
      "src/manifest.ts",
      "manifest.ts",
      "app/manifest.tsx",
      "app/pwa/web-manifest.ts",
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

// QA of 39fde31 (PR #45): entities, spaces of every kind and compatibility forms.
describe("text as the browser shows it", () => {
  it.each([
    ["no-break space", " "],
    ["narrow no-break space", " "],
    ["thin space", " "],
    ["en space", " "],
    ["figure space", " "],
    ["ideographic space", "　"],
    ["line separator", " "],
    ["tab", "\t"],
  ])("takes a %s for a space", (_, space) => {
    expect(entries(`Nestali${space}podaci`)).toEqual(["nestali podaci"]);
    expect(entries(`Upozorenje o${space}studentu`)).toEqual(["upozorenje o studentu"]);
    expect(entries(`Missing${space}data`)).toEqual(["missing data"]);
    expect(entries(`Spremljeno${space}na${space}uređaju`)).toEqual([]);
    expect(entries(`Saved${space}on${space}this${space}device`)).toEqual([]);
  });

  it.each([
    ["Ｓｕｍｎｊｉｖｏ", "sumnjivo"],
    ["ＲＩＺＩＫ", "rizik"],
    ["𝐑𝐢𝐳𝐢𝐤", "rizik"],
    ["Ｈｉｄｄｅｎ", "hidden"],
    ["ﬁrst risk", "risk"],
  ])("folds the compatibility form %j to its letters (NFKC)", (text, entry) => {
    expect(entries(text)).toEqual([entry]);
  });

  it("keeps allowed wording allowed in compatibility forms", () => {
    expect(foldText("Ｓｕｍｎｊｉｖｏ")).toBe("sumnjivo");
    expect(entries("Ｓｐｒｅｍｌｊｅｎｏ ｎａ ｕｒｅđａｊｕ")).toEqual([]);
    expect(entries("Ｐｒｅｄａｎｏ")).toEqual([]);
  });

  it("decodes named, decimal and hexadecimal entities", () => {
    expect(decodeEntities("Nestali&nbsp;podaci")).toBe("Nestali podaci");
    expect(decodeEntities("Sum&shy;njivo")).toBe("Sum­njivo");
    expect(decodeEntities("&#83;umnjivo &#x53;umnjivo &#X53;")).toBe("Sumnjivo Sumnjivo &#X53;");
    expect(decodeEntities("&scaron;&Scaron;&amp;&lt;&gt;&quot;&apos;&hellip;&ndash;")).toBe("šŠ&<>\"'…–");
    expect(decodeEntities("&#x1F600;&#128512;")).toBe("😀😀");
    expect(decodeEntities("&nope; &nbsp &; &#; &#x; &#1114112; R&D; a & b")).toBe("&nope; &nbsp &; &#; &#x; &#1114112; R&D; a & b");
    expect(decodeEntities("&amp;nbsp;")).toBe("&nbsp;");
  });

  /** What the TypeScript JSX transform makes of JSX text: the string it passes as the child. */
  const transformed = (jsxTexts: readonly string[]): string[] => {
    const source = `export const all = [${jsxTexts.map((text) => `<a>${text}</a>`).join(", ")}];`;
    const output = ts.transpileModule(source, { fileName: "all.tsx", compilerOptions: { jsx: ts.JsxEmit.React } }).outputText;
    const rendered: string[] = [];
    const visit = (node: ts.Node): void => {
      const child = ts.isCallExpression(node) ? node.arguments[2] : undefined;
      if (child && ts.isStringLiteral(child)) rendered.push(child.text);
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile("all.js", output, ts.ScriptTarget.Latest, true));
    return rendered;
  };

  it("knows the entities the TypeScript JSX transform knows, with the same characters", () => {
    expect(ENTITY_NAMES).toHaveLength(253);
    expect(new Set(ENTITY_NAMES).size).toBe(253);
    const extra = ["&#83;", "&#x53;", "&#x1F600;", "&nope;", "&nbsp", "&Nbsp;"];
    const written = [...ENTITY_NAMES.map((name) => `&${name};`), ...extra].map((entity) => `x${entity}x`);
    expect(transformed(written)).toEqual(written.map(decodeEntities));
  });

  it.each([
    ["Nestali podaci", "Nestali podaci"],
    ["  Nestali  podaci  ", "  Nestali  podaci  "],
    ["\n      Nestali\n      podaci\n    ", "Nestali podaci"],
    ["\n      Nestali  \r\n\t podaci\n", "Nestali podaci"],
    ["Nestali\n\n\n   podaci", "Nestali podaci"],
    [" Sum\n   ", " Sum"],
    ["\n   njivo ", "njivo "],
    ["\n    ", ""],
    [" ", " "],
    ["Nestali&nbsp;\n  podaci", "Nestali  podaci"],
    ["&#83;um&shy;njivo", "Sum­njivo"],
  ])("reads JSX text %j as React renders it", (raw, value) => {
    expect(jsxTextValue(raw)).toBe(value);
  });

  it("reads JSX text the way the TypeScript JSX transform emits it", () => {
    const texts = [
      "Nestali podaci",
      "\n      Nestali\n      podaci\n    ",
      "\n      Nestali  \n\t podaci\n",
      "Nestali\n\n\n   podaci",
      " Sum\n   ",
      "\n   njivo ",
      "  dva  razmaka  ",
      "Nestali&nbsp;\n  podaci",
      "Spremljeno&nbsp;na&nbsp;uređaju",
    ];
    expect(texts.map(jsxTextValue)).toEqual(transformed(texts));
  });

  it("reports an entry in either reading of markup, a contextual entry only in both", () => {
    const inMarkup = (joined: string, spaced: string) => findForbiddenTermsInMarkup(joined, spaced).map((term) => term.entry);
    expect(inMarkup("Sumnjivo", "Sum njivo")).toEqual(["sumnjivo"]);
    expect(inMarkup("Nestalipodaci", "Nestali podaci")).toEqual(["nestali podaci"]);
    expect(inMarkup("Spremljeno", "Spremljeno")).toEqual(["spremljeno (bez pojašnjenja)"]);
    expect(inMarkup("Spremljeno na uređajuPredano", "Spremljeno na uređaju Predano")).toEqual([]);
    expect(inMarkup("Saved on this deviceSubmitted", "Saved on this device Submitted")).toEqual([]);
    expect(inMarkup("Spremljeno lokalno", "Spremljeno  lokalno")).toEqual(["spremljeno (bez pojašnjenja)"]);
    expect(FORBIDDEN_TERMS.filter((term) => term.contextual).map((term) => term.entry)).toEqual([
      "spremljeno (bez pojašnjenja)",
      "saved (without saying where)",
    ]);
  });

  // Finding of the review of 51fbabb: an element that splits the word itself must not hide it.
  it("reports a contextual entry whose word an element split, unless the joined text says where", () => {
    const inMarkup = (joined: string, spaced: string) => findForbiddenTermsInMarkup(joined, spaced).map((term) => term.entry);
    expect(inMarkup("Spremljeno", "S premljeno")).toEqual(["spremljeno (bez pojašnjenja)"]);
    expect(inMarkup("Spremljeno", "Sprem ljeno")).toEqual(["spremljeno (bez pojašnjenja)"]);
    expect(inMarkup("Spremljena", "Spremlje na")).toEqual(["spremljeno (bez pojašnjenja)"]);
    expect(inMarkup("Saved", "S aved")).toEqual(["saved (without saying where)"]);
    expect(inMarkup("Saved locally", "Sa ved locally")).toEqual(["saved (without saying where)"]);
    expect(inMarkup("Spremljeno na uređaju", "S premljeno na uređaju")).toEqual([]);
    expect(inMarkup("Saved on this device", "S aved on this device")).toEqual([]);
    // The whole word of one language does not clear the split word of the other.
    expect(inMarkup("Saved Spremljeno na uređajuPredano", "S aved Spremljeno na uređaju Predano")).toEqual(["saved (without saying where)"]);
  });

  it("gives every contextual entry the word alone as a literal that covers every form the entry covers", () => {
    const forms = ["spremljeno", "spremljena", "spremljen", "spremljenih", "saved"];
    for (const term of FORBIDDEN_TERMS.filter((entry) => entry.contextual)) {
      const word = term.contextual!.word;
      expect(word.flags, term.entry).toBe("u");
      const covered = forms.filter((form) => term.pattern.test(form));
      expect(covered.length, term.entry).toBeGreaterThan(0);
      for (const form of covered) {
        expect(word.test(form), form).toBe(true);
        expect(word.test(`${form} na uredaju`), form).toBe(true);
        expect(word.test(`${form} on this device`), form).toBe(true);
        expect(word.test(`ne${form}`), form).toBe(false);
        expect(word.test(`${form}9`), form).toBe(false);
      }
    }
  });
});

describe("markup in component text", () => {
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
  const scanned = () => scanUiText(root!).map((f) => [f.file, f.line, f.terms.map((t) => t.entry)]);
  const component = (lines: readonly string[]): string =>
    ["export const View = ({ a, b, n, items, where }: Props) => (", "  <section>", ...lines.map((line) => `    ${line}`), "  </section>", ");", ""].join(
      "\n",
    );

  // Finding 1 of the QA of 39fde31, example by example.
  it("decodes HTML entities in JSX text", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    write(
      "src/components/Entities.tsx",
      component([
        "<p>Nestali&nbsp;podaci</p>",
        "<p>Dokaz&nbsp;autorstva</p>",
        "<p>Upozorenje o&nbsp;studentu</p>",
        "<p>Missing&nbsp;data</p>",
        "<p>Sum&shy;njivo</p>",
        "<p>&#83;umnjivo</p>",
        "<p>&#x53;umnjivo</p>",
        "<p>Spremljeno&nbsp;na&nbsp;uređaju</p>",
        "<p>Saved&nbsp;on&#32;this&#x20;device</p>",
        "<p>Vi&scaron;e&hellip; R&amp;D &lt;2&gt; &copy; &nope; &amp;shy;</p>",
        "<p>Skriven&#111;</p>",
        "<p>Spremljeno&nbsp;lokalno</p>",
      ]),
    );
    expect(scanned()).toEqual([
      ["src/components/Entities.tsx", 3, ["nestali podaci"]],
      ["src/components/Entities.tsx", 4, ["dokaz autorstva"]],
      ["src/components/Entities.tsx", 5, ["upozorenje o studentu"]],
      ["src/components/Entities.tsx", 6, ["missing data"]],
      ["src/components/Entities.tsx", 7, ["sumnjivo"]],
      ["src/components/Entities.tsx", 8, ["sumnjivo"]],
      ["src/components/Entities.tsx", 9, ["sumnjivo"]],
      ["src/components/Entities.tsx", 13, ["skriveno"]],
      ["src/components/Entities.tsx", 14, ["spremljeno (bez pojašnjenja)"]],
    ]);
  });

  it("decodes HTML entities in attribute strings, and reads a no-break space in a JS string as a space", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    write(
      "src/components/Attributes.tsx",
      component([
        '<img alt="Nestali&nbsp;podaci" />',
        '<input placeholder="Sum&shy;njivo" title="&#72;idden edits" />',
        '<img alt="Spremljeno&nbsp;na&nbsp;uređaju" />',
        '<a href="/pregled?a=1&amp;b=2" className="red&nbsp;saved" data-note="Hid&#100;en">Dalje</a>',
        '<p>{"Nestali\\u00A0podaci"}</p>',
        '<p>{"Upozorenje o\\u00A0studentu"}</p>',
        '<p>{"Spremljeno\\u00A0na\\u00A0uređaju"}</p>',
        '<p title={"Dokaz\\u202Fautorstva"}>{`Missing\\u00A0data`}</p>',
        // In a JS string an entity is not decoded: the person sees the characters as written.
        '<p>{"Spremljeno na&nbsp;uređaju"}</p>',
      ]),
    );
    expect(scanned()).toEqual([
      ["src/components/Attributes.tsx", 3, ["nestali podaci"]],
      ["src/components/Attributes.tsx", 4, ["sumnjivo"]],
      ["src/components/Attributes.tsx", 4, ["hidden"]],
      ["src/components/Attributes.tsx", 7, ["nestali podaci"]],
      ["src/components/Attributes.tsx", 8, ["upozorenje o studentu"]],
      ["src/components/Attributes.tsx", 10, ["dokaz autorstva"]],
      ["src/components/Attributes.tsx", 10, ["missing data"]],
      ["src/components/Attributes.tsx", 11, ["spremljeno (bez pojašnjenja)"]],
    ]);
  });

  // Finding 2 of the QA of 39fde31, example by example.
  it("reads text split by elements or by a space expression as one text", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    write(
      "src/components/Split.tsx",
      component([
        "<p>Nestali <strong>podaci</strong></p>",
        "<p>Napisao <em>AI</em></p>",
        '<p>Verificirano{" "}autorstvo</p>',
        "<p>Sum<b>njivo</b></p>",
        "<p>Hid<b>den</b></p>",
        "<p>Spremljeno <b>na uređaju</b></p>",
        '<p>Spremljeno{" "}na uređaju</p>',
      ]),
    );
    expect(scanned()).toEqual([
      ["src/components/Split.tsx", 3, ["nestali podaci"]],
      ["src/components/Split.tsx", 4, ["napisao AI"]],
      ["src/components/Split.tsx", 5, ["verificirano autorstvo"]],
      ["src/components/Split.tsx", 6, ["sumnjivo"]],
      ["src/components/Split.tsx", 7, ["hidden"]],
    ]);
  });

  // Finding of the review of 51fbabb, example by example.
  it("reads a contextual word that an element splits as the word a person sees", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    write(
      "src/components/SplitWord.tsx",
      component([
        "<p><b>S</b>premljeno</p>",
        "<p>Sprem<span>ljeno</span></p>",
        "<p><strong>S</strong>aved</p>",
        "<p>Spre<b>mljeno</b></p>",
        "<h2>Spremljen<em>o</em></h2>",
        "<p>Spremljeno <b>na uređaju</b></p>",
        '<p>Spremljeno{" "}na uređaju</p>',
        "<div><span>Spremljeno na uređaju</span><span>Predano</span></div>",
        "<p><b>S</b>premljeno na uređaju</p>",
      ]),
    );
    expect(scanned()).toEqual([
      ["src/components/SplitWord.tsx", 3, ["spremljeno (bez pojašnjenja)"]],
      ["src/components/SplitWord.tsx", 4, ["spremljeno (bez pojašnjenja)"]],
      ["src/components/SplitWord.tsx", 5, ["saved (without saying where)"]],
      ["src/components/SplitWord.tsx", 6, ["spremljeno (bez pojašnjenja)"]],
      ["src/components/SplitWord.tsx", 7, ["spremljeno (bez pojašnjenja)"]],
    ]);
  });

  it("still reports a piece that is forbidden by itself, on its own line", () => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    write(
      "src/components/Pieces.tsx",
      component([
        "<p>Sumnjivo <b>lijepljenje</b></p>",
        "<p>Rad je <b>skriven</b></p>",
        "<p>Spremljeno <b>lokalno</b></p>",
        "<p><b>Spremljeno</b></p>",
        "<p>",
        "  Predano u roku.",
        "  <em>",
        "    Ocjena rizika",
        "  </em>",
        "  je u izradi, a",
        "  dokaz",
        "  <strong>autorstva</strong> nije.",
        "</p>",
        "<p>Sumnjivo <b>sumnjivo</b> sumnjivo</p>",
        "<div>Kopirano <p>Kopirano</p></div>",
      ]),
    );
    expect(scanned()).toEqual([
      ["src/components/Pieces.tsx", 3, ["sumnjivo"]],
      ["src/components/Pieces.tsx", 4, ["skriveno"]],
      ["src/components/Pieces.tsx", 5, ["spremljeno (bez pojašnjenja)"]],
      ["src/components/Pieces.tsx", 6, ["spremljeno (bez pojašnjenja)"]],
      ["src/components/Pieces.tsx", 8, ["dokaz autorstva"]],
      ["src/components/Pieces.tsx", 10, ["rizik"]],
      ["src/components/Pieces.tsx", 16, ["sumnjivo"]],
      ["src/components/Pieces.tsx", 16, ["sumnjivo"]],
      ["src/components/Pieces.tsx", 16, ["sumnjivo"]],
      ["src/components/Pieces.tsx", 17, ["kopirano"]],
      ["src/components/Pieces.tsx", 17, ["kopirano"]],
    ]);
  });

  it("lists the inline elements, none of them a block, a control or a component", () => {
    expect(INLINE_ELEMENTS.size).toBeGreaterThan(20);
    for (const name of INLINE_ELEMENTS) expect(name, name).toMatch(/^[a-z]+$/);
    for (const name of ["p", "div", "li", "td", "th", "h1", "button", "label", "option", "br", "Badge", "section"]) {
      expect(INLINE_ELEMENTS.has(name), name).toBe(false);
    }
  });

  // Ordinary formatting, attacked before the third QA round: what it is, the JSX, the entries it must be reported for.
  const FORMATTING: readonly [string, readonly string[], readonly string[]][] = [
    ["text over several lines", ["<p>", "  Nestali", "  podaci", "</p>"], ["nestali podaci"]],
    ["allowed text over several lines", ["<p>", "  Spremljeno", "  na uređaju", "</p>"], []],
    ["line break before an inline element", ["<p>", '  Dokaz{" "}', "  <strong>autorstva</strong>", "</p>"], ["dokaz autorstva"]],
    ["allowed line break before an inline element", ["<p>", '  Spremljeno{" "}', "  <b>na uređaju</b>", "</p>"], []],
    ["first word emphasised", ["<p><strong>Spremljeno</strong> na poslužitelju</p>"], []],
    ["first word emphasised, forbidden", ["<p><strong>Verificirano</strong> autorstvo</p>"], ["verificirano autorstvo"]],
    ["nested inline elements", ["<p>Ovo je <span><em>napisao</em></span> <abbr>AI</abbr></p>"], ["napisao AI"]],
    ["allowed nested inline elements", ["<p><span><b>Spremljeno</b></span> <i>na <u>uređaju</u></i></p>"], []],
    ["a word split twice", ["<p>Rad je autenti<span>č</span><b>an</b></p>"], ["autentičnost"]],
    ["capitals split by an element", ["<h2>SUM<b>NJIVO</b></h2>"], ["sumnjivo"]],
    ["fragment", ["<>Nestali <i>podaci</i></>"], ["nestali podaci"]],
    ["allowed fragment", ["<><b>Saved</b> on this device</>"], []],
    ["fragment inside an element", ["<p><>Proof</> of <>authorship</></p>"], ["proof of authorship"]],
    ["conditional tail", ['<p>Nestali {a ? "podaci" : "zapisi"}</p>'], ["nestali podaci"]],
    ["allowed conditional tail", ['<p>Spremljeno {a ? "na poslužitelju" : "na uređaju"}</p>'], []],
    ["conditional tail, one branch bare", ['<p>Spremljeno {a ? "na poslužitelju" : "lokalno"}</p>'], ["spremljeno (bez pojašnjenja)"]],
    ["conditional head", ['<p>{a ? "Dokaz" : "Potvrda"} autorstva</p>'], ["dokaz autorstva"]],
    ["two conditionals", ['<p>{a ? "Missing" : "No"} {b ? "data" : "words"}</p>'], ["missing data"]],
    ["conditional elements", ["<div>{a ? <p>Nestali podaci</p> : <p>Predano</p>}</div>"], ["nestali podaci"]],
    ["&& with an element", ["<p>Verificirano {a && <b>autorstvo</b>}</p>"], ["verificirano autorstvo"]],
    ["&& that may leave the word bare", ["<p>Spremljeno {a && <b>na uređaju</b>}</p>"], ["spremljeno (bez pojašnjenja)"]],
    ["allowed && with the whole phrase", ["<p>{a && <b>Spremljeno na uređaju</b>}</p>"], []],
    ["&& with a forbidden element", ["<p>Stanje: {a && <span>skriveno</span>}</p>"], ["skriveno"]],
    ["|| with a fallback", ['<p>Nestali {where || "podaci"}</p>'], ["nestali podaci"]],
    ["list items", ["<ul>{items.map((item) => <li key={item}>Rizik: {item}</li>)}</ul>"], ["rizik"]],
    [
      "list items with markup",
      ["<ul>", "  {items.map((item) => (", "    <li key={item}>", "      Nestali <b>podaci</b> {item}", "    </li>", "  ))}", "</ul>"],
      ["nestali podaci"],
    ],
    ["allowed list items", ["<ul>{items.map((item) => (<li key={item}>Spremljeno na uređaju: {item}</li>))}</ul>"], []],
    ["a bare list item beside its place", ["<ul><li>Spremljeno</li><li>na uređaju</li></ul>"], ["spremljeno (bez pojašnjenja)"]],
    ["allowed labels side by side", ["<div><span>Spremljeno na uređaju</span><span>Predano</span></div>"], []],
    ["allowed labels on separate lines", ["<div>", "  <span>Saved on this device</span>", "  <span>Submitted</span>", "</div>"], []],
    ["allowed blocks in a row", ["<div><h2>Stanje</h2><p>Spremljeno na uređaju</p><p>Predano</p></div>"], []],
    ["phrase spread over blocks", ["<div>Nestali<p>podaci</p></div>"], ["nestali podaci"]],
    ["line break element", ["<td>Nestali<br />podaci</td>"], ["nestali podaci"]],
    ["allowed line break element", ["<td>Spremljeno<br />na uređaju</td>"], []],
    ["word break opportunity", ["<p>Sum<wbr />njivo</p>"], ["sumnjivo"]],
    ["component children", ["<Trans>Nestali <Bold>podaci</Bold></Trans>"], ["nestali podaci"]],
    ["a component is a text of its own", ["<Badge>Saved</Badge>"], ["saved (without saying where)"]],
    ["element in a prop", ["<Row label={<>Dokaz <b>autorstva</b></>} />"], ["dokaz autorstva"]],
    ["allowed element in a prop", ["<Row label={<><b>Spremljeno</b> na uređaju</>} />"], []],
    ["template with a conditional", ['<p>{`Spremljeno ${a ? "na poslužitelju" : "na uređaju"}`}</p>'], []],
    ["template with a forbidden branch", ['<p>{`Nestali ${a ? "podaci" : "zapisi"}`}</p>'], ["nestali podaci"]],
    ["+ with a conditional in a prop", ['<Field hint={"Spremljeno " + (a ? "na uređaju" : "na poslužitelju")} />'], []],
    ["+ with a bare branch in a prop", ['<Field hint={"Saved " + (a ? "on this device" : "locally")} />'], ["saved (without saying where)"]],
    ["comment between the words", ["<p>Spremljeno {/* gdje */} na uređaju</p>"], []],
    ["empty string between the halves", ['<p>Sum{""}njivo</p>'], ["sumnjivo"]],
    ["entities and markup together", ["<p>Spremljeno&nbsp;<b>na&nbsp;poslužitelju</b>.</p>"], []],
    ["entities and markup together, forbidden", ["<p>Upozorenje&nbsp;<i>o&nbsp;studentu</i></p>"], ["upozorenje o studentu"]],
    ["entity split by an element", ["<p>&#83;um<b>nji&shy;vo</b></p>"], ["sumnjivo"]],
    ["computed value after allowed text", ["<p>Spremljeno na uređaju u {n}</p>"], []],
    ["computed value before a forbidden word", ["<p>{n} skrivenih</p>"], ["skriveno"]],
    ["computed value after a bare word", ["<p>Spremljeno {where}</p>"], ["spremljeno (bez pojašnjenja)"]],
    ["entities in technical attributes", ['<a href="/a?x=1&amp;saved=1" className="hidden&nbsp;risk" id="copied&#45;1">Dalje</a>'], []],
    ["English emphasis", ["<p>Written <i>by</i> AI</p>"], ["written by AI"]],
    ["English allowed emphasis", ["<p>Saved <strong>to your device</strong></p>"], []],
    ["heading next to a paragraph", ["<div><h1>AI pomoćnik</h1><p>Postotak riješenih zadataka</p></div>"], []],
    [
      "more alternatives than are kept",
      ["<p>", ...Array.from({ length: 8 }, (_, i) => `  {a${i} ? "da" : "ne"}`), '  {a ? "Nestali podaci" : "Predano"}', "</p>"],
      ["nestali podaci"],
    ],
    [
      "more alternatives than are kept, in elements of their own",
      ["<div>", ...Array.from({ length: 8 }, (_, i) => `  <p>{a${i} ? "da" : "ne"}</p>`), '  <p>Spremljeno {a ? "na uređaju" : "na poslužitelju"}</p>', "</div>"],
      [],
    ],
    ["element without children between the words", ["<p>Nestali <Icon /> podaci</p>"], ["nestali podaci"]],
    ["line break before an inline element, no space expression", ["<p>", "  Nestali", "  <strong>podaci</strong>", "</p>"], ["nestali podaci"]],
    ["link inside the allowed phrase", ['<p>Spremljeno na <a href="/uredaj">uređaju</a></p>'], []],
    ["element inside the allowed word", ["<p>Spremljeno na ure<b>đaju</b></p>"], []],
    ["conditional fragments", ["<p>Spremljeno {a ? <>na poslužitelju</> : <>na uređaju</>}</p>"], []],
    ["conditional in a text attribute", ['<button title={a ? "Saved" : "Predano"}>Dalje</button>'], ["saved (without saying where)"]],
    ["computed value between the words", ["<p>Nestali{where}podaci</p>"], ["nestali podaci"]],
    ["null branch", ['<p>Dokaz {a ? null : "autorstva"}</p>'], ["dokaz autorstva"]],
    ["table header cells", ["<tr><th>Stanje</th><th>Spremljeno na poslužitelju</th><th>Riječi</th></tr>"], []],
    ["description list", ["<dl><dt>Stanje</dt><dd>Spremljeno</dd></dl>"], ["spremljeno (bez pojašnjenja)"]],
    // Finding of the review of 51fbabb: an element inside the word itself.
    ["first letter of a bare word emphasised", ["<p><b>S</b>premljeno</p>"], ["spremljeno (bez pojašnjenja)"]],
    ["bare word split by a span", ["<p>Sprem<span>ljeno</span></p>"], ["spremljeno (bez pojašnjenja)"]],
    ["bare word split in the middle", ["<p>Spre<b>mljeno</b></p>"], ["spremljeno (bez pojašnjenja)"]],
    ["bare word with its last letter emphasised", ["<h2>Spremljen<em>o</em></h2>"], ["spremljeno (bez pojašnjenja)"]],
    ["first letter of a bare English word emphasised", ["<p><strong>S</strong>aved</p>"], ["saved (without saying where)"]],
    ["bare word split twice", ["<p>S<b>prem</b>lj<i>eno</i></p>"], ["spremljeno (bez pojašnjenja)"]],
    ["split word followed by another word", ["<p><b>S</b>premljeno lokalno</p>"], ["spremljeno (bez pojašnjenja)"]],
    ["split word in a conditional", ['<p>{a ? <><b>S</b>aved</> : "Predano"}</p>'], ["saved (without saying where)"]],
    ["allowed split word with its place", ["<p><b>S</b>premljeno na uređaju</p>"], []],
    ["allowed split English word with its place", ["<p><strong>S</strong>aved on this device</p>"], []],
    ["allowed split word with its place in an element", ["<p>Sprem<span>ljeno</span> <b>na poslužitelju</b></p>"], []],
  ];

  it.each(FORMATTING)("reads ordinary formatting: %s", (_, lines, expected) => {
    root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    const source = ["export const Case = ({ a, b, n, items, where }: Props) => (", ...lines.map((line) => `  ${line}`), ");", ""];
    write("src/components/Case.tsx", source.join("\n"));
    const found = scanUiText(root);
    // Each entry is reported, and reported once.
    expect(found.flatMap((f) => f.terms.map((t) => t.entry))).toEqual(expected);
    for (const finding of found) {
      expect(finding.file).toBe("src/components/Case.tsx");
      expect(finding.line).toBeGreaterThan(1);
      expect(finding.line).toBeLessThanOrEqual(lines.length + 1);
    }
  });
});

// QA of fdbd6de (PR #45): the words that make "spremljeno" or "saved" acceptable must follow in the same phrase.
describe("phrase boundary of the contextual entries", () => {
  const HR = "spremljeno (bez pojašnjenja)";
  const EN = "saved (without saying where)";
  const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

  // The eight strings of the finding, as written there.
  it.each([
    ["Spremljeno. Na uređaju nema drugih promjena.", HR],
    ["Spremljeno, na poslužitelju još nije.", HR],
    ["Spremljeno! Na poslužitelju je i dalje stara verzija.", HR],
    ["Spremljeno? Na uređaju da, na poslužitelju ne.", HR],
    ["Spremljeno\nNa uređaju", HR],
    ["Saved. On the server: 2 changes waiting.", EN],
    ["Saved — on the server nothing yet.", EN],
    ["Saved? On this device, yes.", EN],
  ])("flags %j, where the next sentence or clause starts with the place", (text, entry) => {
    expect(entries(text)).toEqual([entry]);
  });

  /** The plan of attack from the PR description: what stands between the word and the place, and whether it ends the phrase. */
  const PHRASE_BOUNDARY: readonly [row: string, between: string, ends: boolean][] = [
    ["1 one space", " ", false],
    ["2 two spaces", "  ", false],
    ["2 many spaces", "       ", false],
    ["3 no-break space", cp(0xa0), false],
    ["3 narrow no-break space", cp(0x202f), false],
    ["3 thin space", cp(0x2009), false],
    ["3 en space", cp(0x2002), false],
    ["3 figure space", cp(0x2007), false],
    ["3 ideographic space", cp(0x3000), false],
    ["3 a space and a no-break space", ` ${cp(0xa0)}`, false],
    ["4 tab", "\t", false],
    ["4 tab between spaces", " \t ", false],
    ["5 line separator U+2028", cp(0x2028), false],
    ["6 line feed", "\n", true],
    ["6 carriage return and line feed", "\r\n", true],
    ["6 carriage return", "\r", true],
    ["6 line feed between spaces", " \n ", true],
    ["6 two line feeds", "\n\n", true],
    ["6 paragraph separator U+2029", cp(0x2029), true],
    ["6 next line U+0085", cp(0x85), true],
    ["6 vertical tab", "\v", true],
    ["6 form feed", "\f", true],
    ["8 full stop", ". ", true],
    ["8 full stop, no space", ".", true],
    ["9 exclamation mark", "! ", true],
    ["10 question mark", "? ", true],
    ["11 ellipsis", `${cp(0x2026)} `, true],
    ["11 three full stops", "... ", true],
    ["12 semicolon", "; ", true],
    ["13 colon", ": ", true],
    ["14 comma", ", ", true],
    ["14 comma, no space", ",", true],
    ["15 en dash between spaces", ` ${cp(0x2013)} `, true],
    ["15 em dash between spaces", ` ${cp(0x2014)} `, true],
    ["15 hyphen between spaces", " - ", true],
    ["15 minus sign between spaces", ` ${cp(0x2212)} `, true],
    ["16 hyphen, no spaces", "-", true],
    ["16 en dash, no spaces", cp(0x2013), true],
    ["16 em dash, no spaces", cp(0x2014), true],
    ["16 non-breaking hyphen", cp(0x2011), true],
    ["17 opening parenthesis", " (", true],
    ["17 closing parenthesis", ") ", true],
    ["17 square bracket", " [", true],
    ["17 curly bracket", " {", true],
    ["18 straight double quote", ' "', true],
    ["18 straight single quote", " '", true],
    ["18 low double quote", ` ${cp(0x201e)}`, true],
    ["18 left double quote", ` ${cp(0x201c)}`, true],
    ["18 right double quote", `${cp(0x201d)} `, true],
    ["18 left single quote", ` ${cp(0x2018)}`, true],
    ["18 right single quote", `${cp(0x2019)} `, true],
    ["18 left guillemet", ` ${cp(0xab)}`, true],
    ["18 right guillemet", ` ${cp(0xbb)}`, true],
    ["18 single guillemets", ` ${cp(0x203a)}${cp(0x2039)} `, true],
    ["19 check mark", ` ${cp(0x2713)} `, true],
    ["19 check mark emoji", ` ${cp(0x2705)} `, true],
    ["19 emoji with a variation selector", ` ${cp(0x2714, 0xfe0f)} `, true],
    ["19 bullet", ` ${cp(0x2022)} `, true],
    ["19 middle dot", ` ${cp(0xb7)} `, true],
    ["19 slash", " / ", true],
    ["19 slash, no spaces", "/", true],
    ["19 vertical bar", " | ", true],
    ["19 arrow", ` ${cp(0x2192)} `, true],
    ["19 plus", " + ", true],
    ["19 equals", " = ", true],
    ["19 asterisk", " * ", true],
    ["19 ampersand", " & ", true],
    ["19 underscore", "_", true],
    ["20 number", " 2 ", true],
    ["20 number in brackets", " (2) ", true],
    ["21 conjunction", " i ", true],
    ["21 English conjunction", " and ", true],
    ["21 another word", " samo ", true],
    ["22 negation after a comma", ", ali ne ", true],
    ["22 negation", " ne ", true],
    ["22 English negation", " not ", true],
    ["34 HTML5 entity name that JSX leaves as written", "&period; ", true],
    ["34 HTML5 entity name for a comma", "&comma; ", true],
    ["35 soft hyphen before the space", `${cp(0xad)} `, false],
    ["35 zero width space after the space", ` ${cp(0x200b)}`, false],
  ];

  const PLACES_HR = ["na uređaju", "na poslužitelju", "Na uređaju", "NA POSLUŽITELJU"];
  const PLACES_EN = ["on this device", "on the server", "to your device", "on device", "On the server", "to the server"];

  it.each(PHRASE_BOUNDARY)("row %s between the word and the place", (_, between, ends) => {
    for (const word of ["Spremljeno", "spremljena", "SPREMLJENO", "Promjene su spremljene"]) {
      for (const place of PLACES_HR) {
        expect(entries(`${word}${between}${place}`), `${word}|${place}`).toEqual(ends ? [HR] : []);
        expect(entries(`Stanje: ${word}${between}${place}. Predano.`), `${word}|${place}`).toEqual(ends ? [HR] : []);
      }
    }
    for (const word of ["Saved", "saved", "SAVED", "All changes saved"]) {
      for (const place of PLACES_EN) {
        expect(entries(`${word}${between}${place}`), `${word}|${place}`).toEqual(ends ? [EN] : []);
        expect(entries(`Status: ${word}${between}${place}. Submitted.`), `${word}|${place}`).toEqual(ends ? [EN] : []);
      }
    }
  });

  // Row 36: an invisible character in place of the space leaves the words run together.
  it("flags the Croatian word run together with the place by an invisible character", () => {
    expect(entries(`Spremljeno${cp(0x200b)}na uređaju`)).toEqual([HR]);
    expect(entries(`Spremljeno${cp(0xad)}na poslužitelju`)).toEqual([HR]);
    expect(entries("Spremljenona uređaju")).toEqual([HR]);
  });

  // Row 37: the place itself must be one phrase.
  it.each([
    ["Spremljeno na, uređaju", HR],
    ["Spremljeno na. Uređaju", HR],
    ["Spremljeno na\nposlužitelju", HR],
    ["Spremljeno na (uređaju)", HR],
    ["Spremljeno na - poslužitelju", HR],
    ["Spremljeno na svakom uređaju", HR],
    ["Spremljeno na uređajima", HR],
    ["Saved on. The server", EN],
    ["Saved on the, server", EN],
    ["Saved on this\ndevice", EN],
    ["Saved on the (server)", EN],
    ["Saved on - device", EN],
    ["Saved on the new server", EN],
    ["Saved on devices", EN],
  ])("flags %j, where the place is not one phrase", (text, entry) => {
    expect(entries(text)).toEqual([entry]);
  });

  // Rows 23, 38 and 40: the whole phrase, whatever stands before or after it.
  it.each([
    "Spremljeno na uređaju",
    "Spremljeno na uređaju.",
    "Spremljeno na poslužitelju, predano.",
    "Spremljeno na uređaju!",
    "Spremljeno na uređaju?",
    "Spremljeno na uređaju; predano.",
    "Spremljeno na uređaju: 14:05",
    "Spremljeno na uređaju – 14:05",
    "Spremljeno na uređaju\nPredano",
    "Spremljeno na uređaju (prije 2 minute)",
    "(spremljeno na uređaju)",
    "„Spremljeno na poslužitelju”",
    "Stanje: spremljeno na uređaju.",
    "Stanje – spremljeno na poslužitelju",
    "✓ Spremljeno na uređaju",
    "Nije spremljeno na uređaju",
    "Nije spremljeno na poslužitelju.",
    "Još nije spremljeno na poslužitelju, ali je spremljeno na uređaju.",
    "Spremljeno na uređaju. Spremljeno na poslužitelju. Predano.",
    "Spremljeno na uređaju i na poslužitelju",
    "Predano",
    "Predano.",
    "Predano. Spremljeno na poslužitelju.",
    "Saved on device",
    "Saved on device.",
    "Saved on this device.",
    "Saved on the server, submitted.",
    "Saved to your device (2 minutes ago)",
    "Status: saved on the server.",
    "Not saved on this device",
    "Saved on this device. Saved on the server. Submitted.",
    "Submitted.",
  ])("allows %j", (text) => {
    expect(entries(text)).toEqual([]);
  });

  // Rows 24 and 39, and a bare word next to a whole phrase.
  it.each([
    ["Na uređaju: spremljeno", HR],
    ["Na uređaju spremljeno", HR],
    ["Na poslužitelju je spremljeno.", HR],
    ["Spremljeno. Predano.", HR],
    ["Spremljeno, predano", HR],
    ["Spremljeno i predano", HR],
    ["Predano. Spremljeno.", HR],
    ["Spremljeno na uređaju. Spremljeno.", HR],
    ["Spremljeno. Spremljeno na uređaju.", HR],
    ["Spremljeno na uređaju, spremljeno i ovdje", HR],
    ["Nije spremljeno. Na uređaju nema mjesta.", HR],
    ["On this device: saved", EN],
    ["On the server, saved.", EN],
    ["Saved. Submitted.", EN],
    ["Saved, submitted", EN],
    ["Saved on this device. Saved.", EN],
    ["Saved. Saved on this device.", EN],
  ])("flags %j", (text, entry) => {
    expect(entries(text)).toEqual([entry]);
  });

  // Found in the author's own attack: a digit that touches the word hid it.
  it.each([
    ["Spremljeno1", HR],
    ["Spremljeno¹", HR],
    ["3Spremljeno", HR],
    ["Spremljeno2 na uređaju", HR],
    ["Spremljena3. Na poslužitelju", HR],
    ["Saved2", EN],
    ["2saved", EN],
    ["Saved1 on this device", EN],
  ])("flags %j, where a digit touches the word", (text, entry) => {
    expect(entries(text)).toEqual([entry]);
  });

  it("keeps where a phrase ends in the folded text of a contextual entry, and only there", () => {
    expect(PHRASE_BREAK).not.toMatch(/[ \p{L}\p{N}]/u);
    expect(foldPhrases("Spremljeno. Na uređaju")).toBe(`spremljeno${PHRASE_BREAK}na uredaju`);
    expect(foldPhrases(`  Spremljeno \t na${cp(0xa0)}uređaju.  `)).toBe("spremljeno na uredaju");
    expect(foldPhrases("Saved — on the server (2)")).toBe(`saved${PHRASE_BREAK}on the server${PHRASE_BREAK}2`);
    expect(foldPhrases("a , . ! b")).toBe(`a${PHRASE_BREAK}b`);
    expect(foldPhrases(" – ")).toBe("");
    // Text without punctuation folds the same either way.
    for (const text of ["Spremljeno na uređaju", "ČĆŽŠĐ  čćžšđ", "Ｓａｖｅｄ on device", `Skri${cp(0xad)}ven`]) {
      expect(foldPhrases(text)).toBe(foldText(text));
    }
    // Every other entry is still matched across punctuation, as before.
    expect(entries("Nestali. Podaci")).toEqual(["nestali podaci"]);
    expect(entries("Dokaz, autorstva")).toEqual(["dokaz autorstva"]);
    expect(entries("Verified\nauthorship")).toEqual(["verified authorship"]);
    expect(entries("Missing - data")).toEqual(["missing data"]);
  });

  it("keeps the phrase boundary in both readings of markup", () => {
    const inMarkup = (joined: string, spaced: string) => findForbiddenTermsInMarkup(joined, spaced).map((term) => term.entry);
    expect(inMarkup("Spremljeno. Na uređaju", "Spremljeno.  Na uređaju")).toEqual([HR]);
    expect(inMarkup("Spremljeno, na poslužitelju", "Spremljeno , na poslužitelju")).toEqual([HR]);
    expect(inMarkup(`Spremljeno${PHRASE_BREAK}na uređaju`, `Spremljeno${PHRASE_BREAK}na uređaju`)).toEqual([HR]);
    expect(inMarkup("Saved — on the server", "Saved  —  on the server")).toEqual([EN]);
    expect(inMarkup("Spremljeno na uređaju", "Spremljeno  na uređaju")).toEqual([]);
    expect(inMarkup("Spremljeno na uređaju.", "Spremljeno  na uređaju .")).toEqual([]);
    expect(inMarkup(`Spremljeno na uređaju${PHRASE_BREAK}Predano`, `Spremljeno na uređaju${PHRASE_BREAK}Predano`)).toEqual([]);
    // A split word is not cleared by a spaced reading whose own phrase is broken.
    expect(inMarkup("Spremljeno. Na uređaju", "S premljeno. Na uređaju")).toEqual([HR]);
  });

  describe("in the files the scan reads", () => {
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
    const scanned = () => scanUiText(root!).map((f) => [f.file, f.line, f.terms.map((t) => t.entry)]);

    // The lines of the finding, in the files it names.
    it("flags the lines of the finding in a page and in the catalogue", () => {
      root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
      write(
        "app/y/page.tsx",
        [
          "export default () => (",
          "  <main>",
          "    <p>Spremljeno. Na uređaju nema drugih promjena.</p>",
          '    <button aria-label="Saved. On this device nothing else changed.">Dalje</button>',
          "    <p><strong>Spremljeno.</strong> Na poslužitelju čeka jedna promjena.</p>",
          "  </main>",
          ");",
          "",
        ].join("\n"),
      );
      write("src/lib/i18n/messages.hr.ts", 'export const hr = { status: "Spremljeno. Na uređaju nema drugih promjena." };\n');
      expect(scanned()).toEqual([
        ["app/y/page.tsx", 3, [HR]],
        ["app/y/page.tsx", 4, [EN]],
        ["app/y/page.tsx", 5, [HR]],
        ["src/lib/i18n/messages.hr.ts", 1, [HR]],
      ]);
    });

    /** Rows of the plan that need markup: what it is, the JSX, the entries it must be reported for. */
    const PHRASE_MARKUP: readonly [string, readonly string[], readonly string[]][] = [
      ["7 sentence end at a source line break", ["<p>", "  Spremljeno.", "  Na uređaju nema promjena.", "</p>"], [HR]],
      ["8 full stop in JSX text", ["<p>Spremljeno. Na uređaju nema drugih promjena.</p>"], [HR]],
      ["8 full stop in a string expression", ['<p>{"Spremljeno. Na uređaju"}</p>'], [HR]],
      ["8 full stop as an expression of its own", ['<p>Spremljeno{". "}Na uređaju</p>'], [HR]],
      ["8 full stop in one branch", ['<p>Spremljeno{a ? "." : ""} na uređaju</p>'], [HR]],
      ["14 comma that && may render", ['<p>Spremljeno{a && ","} na uređaju</p>'], [HR]],
      ["15 dash as an expression", ['<p>Saved{" — "}on the server</p>'], [EN]],
      ["6 line feed in a string expression", ['<p>{"Spremljeno\\nNa uređaju"}</p>'], [HR]],
      ["6 line feed in a template", ["<p>{`Saved\\non this device`}</p>"], [EN]],
      ["6 line feed as an expression", ['<p>Spremljeno{"\\n"}na uređaju</p>'], [HR]],
      ["17 place in brackets around an element", ["<p>Spremljeno (<b>na uređaju</b>)</p>"], [HR]],
      ["18 word in quotation marks", ["<p>„Spremljeno” <i>na uređaju</i></p>"], [HR]],
      ["19 symbol in an element", ["<p>Spremljeno <span>✓</span> na uređaju</p>"], [HR]],
      ["25 sentence end before a line break element", ["<td>Spremljeno.<br />Na uređaju</td>"], [HR]],
      ["26 inline element, place inside", ["<p>Saved <em>on the server</em></p>"], []],
      ["26 inline element around both", ["<p><span>Spremljeno</span> <span>na poslužitelju</span></p>"], []],
      ["27 sentence end inside the emphasis", ["<p><strong>Spremljeno.</strong> Na poslužitelju čeka jedna promjena.</p>"], [HR]],
      ["27 sentence end after the emphasis", ["<p><strong>Saved</strong>. On this device nothing changed.</p>"], [EN]],
      ["27 comma in an element of its own", ["<p>Spremljeno<b>,</b> na uređaju</p>"], [HR]],
      ["27 dash at the start of the emphasis", ["<p>Spremljeno <b>– na uređaju</b></p>"], [HR]],
      ["27 colon at the end of a nested element", ["<p><span><b>Spremljeno:</b></span> <i>na uređaju</i></p>"], [HR]],
      ["28 place in a block of its own", ["<div>Spremljeno<div>na uređaju</div></div>"], [HR]],
      ["28 place in a paragraph of its own", ["<div>Saved <p>on this device</p></div>"], [EN]],
      ["28 place in a component", ["<p>Spremljeno <Where>na uređaju</Where></p>"], [HR]],
      ["28 place in a button", ["<label>Spremljeno <button>na poslužitelju</button></label>"], [HR]],
      ["28 word in a block before the place", ["<div><h2>Spremljeno</h2>na uređaju</div>"], [HR]],
      ["29 icon between the word and the place", ["<p>Spremljeno <Icon /> na uređaju</p>"], [HR]],
      ["29 image between the word and the place", ['<p>Saved <img src="/tick.svg" alt="" /> on this device</p>'], [EN]],
      ["29 horizontal rule between the word and the place", ["<div>Spremljeno<hr />na uređaju</div>"], [HR]],
      ["30 computed value between the word and the place", ["<p>Spremljeno {n} na uređaju</p>"], [HR]],
      ["30 computed value in a template", ["<p>{`Spremljeno ${n} na uređaju`}</p>"], [HR]],
      ["30 computed value in a + chain", ['<p>{"Saved " + n + " on this device"}</p>'], [EN]],
      ["30 computed value in a prop", ['<Field hint={"Spremljeno " + n + " na uređaju"} />'], [HR]],
      ["30 call between the word and the place", ["<p>Spremljeno {format(n)} na poslužitelju</p>"], [HR]],
      ["31 empty string between the word and the place", ['<p>Spremljeno {""}na uređaju</p>'], []],
      ["32 entity for a space", ["<p>Saved&#32;on&nbsp;the&#x20;server</p>"], []],
      ["33 decimal entity for a full stop", ["<p>Spremljeno&#46; Na uređaju</p>"], [HR]],
      ["33 hexadecimal entity for a full stop", ["<p>Spremljeno&#x2E; Na uređaju</p>"], [HR]],
      ["33 decimal entity for a comma", ["<p>Spremljeno&#44; na uređaju</p>"], [HR]],
      ["33 entity for an em dash", ["<p>Saved &mdash; on the server</p>"], [EN]],
      ["33 entity for an en dash", ["<p>Spremljeno &ndash; na uređaju</p>"], [HR]],
      ["33 entity for an ellipsis", ["<p>Spremljeno&hellip; na uređaju</p>"], [HR]],
      ["33 entity for a line feed", ["<p>Spremljeno&#10;na uređaju</p>"], [HR]],
      ["33 entity for a quotation mark", ["<p>Spremljeno &bdquo;na uređaju&rdquo;</p>"], [HR]],
      ["33 entity for a middle dot", ["<p>Saved &middot; on this device</p>"], [EN]],
      ["34 HTML5 name for a full stop", ["<p>Spremljeno&period; Na uređaju</p>"], [HR]],
      ["34 HTML5 name for a comma", ["<p>Spremljeno&comma; na uređaju</p>"], [HR]],
      ["35 soft hyphen entity before the space", ["<p>Spremljeno&shy; na uređaju</p>"], []],
      ["38 sentence end after the place", ["<p>Spremljeno na uređaju.</p>"], []],
      ["38 another status after the place", ["<p>Spremljeno na poslužitelju, predano.</p>"], []],
      ["38 phrase in brackets", ["<p>(Spremljeno na uređaju)</p>"], []],
      ["38 sentence end after an emphasised place", ["<p>Spremljeno <b>na uređaju</b>. Predano.</p>"], []],
      ["38 English phrase without an article", ["<p>Saved on device</p>"], []],
      ["23 negation before the word", ["<p>Nije spremljeno na uređaju.</p>"], []],
      ["24 place before the word", ["<p>Na uređaju: spremljeno</p>"], [HR]],
      ["24 place before the word, in elements", ["<p><b>Na uređaju</b> <i>spremljeno</i></p>"], [HR]],
      ["39 another status after a bare word", ["<p>Spremljeno. Predano.</p>"], [HR]],
      ["43 attribute string", ['<button aria-label="Saved. On this device nothing else changed.">Dalje</button>'], [EN]],
      ["43 attribute string with a comma", ['<img alt="Spremljeno, na poslužitelju još nije." />'], [HR]],
      ["43 attribute string with a dash entity", ['<input placeholder="Saved &mdash; on the server" />'], [EN]],
      ["43 attribute expression", ['<p title={"Spremljeno! Na poslužitelju je i dalje stara verzija."}>Stanje</p>'], [HR]],
      ["43 attribute with a conditional", ['<Field hint={a ? "Spremljeno? Na uređaju da." : "Predano"} />'], [HR]],
      ["43 attribute with an element", ["<Row label={<><b>Spremljeno.</b> Na uređaju</>} />"], [HR]],
      ["43 allowed attribute string", ['<button aria-label="Spremljeno na uređaju, 14:05">Dalje</button>'], []],
      ["43 allowed attribute expression", ['<p title={"Saved on the server."}>Stanje</p>'], []],
      // Found in the author's own attack; none of these is a row of the plan.
      ["attack: footnote mark on a bare word", ["<p>Spremljeno<sup>1</sup></p>"], [HR]],
      ["attack: counter in an element after a bare word", ['<p>Spremljeno<span className="badge">3</span></p>'], [HR]],
      ["attack: counter in an element before a bare word", ["<p><span>3</span>Saved</p>"], [EN]],
      ["attack: footnote mark between the word and the place", ["<p>Spremljeno<sup>1</sup> na uređaju</p>"], [HR]],
      ["attack: footnote mark after the place", ["<p>Spremljeno na uređaju<sup>1</sup></p>"], []],
      ["attack: counter next to the whole phrase", ["<div><span>Spremljeno na uređaju</span><span>3</span></div>"], []],
      ["attack: full stop for screen readers only", ['<p>Spremljeno<span className="sr-only">.</span> na uređaju</p>'], [HR]],
      ["attack: full stop in a fragment", ["<p>Spremljeno<>.</> Na uređaju</p>"], [HR]],
      ["attack: full stop in an empty element's neighbour", ["<p>Spremljeno <b></b>. Na uređaju</p>"], [HR]],
      ["attack: space or full stop by a condition", ['<p>Spremljeno{a ? " " : ". "}na uređaju</p>'], [HR]],
      ["attack: place or a clause by a condition", ['<p>Spremljeno{a ? " na uređaju" : ", na poslužitelju"}</p>'], [HR]],
      ["attack: place in both branches, then a full stop", ['<p>Spremljeno{a ? " na uređaju" : " na poslužitelju"}.</p>'], []],
      ["attack: line break element or a full stop", ['<p>Spremljeno{a ? <br /> : ". "}na uređaju</p>'], [HR]],
      ["attack: component children with a sentence end", ["<Trans>Spremljeno. <b>Na uređaju</b></Trans>"], [HR]],
      ["attack: template in an attribute with a computed tail", ["<p aria-label={`Spremljeno. ${n}`}>Stanje</p>"], [HR]],
      ["attack: full stop by a condition inside a template", ['<p title={`Spremljeno${a ? "." : ""} na uređaju`}>Stanje</p>'], [HR]],
      ["attack: attribute string over two lines", ['<p title="Spremljeno', '  na uređaju">Stanje</p>'], [HR]],
      ["attack: zero width space entity in place of the space", ["<p>Spremljeno&#x200B;na uređaju</p>"], [HR]],
      ["attack: carriage return entity", ["<p>Spremljeno&#13;na uređaju</p>"], [HR]],
      ["attack: tab entity", ["<p>Spremljeno&#9;na uređaju</p>"], []],
      ["attack: labels run together, sentence end between", ["<div><span>Spremljeno.</span><span>Na uređaju</span></div>"], [HR]],
      ["attack: place split over two elements", ["<p>Spremljeno <b>na</b> <i>uređaju</i></p>"], []],
      ["attack: comma between the elements of the place", ["<p>Spremljeno <b>na</b>, <i>uređaju</i></p>"], [HR]],
      ["attack: place in brackets inside a link", ['<p>Spremljeno <a href="/x">(na uređaju)</a></p>'], [HR]],
      ["attack: place only in a title", ['<p>Spremljeno <abbr title="na uređaju">ovdje</abbr></p>'], [HR]],
      ["attack: form control between the word and the place", ["<label>Spremljeno <input /> na uređaju</label>"], [HR]],
      ["attack: computed value or the place", ['<p>Spremljeno{n ?? " na uređaju"}</p>'], [HR]],
      ["attack: array of sentences joined in code", ['<p>{["Spremljeno.", "Na uređaju"].join(" ")}</p>'], [HR]],
      [
        "attack: more alternatives than are kept between the word and the place",
        ["<p>", "  Spremljeno", ...Array.from({ length: 8 }, (_, i) => `  {a${i} ? " " : "\\t"}`), "  na uređaju", "</p>"],
        [HR],
      ],
    ];

    it.each(PHRASE_MARKUP)("row %s", (_, lines, expected) => {
      root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
      const source = ["export const Case = ({ a, n }: Props) => (", ...lines.map((line) => `  ${line}`), ");", ""];
      write("src/components/Case.tsx", source.join("\n"));
      const found = scanUiText(root);
      // Each entry is reported, and reported once.
      expect(found.flatMap((f) => f.terms.map((t) => t.entry))).toEqual(expected);
      for (const finding of found) {
        expect(finding.line).toBeGreaterThan(1);
        expect(finding.line).toBeLessThanOrEqual(lines.length + 1);
      }
    });

    it("keeps the phrase boundary in catalogues, manifests, metadata and every other module", () => {
      root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
      write(
        "src/lib/i18n/messages.hr.ts",
        [
          "export const messages = (n: number) => ({",
          '  status: "Spremljeno. Na uređaju nema drugih promjena.",',
          '  local: "Spremljeno na uređaju.",',
          '  count: "Spremljeno {count} na uređaju",',
          "  computed: `Spremljeno ${n} na uređaju`,",
          '  lines: "Spremljeno\\nna uređaju",',
          '  server: "Spremljeno na poslužitelju, predano.",',
          "  after: `Spremljeno na uređaju u ${n}`,",
          '  dash: "Spremljeno – na poslužitelju",',
          "  bare: `Spremljeno ${n}`,",
          "});",
          "",
        ].join("\n"),
      );
      write(
        "src/lib/i18n/en.json",
        ["{", '  "a": "Saved? On this device, yes.",', '  "b": "Saved on this device.",', '  "c": "Saved — on the server nothing yet."', "}", ""].join("\n"),
      );
      write("src/domain/sync/labels.ts", 'export const A = "Saved. On the server: 2 changes waiting.";\nexport const B = "Saved on the server: 2";\n');
      write("app/manifest.webmanifest", '{\n  "name": "Spremljeno, na uređaju"\n}\n');
      write(
        "app/rad/page.tsx",
        ['export const metadata = { title: "Spremljeno! Na uređaju", description: "Spremljeno na uređaju!" };', "export default () => <p>Predano</p>;", ""].join(
          "\n",
        ),
      );
      // A module outside the list is checked against the Croatian entries only.
      write(
        "src/domain/sync/state.ts",
        ['export const A = "spremljeno, na posluzitelju";', 'export const B = "spremljeno na posluzitelju";', 'export const C = "saved. on the server";', ""].join("\n"),
      );
      const key = (row: readonly unknown[]): string => `${String(row[0])}:${String(row[1]).padStart(3, "0")}`;
      expect(scanned().sort((x, y) => key(x).localeCompare(key(y)))).toEqual([
        ["app/manifest.webmanifest", 2, [HR]],
        ["app/rad/page.tsx", 1, [HR]],
        ["src/domain/sync/labels.ts", 1, [EN]],
        ["src/domain/sync/state.ts", 1, [HR]],
        ["src/lib/i18n/en.json", 2, [EN]],
        ["src/lib/i18n/en.json", 4, [EN]],
        ["src/lib/i18n/messages.hr.ts", 2, [HR]],
        ["src/lib/i18n/messages.hr.ts", 4, [HR]],
        ["src/lib/i18n/messages.hr.ts", 5, [HR]],
        ["src/lib/i18n/messages.hr.ts", 6, [HR]],
        ["src/lib/i18n/messages.hr.ts", 9, [HR]],
        ["src/lib/i18n/messages.hr.ts", 10, [HR]],
      ]);
    });
  });
});
