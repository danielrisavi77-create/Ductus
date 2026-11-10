import { readFileSync } from "node:fs";

import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { REQUIRED_PROCEDURES, checkOperations, repoContext } from "../../scripts/operations/check-procedures.mjs";

// DAN-540 (M11.3-P04), contract on #1091: for any document of the four
// required procedures, the check reports a problem exactly for the steps that
// name neither a known command nor a known owner, with the right procedure and
// step number. A step is one canonical line `N. ` at column 0 (#1803 round 3,
// contract #1091 c.6750197325). Prose between procedures, outside a step,
// changes nothing, and any change that takes a step line out of the subset is
// refused at that line.

const OWNERS = "## Nositelji\n\n| Nositelj | Odgovornost |\n| --- | --- |\n| `vlasnik` | kvarovi |\n| `koordinator pilota` | pitanja |\n";

const CONTEXT = {
  scripts: new Set(["local:up", "db:status"]),
  fileExists: (path: string) => path === "scripts/db/native-db.mjs",
  routeExists: (route: string) => route === "/api/ready",
};

/** A step kind and whether the check must refuse it. */
const STEPS = [
  { body: "Naredba: `pnpm local:up`.", bad: false },
  // Since #1803 w540l a dot is outside the character list, so a node file is refused.
  { body: "Naredba: `node scripts/db/native-db.mjs status`.", bad: true },
  { body: "Naredba: `curl -fsS http://localhost:3000/api/ready`.", bad: false },
  { body: "Nositelj: `vlasnik`.", bad: false },
  { body: "**Nositelj:** `koordinator pilota`.", bad: false },
  { body: "Naredba: `pnpm prod:up`.", bad: true },
  { body: "Naredba: `rm -rf data`.", bad: true },
  { body: "Naredba: `pnpm install && pnpm prod:up`.", bad: true },
  { body: "Nositelj: `dežurni`.", bad: true },
  { body: "Pogledaj `pnpm local:up` u dokumentu.", bad: true },
  { body: "Odluči što dalje.", bad: true },
  { body: "Naredba: `kill -TERM <pid>`.", bad: false },
] as const;

const PROSE = ["", "Kratka napomena bez naredbe.\n\n", "**Napomena:** `pnpm nope` nije korak.\n\n", "```\n1. nije korak\n```\n\n"] as const;

const stepArb = fc.record({ kind: fc.integer({ min: 0, max: STEPS.length - 1 }) });
const procedureArb = fc.array(stepArb, { minLength: 1, maxLength: 6 });
const documentArb = fc.record({
  steps: fc.tuple(procedureArb, procedureArb, procedureArb, procedureArb),
  prose: fc.tuple(...REQUIRED_PROCEDURES.map(() => fc.constantFrom(...PROSE))),
});

type StepCase = { kind: number };

function render(steps: StepCase[][], prose: readonly string[]): string {
  const sections = REQUIRED_PROCEDURES.map((name, p) => {
    const list = (steps[p] ?? [])
      .map(({ kind }, i) => `${i + 1}. Korak. ${STEPS[kind]?.body ?? ""}`)
      .join("\n");
    return `### ${name}\n\n${prose[p] ?? ""}${list}\n`;
  });
  return `# Operacije\n\n${OWNERS}\n## Postupci\n\n${sections.join("\n")}`;
}

test.prop([documentArb])("reports exactly the steps without a known command or owner", ({ steps, prose }) => {
  const problems = checkOperations(render(steps, prose), CONTEXT).map((p) => `${p.procedure}#${p.step ?? "-"}`);
  const expected = REQUIRED_PROCEDURES.flatMap((name, p) =>
    (steps[p] ?? []).flatMap(({ kind }, i) => (STEPS[kind]?.bad ? [`${name}#${i + 1}`] : [])),
  );
  expect(problems).toEqual(expected);
});

test.prop([documentArb])("prose outside the steps does not change the result", ({ steps, prose }) => {
  const plain = REQUIRED_PROCEDURES.map(() => "");
  const strip = (text: string) => checkOperations(text, CONTEXT).map((p) => `${p.procedure}#${p.step ?? "-"}: ${p.message}`);
  expect(strip(render(steps, prose))).toEqual(strip(render(steps, plain)));
});

/** Changes that take a step line out of the subset. */
const MUTATIONS = [
  (line: string, n: number) => `${" ".repeat(1 + (n % 3))}${line}`,
  (line: string) => line.replace(/^(\d+)\./, "$1)"),
  (line: string) => line.replace(/^(\d+)\. /, "$1.  "),
  (line: string) => line.replace(/^(\d+)\. /, "$1.\t"),
  (line: string, n: number) => {
    const at = line.indexOf(" ") + 1 + (n % (line.length - line.indexOf(" ")));
    return `${line.slice(0, at)}${"`".repeat(2 + (n % 4))}${line.slice(at)}`;
  },
  (line: string, n: number) => {
    const at = line.indexOf(" ") + 1 + (n % (line.length - line.indexOf(" ")));
    return `${line.slice(0, at)}\\\`${line.slice(at)}`;
  },
] as const;

test.prop([documentArb, fc.nat(), fc.integer({ min: 0, max: MUTATIONS.length - 1 }), fc.nat()])(
  "a step line taken out of the subset is refused at that line",
  ({ steps, prose }, pick, mutation, n) => {
    const lines = render(steps, prose).split("\n");
    const stepLines = lines.flatMap((line, i) => (/^\d+\. Korak\./.test(line) ? [i] : []));
    const index = stepLines[pick % stepLines.length] ?? 0;
    lines[index] = MUTATIONS[mutation]?.(lines[index] ?? "", n) ?? "";
    const refused = checkOperations(lines.join("\n"), CONTEXT).filter((p) => p.message.startsWith("unsupported markdown: "));
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.map((p) => p.line)).toEqual(refused.map(() => index + 1));
  },
);

// Review and QA FAIL on 2d9c1e79 (#1803), contract on #1836 (w540j): a closing
// run of `#` after a space or tab is not part of the heading (CommonMark ATX),
// so adding one to any heading changes nothing, and `pnpm run <x>` passes
// exactly when `x` is a script, `install` included.
const closingArb = fc.record({
  before: fc.stringMatching(/^[ \t]{1,3}$/),
  hashes: fc.integer({ min: 1, max: 10 }),
  after: fc.stringMatching(/^[ \t]{0,2}$/),
});

test.prop([documentArb, fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), closingArb])(
  "a closing run of # on any heading does not change the result",
  ({ steps, prose }, mask, { before, hashes, after }) => {
    const text = render(steps, prose);
    let n = 0;
    const closed = text
      .split("\n")
      .map((line) => (/^#{1,3} /.test(line) && mask[n++ % mask.length] ? `${line}${before}${"#".repeat(hashes)}${after}` : line))
      .join("\n");
    expect(checkOperations(closed, CONTEXT)).toEqual(checkOperations(text, CONTEXT));
  },
);

const SCRIPT_NAMES = ["install", "local:up", "db:status", "prod:up", "i", "add"] as const;

test.prop([fc.constantFrom(...SCRIPT_NAMES), fc.subarray([...SCRIPT_NAMES]), fc.boolean()])(
  "pnpm run <x> passes exactly when x is a package.json script",
  (name, scripts, option) => {
    const command = `pnpm run ${name}${option ? " --frozen-lockfile" : ""}`;
    const text = render([[{ kind: 0 }], [{ kind: 0 }], [{ kind: 0 }], [{ kind: 0 }]], ["", "", "", ""]).replace("`pnpm local:up`", `\`${command}\``);
    const context = { ...CONTEXT, scripts: new Set([...scripts, "local:up"]) };
    const found = checkOperations(text, context).map((p) => p.message);
    const known = name === "local:up" || scripts.includes(name);
    expect(found).toEqual(
      !known ? [`pnpm script not in package.json: ${name}`] : option ? ["pnpm option not allowed: --frozen-lockfile"] : [],
    );
  },
);

// Review and QA FAIL on 4203cc68 (#1803), contract on #1836 c.6764529056
// (w540k): a backslash anywhere in a curl URL is refused before new URL()
// reads it, and a space character other than U+0020 or a tab next to a
// heading stays in its title, so the heading no longer names a procedure.
const URLS = ["http://localhost:3000/api/ready", "http://localhost:3000/api/ready?x=1", "http://localhost:3000/api/ready/"] as const;

test.prop([fc.constantFrom(...URLS), fc.nat(), fc.integer({ min: 1, max: 3 })])(
  "a backslash anywhere in a curl URL is refused",
  (url, at, count) => {
    const index = "http://".length + (at % (url.length - "http://".length + 1));
    const bad = `${url.slice(0, index)}${"\\".repeat(count)}${url.slice(index)}`;
    const text = render([[{ kind: 2 }], [{ kind: 0 }], [{ kind: 0 }], [{ kind: 0 }]], ["", "", "", ""]).replace(URLS[0], bad);
    const found = checkOperations(text, CONTEXT);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((p) => p.procedure === REQUIRED_PROCEDURES[0] && p.step === 1)).toBe(true);
  },
);

const SPACES = [
  " ", " ", " ", " ", " ", " ", " ", " ", " ", " ", " ",
  " ", " ", " ", " ", "　", "﻿", "\u0085", "\u000b", "\u000c", " ", " ",
] as const;

test.prop([
  documentArb,
  fc.integer({ min: 0, max: REQUIRED_PROCEDURES.length - 1 }),
  fc.constantFrom(...SPACES),
  fc.constantFrom("start", "end", "after closing run", "before closing run"),
  fc.stringMatching(/^[ \t]{0,2}$/),
])("a Unicode space next to a procedure heading takes the procedure out", ({ steps, prose }, p, z, where, pad) => {
  const name = REQUIRED_PROCEDURES[p] ?? "";
  const heading =
    where === "start" ? `### ${z}${name}` : where === "end" ? `### ${name}${z}${pad}` : where === "after closing run" ? `### ${name} ###${z}${pad}` : `### ${name}${z}###`;
  const text = render(steps, prose).replace(`\n### ${name}\n`, `\n${heading}\n`);
  expect(checkOperations(text, CONTEXT).map((m) => m.message)).toContain("required procedure is missing");
  expect(checkOperations(text, CONTEXT).filter((m) => m.message === "required procedure is missing").map((m) => m.procedure)).toEqual([name]);
});

// Codex c.4523669643 on 0d2fc9fc (#1803 w540k): Bash splits words only on
// spaces and tabs, so any other space character anywhere in a command makes
// the step refused at that procedure and step, never passed.
const COMMANDS = ["pnpm local:up", "node scripts/db/native-db.mjs status", "curl -fsS http://localhost:3000/api/ready"] as const;

test.prop([fc.integer({ min: 0, max: COMMANDS.length - 1 }), fc.nat(), fc.constantFrom(...SPACES), fc.boolean()])(
  "a space other than U+0020 or a tab in a command refuses that step",
  (kind, at, z, replace) => {
    const command = COMMANDS[kind] ?? "";
    const index = at % (command.length + 1);
    const space = command.indexOf(" ");
    const bad = replace ? `${command.slice(0, space)}${z}${command.slice(space + 1)}` : `${command.slice(0, index)}${z}${command.slice(index)}`;
    const text = render([[{ kind }], [{ kind: 0 }], [{ kind: 0 }], [{ kind: 0 }]], ["", "", "", ""]).replace(`\`${command}\``, `\`${bad}\``);
    const found = checkOperations(text, CONTEXT);
    expect(found.map((p) => `${p.procedure}#${p.step}: ${p.message}`)).toEqual([
      `${REQUIRED_PROCEDURES[0]}#1: command contains a space other than U+0020 or a tab: ${bad.replace(/^[ \t]+|[ \t]+$/g, "")}`,
    ]);
  },
);

// Review FAIL c.6765310879 and QA FAIL c.6765312157 on 9deb453a (#1803),
// contract #1836 c.6765524123 (w540l): a command may use only ASCII letters and
// digits, U+0020, `-`, `/`, `:` and `<pid>` as a whole word. Any command with at
// least one other character is refused at its step by a character check, and
// every command of docs/OPERATIONS.md still passes.
const DOC_TEXT = readFileSync(new URL("../../docs/OPERATIONS.md", import.meta.url), "utf8");
const DOC_COMMANDS = [
  ...new Set(
    DOC_TEXT.split("\n")
      .filter((line) => /^\d+\. /.test(line))
      .flatMap((line) => [...line.matchAll(/Naredba:((?:(?:\s*,\s*|\s+(?:i|ili|pa)\s+|\s*)`[^`]*`)+)/gu)])
      .flatMap((m) => [...(m[1] ?? "").matchAll(/`([^`]*)`/g)].map((c) => (c[1] ?? "").trim())),
  ),
];
const REPO = repoContext(new URL("../..", import.meta.url));
const ALLOWED = /^[A-Za-z0-9 /:-]$/;
const PID_WORD = /(?<=^| )<pid>(?= |$)/g;
/** Characters outside the list once whole-word `<pid>` is taken out. */
const outside = (command: string) => [...command.replace(PID_WORD, "")].filter((c) => !ALLOWED.test(c));
const CHARACTER_CHECKS = [
  "command contains a character that is not allowed (U+",
  "command chains, pipes or redirects are not allowed: ",
  "command contains a space other than U+0020 or a tab: ",
  // A backslash right before the closing backtick is refused by the parser.
  "unsupported markdown: backslash before a backtick",
];
const SPECIAL = [..."'\"$\\;|&<>(){}[]*?~!#%=@^.,_+\t\u0000\u001b\u007f\u00a0\u0085\u200b\u2028\ufeffčć"] as const;
// Any character but a backtick or a line break, which end the code span or the line.
const anyChar = fc.oneof(fc.constantFrom(...SPECIAL), fc.string({ unit: "binary", minLength: 1, maxLength: 1 })).filter((c) => !/[`\n\r]/.test(c));
const allowedChar = fc.constantFrom(..."abcxyzABCXYZ0189 /:-");
const baseArb = fc.oneof(fc.constantFrom(...DOC_COMMANDS), fc.stringMatching(/^[A-Za-z0-9 /:-]{1,30}$/));
const stepWith = (command: string) => `# Operacije\n\n${OWNERS}\n## Postupci\n\n### ${REQUIRED_PROCEDURES[0]}\n\n1. Korak. Naredba: \`${command}\`.\n`;

test.prop([baseArb, fc.nat(), fc.array(fc.oneof(anyChar, allowedChar), { minLength: 1, maxLength: 5 })])(
  "F1/F2 a command with one to five characters outside the list is refused at its step",
  (base, at, inserted) => {
    const index = at % (base.length + 1);
    const command = `${base.slice(0, index)}${inserted.join("")}${base.slice(index)}`;
    fc.pre(outside(command).length > 0);
    const found = checkOperations(stepWith(command), REPO).filter((p) => p.procedure === REQUIRED_PROCEDURES[0]);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((p) => p.step === 1 && CHARACTER_CHECKS.some((m) => p.message.startsWith(m)))).toBe(true);
  },
);

test.prop([fc.stringMatching(/^[A-Za-z0-9 /:-]{1,40}$/)])("F3 a command made only of listed characters is never refused for a character", (command) => {
  const found = checkOperations(stepWith(command), REPO).filter((p) => p.procedure === REQUIRED_PROCEDURES[0]);
  expect(found.filter((p) => CHARACTER_CHECKS.some((m) => p.message.startsWith(m)))).toEqual([]);
});

test("F3 every command of docs/OPERATIONS.md passes and uses only listed characters", () => {
  expect(DOC_COMMANDS.length).toBeGreaterThanOrEqual(7);
  for (const command of DOC_COMMANDS) {
    expect(outside(command)).toEqual([]);
    expect(checkOperations(stepWith(command), REPO).filter((p) => p.procedure === REQUIRED_PROCEDURES[0])).toEqual([]);
  }
  expect(checkOperations(DOC_TEXT, REPO)).toEqual([]);
});
