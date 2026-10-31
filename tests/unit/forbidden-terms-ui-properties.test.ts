import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { findMisplacedUiText, scanUiText } from "../../scripts/forbidden-terms/scan";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(file: string, source: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "ductus-ui-properties-"));
  roots.push(root);
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), source);
  return root;
}

function entries(file: string, source: string): string[] {
  return scanUiText(fixture(file, source)).flatMap((finding) => finding.terms.map((term) => term.entry));
}

// These are the public contract from #190, not the implementation's set:
// omitting a property from that set must fail a regression.
const PROPERTY_NAMES = [
  "label", "title", "description", "placeholder", "caption", "heading", "hint",
  "helperText", "emptyText", "tooltip", "alt", "aria-label", "ariaLabel",
] as const;

describe.each(["src/client/columns.ts", "src/components/Table.tsx"])("UI object properties in %s (#190, DAN-133)", (file) => {
  it.each(PROPERTY_NAMES)("checks the English text of %s", (name) => {
    expect(entries(file, `export const options = { ${JSON.stringify(name)}: "Hidden" };`)).toEqual(["hidden"]);
  });

  it.each([
    ['const options = { ["label"]: "Hidden" };', "hidden"],
    ['const options = { [("label")]: "Hidden" };', "hidden"],
    ['const options = { ["label" as const]: "Hidden" };', "hidden"],
    ['const options = { title: "Risk score" };', "risk"],
    ['const options = { label: `Hidden` };', "hidden"],
    ['const options = { label: `Hid${""}den` };', "hidden"],
    ['const options = { label: "Hid" + "den" };', "hidden"],
    ['const options = { label: "Copied" + suffix };', "copied"],
    ['const options = { label: ("Hidden" as const) };', "hidden"],
    ['const options = { label: "Hidden" } satisfies Column;', "hidden"],
    ['const options = [{ label: "Hidden" }] as const;', "hidden"],
    ['const options = { meta: { tooltip: "Suspicious" } };', "suspicious"],
    ['const options = defineColumns({ label: "Risk" });', "risk"],
    ['const options = { label: ready ? "Open work" : "Hidden" };', "hidden"],
    ['const options = { label: ready && "Saved" };', "saved (without saying where)"],
    ['const options = { label: "Saved " + (ready ? "on this device" : "") };', "saved (without saying where)"],
  ])("finds the entry in %s", (source, entry) => {
    expect(entries(file, source)).toEqual([entry]);
  });

  it.each([
    'const options = { status: "hidden", visibility: "hidden", kind: "risk" };',
    'console.log("Hidden"); const sql = "select hidden, saved from records";',
    'const options = { label: "Open work", title: "Course" };',
    'const options = { label: "Saved on this device" };',
    'const options = { label: "Saved " + "on this device" };',
    'const options = { label: t("status.hidden"), title: format("risk") };',
    'const options = { label: messages.saved };',
    'type Label = "Hidden"; const options = { label: "Open work" as Label };',
  ])("keeps technical tokens, neutral text and translation keys out: %s", (source) => {
    expect(entries(file, source)).toEqual([]);
  });

  // Deliberate data-flow limits from attacks 17 and 22–24. The source of UI
  // constants must remain in UI_TEXT_MODULES; no import or local binding is followed.
  it.each([
    'const KEY = "label"; const options = { [KEY]: "Hidden" };',
    'const label = "Hidden"; const options = { label };',
    'const LABEL = "Hidden"; const options = { label: LABEL };',
    'import { LABEL } from "./tokens"; const options = { label: LABEL };',
  ])("documents an unresolved binding: %s", (source) => {
    expect(entries(file, source)).toEqual([]);
  });
});

it("reads an object nested inside a JSX prop (attack 14)", () => {
  expect(entries("src/components/Table.tsx", 'export const table = <Table columns={[{ label: "Hidden" }]} />;')).toEqual(["hidden"]);
});

it("reads UI properties in an app .ts file that is not Next metadata", () => {
  expect(entries("app/tools/options.ts", 'export const options = { label: "Hidden" };')).toEqual(["hidden"]);
});

it("does not turn technical JSX attributes into interface text", () => {
  expect(entries("src/components/Input.tsx", 'const input = <input type="hidden" id="risk" name="saved" key="hidden" className="hidden" data-status="hidden" />;')).toEqual([]);
});

it("keeps the existing visible value attribute check", () => {
  expect(entries("src/components/Input.tsx", 'const input = <input value="Copied" />;')).toEqual(["copied"]);
});

it.each(["src/client/columns.ts", "app/tools/options.ts"])("keeps the misplaced Croatian text guard in %s", (file) => {
  const root = fixture(file, 'export const options = { label: "Otvori uređivanje" };');
  expect(findMisplacedUiText(root).map((text) => text.text)).toEqual(["Otvori uređivanje"]);
});

it("reads a TypeScript angle-bracket assertion in a .ts module", () => {
  expect(entries("src/client/columns.ts", 'const options = { label: <string>"Hidden" };')).toEqual(["hidden"]);
});

it.each([
  'export const metadata = { title: "Hid" + "den" };',
  'export const generateMetadata = () => ({ title: "Hid" + "den" });',
  'export function generateMetadata() { return { title: "Hid" + "den" }; }',
])("reads composed UI properties inside metadata: %s", (source) => {
  expect(entries("app/layout.tsx", source)).toEqual(["hidden"]);
});

it.each([
  'export const metadata = { title: "Copied" + " text" };',
  'export function generateMetadata() { return { title: "Copied" + suffix }; }',
])("reports an existing metadata finding only once: %s", (source) => {
  expect(entries("app/layout.tsx", source)).toEqual(["copied"]);
});

it.each([
  'const options = { label: "Sumnjivo" };',
  'const options = { label: "Open " + "Sumnjivo" };',
  'const options = { label: t("Sumnjivo") };',
  'const options = { label: "Open " + t("Sumnjivo") };',
  'const options = { label: `Open ${t("Sumnjivo")}` };',
])("reports Croatian text once, including inside unknown calls: %s", (source) => {
  expect(entries("src/client/columns.ts", source)).toEqual(["sumnjivo"]);
});

it("keeps the real interface scan clean", () => {
  expect(scanUiText(fileURLToPath(new URL("../..", import.meta.url)))).toEqual([]);
});
