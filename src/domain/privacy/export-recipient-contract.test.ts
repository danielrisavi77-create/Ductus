import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// DAN-316 (attack plan #1882, A1 to A13): docs/contracts/export-recipient-v1.md
// gives every DATA-CLASS row an outcome for every export recipient. This test
// reads the contract and docs/privacy/06-klase-podataka.md and checks that the
// table is closed and does not contradict the decisions it cites. It decides
// nothing itself: "otvoreno" is read as "ne" until the owner decides.

const ROOT = join(__dirname, "../../..");
const CONTRACT = "docs/contracts/export-recipient-v1.md";
const INVENTORY = "docs/privacy/06-klase-podataka.md";
const CLASSES_HEADING = "## 3. Klase po primatelju";
const EXTRAS_HEADING = "## 4. Podaci izvan klasa";
const INVENTORY_HEADING = "## 2. Klase";

const RECIPIENTS = ["Student", "Bivši student", "Portfelj", "Izlaz ustanove"] as const;
type Recipient = (typeof RECIPIENTS)[number];
const OUTCOMES = ["da", "ne", "otvoreno"] as const;
type Outcome = (typeof OUTCOMES)[number];
type Row = { code: string; name: string; out: Record<Recipient, string>; source: string };

const [STUDENT, FORMER, PORTFOLIO, EXIT] = RECIPIENTS;

// Outcomes fixed by decisions (DATA-CLASS anchors and closed lists).
// Every row names the recipients whose cell must hold exactly the outcome.
const FIXED: { code: string; outcome: Outcome; recipients: readonly Recipient[]; why: string }[] = [
  { code: "16", outcome: "da", recipients: [STUDENT, FORMER, EXIT], why: "D-173, D-271 MQ02, D-274 MQ12" },
  { code: "27", outcome: "da", recipients: [STUDENT, FORMER, EXIT], why: "D-173, DAN-341" },
  { code: "12", outcome: "ne", recipients: RECIPIENTS, why: "D-274 MQ09, reserved" },
  { code: "3", outcome: "ne", recipients: RECIPIENTS, why: "session secrets" },
  { code: "20", outcome: "ne", recipients: RECIPIENTS, why: "D-273 MQ08, the package is the output" },
  { code: "23", outcome: "ne", recipients: RECIPIENTS, why: "D-273 MQ08, discarded objects" },
  { code: "29", outcome: "ne", recipients: RECIPIENTS, why: "backups are not exported" },
  { code: "25", outcome: "ne", recipients: [STUDENT, FORMER, PORTFOLIO], why: "D-173 closed package (A6)" },
  { code: "26", outcome: "ne", recipients: [STUDENT, FORMER, PORTFOLIO], why: "D-173 closed package (A6)" },
  { code: "28", outcome: "ne", recipients: [STUDENT, FORMER, PORTFOLIO], why: "D-173 closed package (A6)" },
  { code: "30", outcome: "ne", recipients: RECIPIENTS, why: "local device data is not on the server" },
];

// Data that is not a DATA-CLASS row but must never reach a recipient.
// `never` lists recipients whose cell must be "ne"; the rest may be "ne" or "otvoreno", never "da".
const EXTRAS: { name: string; never: readonly Recipient[]; why: string }[] = [
  { name: "Mentorovi radni zapisi", never: [STUDENT, FORMER, PORTFOLIO], why: "PRODUCT §5 rule 5, D-130" },
  { name: "Rezultat A-03", never: RECIPIENTS, why: "D-287" },
  { name: "Ocjena i obrazloženje prije objave", never: [STUDENT, FORMER, PORTFOLIO], why: "PRODUCT §5 rule 5" },
  { name: "Ključevi, tokeni i tajne", never: RECIPIENTS, why: "SECURITY" },
];

/** Rows of the first Markdown table under a heading. */
function tableUnder(markdown: string, heading: string): string[][] {
  const lines = markdown.split("\n");
  const at = lines.findIndex((l) => l.trim() === heading);
  if (at < 0) throw new Error(`missing heading ${heading}`);
  const rows: string[][] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith("## ")) break;
    if (!line.startsWith("|")) {
      if (rows.length > 0) break;
      continue;
    }
    rows.push(line.slice(1, line.trimEnd().length - 1).split("|").map((c) => c.trim()));
  }
  return rows;
}

/** Contract rows; the header must name the recipients in this order. */
function parseRows(markdown: string, heading: string, lead: string[]): Row[] {
  const [header, , ...body] = tableUnder(markdown, heading);
  const expected = [...lead, ...RECIPIENTS, "Izvor"];
  if (header?.join("|") !== expected.join("|")) throw new Error(`${heading}: header must be ${expected.join(" | ")}`);
  return body.map((cells) => {
    const at = lead.length;
    const out = Object.fromEntries(RECIPIENTS.map((r, i) => [r, cells[at + i] ?? ""])) as Record<Recipient, string>;
    return { code: lead.length === 2 ? cells[0] : "", name: cells[lead.length - 1], out, source: cells[at + RECIPIENTS.length] ?? "" };
  });
}

function inventoryClasses(markdown: string): { code: string; name: string }[] {
  return tableUnder(markdown, INVENTORY_HEADING)
    .slice(2)
    .map(([code, name]) => ({ code, name }));
}

/** Every problem in the contract tables; empty when they agree with DATA-CLASS and the decisions. */
function contractErrors(inventory: { code: string; name: string }[], classes: Row[], extras: Row[]): string[] {
  const errors: string[] = [];
  const expected = inventory.map((c) => `${c.code} ${c.name}`).join(", ");
  if (classes.map((c) => `${c.code} ${c.name}`).join(", ") !== expected) {
    errors.push("class rows must list every DATA-CLASS row, in order, with the same name");
  }
  for (const row of [...classes, ...extras]) {
    const label = row.code ? `class ${row.code}` : row.name;
    for (const r of RECIPIENTS) {
      if (!(OUTCOMES as readonly string[]).includes(row.out[r])) errors.push(`${label}: ${r} has outcome "${row.out[r]}"`);
    }
    if (!row.source) errors.push(`${label}: no source`);
    if (row.out[FORMER] !== row.out[STUDENT]) errors.push(`${label}: former student differs from student (D-271 MQ02)`);
    if (row.out[PORTFOLIO] === "da" && row.out[STUDENT] !== "da") {
      errors.push(`${label}: portfolio exceeds the student package`);
    }
  }
  for (const f of FIXED) {
    const row = classes.find((c) => c.code === f.code);
    for (const r of f.recipients) {
      if (row?.out[r] !== f.outcome) errors.push(`class ${f.code}: ${r} must be ${f.outcome} (${f.why})`);
    }
  }
  for (const x of EXTRAS) {
    const row = extras.find((e) => e.name === x.name);
    if (!row) {
      errors.push(`${x.name}: missing (${x.why})`);
      continue;
    }
    for (const r of RECIPIENTS) {
      const must = x.never.includes(r) ? ["ne"] : ["ne", "otvoreno"];
      if (!must.includes(row.out[r])) errors.push(`${x.name}: ${r} must be ${must.join(" or ")} (${x.why})`);
    }
  }
  return errors;
}

// Synthetic inventory and contract for the table-driven cases.
const INV = Array.from({ length: 30 }, (_, i) => ({ code: String(i + 1), name: `Klasa ${i + 1}` }));
const YES_STUDENT = new Set(["16", "27"]);
const YES_EXIT = new Set(["16", "27", "13"]);
const okClass = (c: { code: string; name: string }) => {
  const s = YES_STUDENT.has(c.code) ? "da" : "ne";
  return `| ${c.code} | ${c.name} | ${s} | ${s} | ne | ${YES_EXIT.has(c.code) ? "da" : "ne"} | D-x |`;
};
const okExtras = [
  "| Mentorovi radni zapisi | ne | ne | ne | otvoreno | D-130 |",
  "| Rezultat A-03 | ne | ne | ne | ne | D-287 |",
  "| Ocjena i obrazloženje prije objave | ne | ne | ne | otvoreno | §5 |",
  "| Ključevi, tokeni i tajne | ne | ne | ne | ne | SECURITY |",
];
const contract = (classRows: string[], extraRows = okExtras) =>
  [
    CLASSES_HEADING,
    "",
    "| Klasa | Naziv | Student | Bivši student | Portfelj | Izlaz ustanove | Izvor |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...classRows,
    "",
    EXTRAS_HEADING,
    "",
    "| Podatak | Student | Bivši student | Portfelj | Izlaz ustanove | Izvor |",
    "| --- | --- | --- | --- | --- | --- |",
    ...extraRows,
    "",
  ].join("\n");
const check = (md: string) =>
  contractErrors(INV, parseRows(md, CLASSES_HEADING, ["Klasa", "Naziv"]), parseRows(md, EXTRAS_HEADING, ["Podatak"]));
const okRows = INV.map(okClass);
const edit = (code: string, cells: string) => okRows.map((r, i) => (INV[i].code === code ? `| ${code} | Klasa ${code} | ${cells} |` : r));

describe("contractErrors", () => {
  it("accepts a complete contract", () => {
    expect(check(contract(okRows))).toEqual([]);
  });

  it.each([
    ["a missing class (A13)", okRows.slice(0, 29), "class rows must list every DATA-CLASS row"],
    ["a renamed class (A13)", edit("5", "ne | ne | ne | ne | D-x").map((r) => r.replace("Klasa 5", "Uloge")), "class rows must list every DATA-CLASS row"],
    ["classes out of order (A13)", [okRows[1], okRows[0], ...okRows.slice(2)], "class rows must list every DATA-CLASS row"],
    ["an unknown outcome", edit("5", "možda | možda | ne | ne | D-x"), 'class 5: Student has outcome "možda"'],
    ["an empty source", edit("5", "ne | ne | ne | ne | "), "class 5: no source"],
    ["the former student getting more (A8)", edit("18", "ne | da | ne | ne | D-x"), "class 18: former student differs from student"],
    ["the portfolio exceeding the student (A9)", edit("13", "ne | ne | da | da | D-x"), "class 13: portfolio exceeds the student package"],
    ["the submitted work withheld from the student (A1)", edit("16", "ne | ne | ne | da | D-x"), "class 16: Student must be da"],
    ["the receipt withheld from the exit (A10)", edit("27", "da | da | ne | ne | D-x"), "class 27: Izlaz ustanove must be da"],
    ["the reserved private history exported (A7)", edit("12", "ne | ne | ne | da | D-x"), "class 12: Izlaz ustanove must be ne"],
    ["session data in the exit (A11)", edit("3", "ne | ne | ne | da | D-x"), "class 3: Izlaz ustanove must be ne"],
    ["backups in the exit (A11)", edit("29", "ne | ne | ne | otvoreno | D-x"), "class 29: Izlaz ustanove must be ne"],
    ["device journal for the student (A11)", edit("30", "da | da | ne | ne | D-x"), "class 30: Student must be ne"],
    ["the access log for the student (A6)", edit("25", "da | da | ne | da | D-x"), "class 25: Student must be ne"],
    ["permission changes for the former student (A6)", edit("26", "da | da | ne | da | D-x"), "class 26: Bivši student must be ne"],
    ["the deletion record in the portfolio (A6)", edit("28", "da | da | da | da | D-x"), "class 28: Portfelj must be ne"],
  ])("fails on %s", (_case, rows, error) => {
    expect(check(contract(rows)).some((e) => e.startsWith(error))).toBe(true);
  });

  it.each([
    ["mentor working notes for the student (A3)", 0, "| Mentorovi radni zapisi | da | da | ne | otvoreno | D-130 |", "Mentorovi radni zapisi: Student must be ne"],
    ["mentor working notes decided for the exit (A12)", 0, "| Mentorovi radni zapisi | ne | ne | ne | da | D-130 |", "Mentorovi radni zapisi: Izlaz ustanove must be ne or otvoreno"],
    ["the A-03 result left open (A4)", 1, "| Rezultat A-03 | ne | ne | ne | otvoreno | D-287 |", "Rezultat A-03: Izlaz ustanove must be ne"],
    ["an unpublished grade for the portfolio (A5)", 2, "| Ocjena i obrazloženje prije objave | ne | ne | otvoreno | ne | §5 |", "Ocjena i obrazloženje prije objave: Portfelj must be ne"],
    ["keys in the exit (A11)", 3, "| Ključevi, tokeni i tajne | ne | ne | ne | otvoreno | SECURITY |", "Ključevi, tokeni i tajne: Izlaz ustanove must be ne"],
  ])("fails on %s", (_case, at, row, error) => {
    const rows = okExtras.map((r, i) => (i === at ? row : r));
    expect(check(contract(okRows, rows))).toContain(`${error} (${EXTRAS[at].why})`);
  });

  it("fails on a missing extra row", () => {
    expect(check(contract(okRows, okExtras.slice(1)))).toContain("Mentorovi radni zapisi: missing (PRODUCT §5 rule 5, D-130)");
  });

  it("refuses a table whose columns name other recipients", () => {
    const md = contract(okRows).replace("| Portfelj | Izlaz ustanove | Izvor |", "| Admin | Izlaz ustanove | Izvor |");
    expect(() => check(md)).toThrow(/header must be/);
  });
});

describe(CONTRACT, () => {
  it("gives every DATA-CLASS row an outcome for every recipient, within the decisions", () => {
    const md = readFileSync(join(ROOT, CONTRACT), "utf8");
    const inventory = inventoryClasses(readFileSync(join(ROOT, INVENTORY), "utf8"));
    expect(inventory).toHaveLength(30);
    const classes = parseRows(md, CLASSES_HEADING, ["Klasa", "Naziv"]);
    const extras = parseRows(md, EXTRAS_HEADING, ["Podatak"]);
    expect(contractErrors(inventory, classes, extras)).toEqual([]);
  });
});
