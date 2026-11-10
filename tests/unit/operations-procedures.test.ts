import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  REQUIRED_PROCEDURES,
  checkOperations,
  parseOperations,
  repoContext,
} from "../../scripts/operations/check-procedures.mjs";

// DAN-540 (M11.3-P04): every step of the four operating procedures in
// docs/OPERATIONS.md names a command that exists in the repository or an owner
// from the "Nositelji" table. The input classes are listed in the contract on
// #1091; each row below names its class.

const OWNERS = `## Nositelji

| Nositelj | Odgovornost |
| --- | --- |
| \`vlasnik\` | tehnički kvarovi |
| \`zamjenik vlasnika\` | zamjena |
`;

const CONTEXT = {
  scripts: new Set(["local:up", "db:status"]),
  fileExists: (path: string) => path === "scripts/db/native-db.mjs",
  routeExists: (route: string) => route === "/api/ready" || route === "/api/health",
};

const VALID_STEP = "Provjeri spremnost. Naredba: `curl -fsS http://localhost:3000/api/ready`.";

/** A document with the four required procedures; `steps` replaces the steps of the first. */
function doc(steps: string, options: { owners?: string; extra?: string } = {}): string {
  const rest = REQUIRED_PROCEDURES.slice(1)
    .map((name) => `### ${name}\n\n1. ${VALID_STEP}\n`)
    .join("\n");
  return `# Operacije\n\n${options.owners ?? OWNERS}\n## Postupci\n\n### ${REQUIRED_PROCEDURES[0]}\n\n${steps}\n\n${rest}${options.extra ?? ""}`;
}

/** Steps 1 to 9 with an owner, so the next step can be numbered 10. */
const NINE_STEPS = Array.from({ length: 9 }, (_, i) => `${i + 1}. Korak. Nositelj: \`vlasnik\`.\n`).join("");

const messages = (text: string) => checkOperations(text, CONTEXT).map((p) => `${p.procedure}#${p.step ?? "-"}: ${p.message}`);

// #1803 round 3 (contract #1091 c.6750197325): the check no longer emulates
// CommonMark. In "Nositelji" and "Postupci" it reads a small line subset and
// refuses everything else with `unsupported markdown: <what>`.
const NONE = ["Pokretanje#1: step has neither Naredba: nor Nositelj:"];
const NINE = Array.from({ length: 9 }, (_, i) => `${i + 1}. Korak. Nositelj: \`vlasnik\`.`).join("\n");
const U = (what: string, step = "1") => `Pokretanje#${step}: unsupported markdown: ${what}`;

describe("checkOperations: one step per input class", () => {
  it.each([
    ["1 pnpm script that exists", "1. Pokreni. Naredba: `pnpm local:up`.", []],
    ["1 pnpm run form", "1. Pokreni. Naredba: `pnpm run local:up`.", []],
    ["1 pnpm install is built in", "1. Ovisnosti. Naredba: `pnpm install --frozen-lockfile`.", []],
    ["1 pnpm script that does not exist", "1. Pokreni. Naredba: `pnpm prod:up`.", ["Pokretanje#1: pnpm script not in package.json: prod:up"]],
    ["1 pnpm without a script", "1. Pokreni. Naredba: `pnpm`.", ["Pokretanje#1: pnpm command names no script"]],
    ["2 node file that exists", "1. Baza. Naredba: `node scripts/db/native-db.mjs up`.", []],
    ["2 node file that does not exist", "1. Baza. Naredba: `node scripts/db/gone.mjs`.", ["Pokretanje#1: node file does not exist: scripts/db/gone.mjs"]],
    ["2 node flags only", "1. Baza. Naredba: `node --version`.", ["Pokretanje#1: node command names no file"]],
    ["3 curl route that exists", `1. ${VALID_STEP}`, []],
    ["3 curl that keeps the body on failure", "1. Spremnost. Naredba: `curl --fail-with-body -sS http://localhost:3000/api/ready`.", []],
    ["3 curl route that does not exist", "1. Zdravlje. Naredba: `curl -fsS http://localhost:3000/api/live-ness`.", ["Pokretanje#1: no route app/api/live-ness/route.ts"]],
    ["3 curl outside /api", "1. Zdravlje. Naredba: `curl http://localhost:3000/`.", ["Pokretanje#1: curl URL is not under /api/: http://localhost:3000/"]],
    ["3 curl without a URL", "1. Zdravlje. Naredba: `curl -fsS`.", ["Pokretanje#1: curl command names no URL"]],
    ["3 curl with a second URL", "1. Zdravlje. Naredba: `curl -fsS http://localhost:3000/api/ready http://localhost:3000/api/nepostojeca`.", ["Pokretanje#1: curl names more than one URL: http://localhost:3000/api/ready http://localhost:3000/api/nepostojeca"]],
    ["3 curl with a URL without a scheme", "1. Zdravlje. Naredba: `curl -fsS http://localhost:3000/api/ready localhost:3000/api/ready`.", ["Pokretanje#1: curl names more than one URL: http://localhost:3000/api/ready localhost:3000/api/ready"]],
    ["4 program outside the list", "1. Briši. Naredba: `rm -rf data`.", ["Pokretanje#1: program not allowed: rm"]],
    ["4 empty inline code is refused", "1. Ništa. Naredba: ``.", [U("two or more backticks in a row")]],
    ["4 marker without code", "1. Ništa. Naredba: pokreni aplikaciju.", ["Pokretanje#1: Naredba: is not followed by a command in inline code"]],
    ["4 docker compose with a subcommand", "1. Stani. Naredba: `docker compose stop`.", []],
    ["4 docker without compose", "1. Stani. Naredba: `docker stop ductus`.", ["Pokretanje#1: docker command is not docker compose <subcommand>"]],
    ["4 kill with TERM", "1. Stani. Naredba: `kill -TERM <pid>`.", []],
    ["4 kill without a stop signal", "1. Stani. Naredba: `kill -9 <pid>`.", ["Pokretanje#1: kill sends neither -TERM nor -INT"]],
    ["4 command chain", "1. Pokreni. Naredba: `pnpm install --frozen-lockfile && pnpm prod:up`.", ["Pokretanje#1: command chains, pipes or redirects are not allowed: pnpm install --frozen-lockfile && pnpm prod:up"]],
    ["4 command sequence", "1. Pokreni. Naredba: `pnpm install; rm -rf data`.", ["Pokretanje#1: command chains, pipes or redirects are not allowed: pnpm install; rm -rf data"]],
    ["4 pipe and redirect", "1. Pokreni. Naredba: `pnpm local:up | tee log`, `pnpm local:up > log`.", ["Pokretanje#1: command chains, pipes or redirects are not allowed: pnpm local:up | tee log", "Pokretanje#1: command chains, pipes or redirects are not allowed: pnpm local:up > log"]],
    // Grok findings on #1803, in scope per the orchestrator (#1803 c.6759224276):
    // an environment prefix, a second signal and pnpm or node options.
    ["4 environment prefix is refused", "1. Pokreni. Naredba: `NODE_ENV=development pnpm local:up`.", ["Pokretanje#1: environment prefix not allowed: NODE_ENV=development"]],
    ["4 lower-case environment prefix is refused", "1. Pokreni. Naredba: `node_options=--import=x pnpm local:up`.", ["Pokretanje#1: environment prefix not allowed: node_options=--import=x"]],
    ["4 kill with a second signal before TERM", "1. Stani. Naredba: `kill -9 -TERM <pid>`.", ["Pokretanje#1: kill sends neither -TERM nor -INT"]],
    ["4 kill with a second signal after TERM", "1. Stani. Naredba: `kill -TERM -9 <pid>`.", ["Pokretanje#1: kill takes one signal and process ids only: -9"]],
    ["4 kill without a process", "1. Stani. Naredba: `kill -INT`.", ["Pokretanje#1: kill names no process"]],
    ["1 pnpm option before the script", "1. Pokreni. Naredba: `pnpm --dir=/tmp local:up`.", ["Pokretanje#1: pnpm option not allowed: --dir=/tmp"]],
    ["1 pnpm run option before the script", "1. Pokreni. Naredba: `pnpm run --filter x local:up`.", ["Pokretanje#1: pnpm option not allowed: --filter"]],
    ["1 pnpm option after the script", "1. Pokreni. Naredba: `pnpm local:up --dir=/tmp`.", ["Pokretanje#1: pnpm option not allowed: --dir=/tmp"]],
    ["1 pnpm install with an option outside the list", "1. Ovisnosti. Naredba: `pnpm install --dir=/tmp`.", ["Pokretanje#1: pnpm install argument not allowed: --dir=/tmp"]],
    ["1 pnpm install that adds a package", "1. Ovisnosti. Naredba: `pnpm install left-pad`.", ["Pokretanje#1: pnpm install argument not allowed: left-pad"]],
    ["2 node option before the file", "1. Baza. Naredba: `node --import=./x.mjs scripts/db/native-db.mjs`.", ["Pokretanje#1: node option not allowed: --import=./x.mjs"]],
    ["2 node option with a separate value", "1. Baza. Naredba: `node --require ./x.cjs scripts/db/native-db.mjs`.", ["Pokretanje#1: node option not allowed: --require"]],
    ["2 node arguments after the file belong to the script", "1. Baza. Naredba: `node scripts/db/native-db.mjs status --json`.", []],
    ["5 owner from the table", "1. Odluči. Nositelj: `vlasnik`.", []],
    ["5 owner with a space", "1. Odluči. Nositelj: `zamjenik vlasnika`.", []],
    ["5 owner not in the table", "1. Odluči. Nositelj: `dežurni`.", ["Pokretanje#1: owner not in Nositelji: dežurni"]],
    ["5 owner placeholder", "1. Odluči. Nositelj: `[Q-13: imenovati]`.", ["Pokretanje#1: owner not in Nositelji: [Q-13: imenovati]"]],
    ["5 owner without code", "1. Odluči. Nositelj: vlasnik.", ["Pokretanje#1: Nositelj: is not followed by an owner in inline code"]],
    ["5 command and owner together", "1. Odluči. Naredba: `pnpm local:up`; Nositelj: `vlasnik`.", []],
    ["5 a bad command is not saved by an owner", "1. Odluči. Naredba: `pnpm nope`; Nositelj: `vlasnik`.", ["Pokretanje#1: pnpm script not in package.json: nope"]],
    ["6 neither command nor owner", "1. Odluči što dalje.", ["Pokretanje#1: step has neither Naredba: nor Nositelj:"]],
    ["6 code that is not after a marker", "1. Pogledaj `pnpm local:up` u dokumentu.", ["Pokretanje#1: step has neither Naredba: nor Nositelj:"]],
    ["7 marker on an indented continuation line is refused", "1. Odluči.\n   Nositelj: `vlasnik`.", [U("indented line"), ...NONE]],
    ["7 marker on a lazy continuation line is refused", "1. Odluči.\nNositelj: `vlasnik`.", [U("lazy continuation"), ...NONE]],
    ["7 marker after a blank line, indented, is refused", "1. Odluči.\n\n   Nositelj: `vlasnik`.", [U("indented line", "-"), ...NONE]],
    ["7 marker after a blank line, not indented, is prose", "1. Odluči.\n\nNositelj: `vlasnik`.", NONE],
    ["7 marker after a blank line, indent 1, is refused", "1. Odluči.\n\n Nositelj: `vlasnik`.", [U("indented line", "-"), ...NONE]],
    ["7 marker after a blank line, indent 2, is refused", "1. Odluči.\n\n  Nositelj: `vlasnik`.", [U("indented line", "-"), ...NONE]],
    ["7 marker after a blank line under a wide step, indent 3, is refused", `${NINE_STEPS}10. Odluči.\n\n   Nositelj: \`vlasnik\`.`, [U("indented line", "-"), "Pokretanje#10: step has neither Naredba: nor Nositelj:"]],
    ["7 marker after a blank line under a wide step, indent 4, is refused", `${NINE_STEPS}10. Odluči.\n\n    Nositelj: \`vlasnik\`.`, [U("indented line", "-"), "Pokretanje#10: step has neither Naredba: nor Nositelj:"]],
    ["7 several commands after one marker", "1. Oba. Naredba: `pnpm local:up`, `pnpm nope`.", ["Pokretanje#1: pnpm script not in package.json: nope"]],
    ["7 code after the marker's sentence is not a command", "1. Spremnost. Naredba: `curl http://localhost:3000/api/ready`; odgovor `503` znači stani.", []],
    ["7 an indented fence is refused", "1. Odluči.\n   ```\n   Nositelj: `vlasnik`\n   ```", [U("indented fence"), U("indented line"), U("indented fence"), ...NONE]],
    ["7 an indented step is refused", "1. Prvi. Nositelj: `vlasnik`.\n 2. Drugi bez markera.", [U("indented line")]],
    ["7 an indented first step is refused", "   1. Prvi bez markera.", [U("indented line", "-"), "Pokretanje#-: procedure has no steps"]],
    ["7 a nested numbered line is refused", "1. Prvi. Nositelj: `vlasnik`.\n   2. podtočka", [U("indented line")]],
    ["7 a step numbered with a parenthesis is refused", "1. Prvi. Nositelj: `vlasnik`.\n2) Drugi bez markera.", [U("step form", "2")]],
    ["9 numbering with a gap", "1. Prvi. Nositelj: `vlasnik`.\n3. Treći. Nositelj: `vlasnik`.", ["Pokretanje#3: step is numbered 3, expected 2"]],
    ["9 numbering not from one", "2. Drugi. Nositelj: `vlasnik`.", ["Pokretanje#2: step is numbered 2, expected 1"]],
    ["12 bold markers", "1. Odluči. **Nositelj:** `vlasnik`. **Naredba:** `pnpm local:up`.", []],
    ["12 lower-case marker is not a marker", "1. Odluči. nositelj: `vlasnik`.", ["Pokretanje#1: step has neither Naredba: nor Nositelj:"]],
  ] as const)("%s", (_name, steps, expected) => {
    expect(messages(doc(steps))).toEqual(expected);
  });
});


// Takeover of #1803 by w540i: the seven input classes named in the contract on
// #1091, one row each, so the list in the contract maps to a test row.
describe("checkOperations: contract input classes (w540i)", () => {
  it.each([
    ["step with a command", "1. Pokreni. Naredba: `pnpm local:up`.", "", []],
    ["step with an owner", "1. Odluči. Nositelj: `vlasnik`.", "", []],
    ["step with neither", "1. Odluči što dalje.", "", NONE],
    ["empty section", "", "", ["Pokretanje#-: procedure has no steps"]],
    ["nested list", "1. Prvi. Nositelj: `vlasnik`.\n   - podstavka", "", [U("indented line")]],
    ["code block", "1. Prvi. Nositelj: `vlasnik`.\n\n```\n2. nije korak\n```", "", []],
    ["unknown ### heading in Postupci is checked like a procedure", "1. Prvi. Nositelj: `vlasnik`.", "\n### Nepoznato\n\n1. Odluči.\n", ["Nepoznato#1: step has neither Naredba: nor Nositelj:"]],
    ["unknown ### heading without steps", "1. Prvi. Nositelj: `vlasnik`.", "\n### Nepoznato\n\nSamo tekst.\n", ["Nepoznato#-: procedure has no steps"]],
    ["unknown ## heading ends the strict section", "1. Prvi. Nositelj: `vlasnik`.", "\n## Dodatak\n\n1. Odluči.\n", []],
  ] as const)("%s", (_name, steps, extra, expected) => {
    expect(messages(doc(steps, { extra }))).toEqual(expected);
  });
});


describe("checkOperations: a step is one line at column 0", () => {
  it.each([
    ["N1 blank line, indent 0 is prose", "1. Odluči.\n\nNositelj: `vlasnik`.", NONE],
    ...[1, 2, 3, 4, 6].map((n) => [`N1 blank line, indent ${n} is refused`, `1. Odluči.\n\n${" ".repeat(n)}Nositelj: \`vlasnik\`.`, [U("indented line", "-"), ...NONE]] as const),
    ["N1 blank line, a tab is refused", "1. Odluči.\n\n\tNositelj: `vlasnik`.", [U("indented line", "-"), ...NONE]],
    ...["   ", "    ", "\t"].map((ind) => [`N1 step 10, indent ${JSON.stringify(ind)} is refused`, `${NINE}\n10. Deseti.\n\n${ind}Nositelj: \`vlasnik\`.`, [U("indented line", "-"), "Pokretanje#10: step has neither Naredba: nor Nositelj:"]] as const),
    ["N1 step indented by one is refused", " 1. Odluči.\n\n   Nositelj: `vlasnik`.", [U("indented line", "-"), U("indented line", "-"), "Pokretanje#-: procedure has no steps"]],
    ["N1 two spaces after the number are refused", "1.  Odluči.\n\n   Nositelj: `vlasnik`.", [U("step form"), U("indented line", "-")]],
    ["N1 a tab after the number is refused", "1.\tOdluči.\n\n\tNositelj: `vlasnik`.", [U("step form"), U("indented line", "-")]],
    ["N1 five spaces after the number are refused", "1.     Odluči.\n\n   Nositelj: `vlasnik`.", [U("step form"), U("indented line", "-")]],
    ["N1 a lazy line after an indented paragraph", "1. Odluči.\n\n   Dalje.\nNositelj: `vlasnik`.", [U("indented line", "-"), ...NONE]],
    ["N1 a bullet in column 0 is refused", "1. Odluči.\n- Nositelj: `vlasnik`.", [U("line form"), ...NONE]],
    ["N1 a quote in column 0 is refused", "1. Odluči.\n> Nositelj: `vlasnik`.", [U("line form"), ...NONE]],
    ["N1 --- under a step is refused", "1. Odluči.\n---\nNositelj: `vlasnik`.", [U("setext heading underline"), U("lazy continuation"), ...NONE]],
    ["N1 a fence in column 0 ends the step", "1. Odluči.\n```\nx\n```\nNositelj: `vlasnik`.", NONE],
    ["N1 an indented bullet is refused", "1. Odluči.\n   - Nositelj: `vlasnik`.", [U("indented line"), ...NONE]],
    ["N1 an indented quote is refused", "1. Odluči.\n   > Nositelj: `vlasnik`.", [U("indented line"), ...NONE]],
    ["N1 a closed indented fence", "1. Odluči.\n   ```\n   x\n   ```\nNositelj: `vlasnik`.", [U("indented fence"), U("indented line"), U("indented fence"), U("lazy continuation"), ...NONE]],
  ] as const)("%s", (_name, steps, expected) => {
    expect(messages(doc(steps))).toEqual(expected);
  });
});

const THEMATIC = ["***", "---", "___"] as const;
const SPACES = [0, 1, 2, 3] as const;

describe("checkOperations: a thematic break in a procedure is refused", () => {
  const rows = THEMATIC.flatMap((mark) =>
    SPACES.flatMap((n) => {
      const ind = " ".repeat(n);
      const form = n === 0 ? "line form" : "indented line";
      return [
        [`${mark} at ${n} after a step's paragraph`, `1. Odluči.\n${ind}${mark}\nNositelj: \`vlasnik\`.`, [U(mark === "---" ? "setext heading underline" : form), U("lazy continuation"), ...NONE]],
        [`${mark} at ${n} after a blank line`, `1. Odluči.\n\n${ind}${mark}\nNositelj: \`vlasnik\`.`, [U(form, "-"), ...NONE]],
        [`${mark} at ${n} before the first step`, `${ind}${mark}\n\n1. Prvi. Nositelj: \`vlasnik\`.`, [U(form, "-")]],
      ] as const;
    }),
  );
  it.each([
    ...rows,
    ["spaced * * * after a blank line", "1. Odluči.\n\n   * * *\nNositelj: `vlasnik`.", [U("indented line", "-"), ...NONE]],
    ["--- after a list marker", "1. Odluči.\n   - ---\n   Nositelj: `vlasnik`.", [U("indented line"), U("indented line"), ...NONE]],
    // Review c.6745140337, verbatim.
    ["review: indented *** after a blank line", "1. Odluči.\n\n   ***\nNositelj: `vlasnik`.", [U("indented line", "-"), ...NONE]],
    // QA c.6745187879, verbatim.
    ["QA: indented *** before an unindented owner", "1. Postupi.\n\n   ***\nNositelj: `vlasnik`.", [U("indented line", "-"), ...NONE]],
  ] as const)("%s", (_name, steps, expected) => {
    expect(messages(doc(steps))).toEqual(expected);
  });
});

describe("checkOperations: a fence is backticks at column 0 only", () => {
  const rows = (["```", "~~~"] as const).flatMap((f) =>
    SPACES.flatMap((n) => {
      const ind = " ".repeat(n);
      const tilde = f === "~~~";
      const mark = tilde ? "tilde fence" : "indented fence";
      return [
        [`${f} at ${n} before the first step`, `${ind}${f}\nx\n${ind}${f}\n\n1. Prvi. Nositelj: \`vlasnik\`.`, !tilde && n === 0 ? [] : [U(mark, "-"), U(mark, "-")]],
        [
          `${f} at ${n} after a step's paragraph`,
          `1. Odluči.\n${ind}${f}\n${ind}Nositelj: \`vlasnik\`\n${ind}${f}`,
          !tilde && n === 0 ? NONE : [U(mark), U(n === 0 ? "lazy continuation" : "indented line"), U(mark), ...NONE],
        ],
      ] as const;
    }),
  );
  it.each([
    ...rows,
    ["a backtick in the info string", "1. Odluči.\n\n```a`b\nNositelj: `vlasnik`.", [U("fence form", "-"), ...NONE]],
    ["an info string of two words", "1. Odluči.\n\n```js x\nNositelj: `vlasnik`.", [U("fence form", "-"), ...NONE]],
  ] as const)("%s", (_name, steps, expected) => {
    expect(messages(doc(steps))).toEqual(expected);
  });

  const inside = ["Incident#-: unsupported markdown: fence line inside a fence", "Incident#-: unsupported markdown: unclosed fence"];
  it.each([
    ["exactly", "```", "```", []],
    ["with trailing spaces", "```", "```   ", []],
    ["with a trailing tab", "```", "```\t", []],
    ["by a longer mark", "```", "````", []],
    ["not by a mark with text", "```", "``` nije kraj", inside],
    ["not by a mark with a tab and text", "```", "```\tnije kraj", inside],
    ["not by an indented mark", "```", "   ```", inside],
    ["not by a mark indented by one", "```", " ```", inside],
    ["not by tildes", "```", "~~~", inside],
    ["not by two backticks", "```", "``", ["Incident#-: unsupported markdown: unclosed fence"]],
    ["not by a shorter mark", "````", "```", inside],
  ] as const)("a fence closes %s", (_name, open, close, expected) => {
    expect(messages(doc("1. Odluči. Nositelj: `vlasnik`.", { extra: `\n${open}\nx\n${close}\n` }))).toEqual(expected);
  });

  it("an unclosed fence in the last procedure is refused at its opening line", () => {
    const text = doc("1. Odluči. Nositelj: `vlasnik`.", { extra: "\n```\nx\n" });
    const opening = text.split("\n").indexOf("```") + 1;
    expect(checkOperations(text, CONTEXT).filter((p) => p.message.startsWith("unsupported"))).toEqual([
      { procedure: "Incident", step: null, line: opening, message: "unsupported markdown: unclosed fence" },
    ]);
  });

  // QA c.6745187879, verbatim: tildes never open or close a fence.
  it("QA: tilde lines are refused at their lines", () => {
    const text = doc("1. Odluči. Nositelj: `vlasnik`.").replace(
      `### Incident\n\n1. ${VALID_STEP}\n`,
      "### Incident\n\n1. Postupi.\n   ~~~text\n   ~~~ nije kraj\n   Nositelj: `vlasnik`.\n",
    );
    expect(messages(text)).toEqual([
      "Incident#1: unsupported markdown: tilde fence",
      "Incident#1: unsupported markdown: tilde fence",
      "Incident#1: unsupported markdown: indented line",
      "Incident#1: step has neither Naredba: nor Nositelj:",
    ]);
    const lines = text.split("\n");
    const [first, second] = checkOperations(text, CONTEXT);
    expect(first?.line).toBe(lines.indexOf("   ~~~text") + 1);
    expect(second?.line).toBe(lines.indexOf("   ~~~ nije kraj") + 1);
  });
});

describe("checkOperations: other lines outside the subset are refused", () => {
  it.each([
    ["tab before a step's content line", "1. Odluči.\n \tNositelj: `vlasnik`.", [U("indented line"), ...NONE]],
    ["tab before prose after a blank line", "1. Prvi. Nositelj: `vlasnik`.\n\n\tNapomena.", [U("indented line", "-")]],
    ["lazy line in column 0", "1. Odluči.\nNositelj: `vlasnik`.", [U("lazy continuation"), ...NONE]],
    ["lazy line at indent 2", "1. Odluči.\n  Nositelj: `vlasnik`.", [U("indented line"), ...NONE]],
    ["HTML comment in a step", "1. Odluči.\n   <!-- Nositelj: `vlasnik`. -->", [U("HTML block"), ...NONE]],
    ["HTML block in prose", "1. Prvi. Nositelj: `vlasnik`.\n\n<div>\n2. Drugi.\n</div>", [U("HTML block", "-"), U("HTML block", "2"), "Pokretanje#2: step has neither Naredba: nor Nositelj:"]],
    ["indented code after a blank line", "1. Odluči.\n\n       Nositelj: `vlasnik`.", [U("indented line", "-"), ...NONE]],
    ["indented heading", "1. Prvi. Nositelj: `vlasnik`.\n\n  ### Gašenje", [U("indented heading", "-")]],
    ["a heading below level 3", "1. Prvi. Nositelj: `vlasnik`.\n\n#### Napomena", [U("heading level", "-")]],
    ["empty step", "1. Prvi. Nositelj: `vlasnik`.\n2.\n   Bez markera.", [U("step form", "2"), U("indented line", "2")]],
    ["empty nested bullet", "1. Odluči.\n   -\n   Nositelj: `vlasnik`.", [U("setext heading underline"), U("indented line"), ...NONE]],
    ["number of ten digits", "1234567890. Odluči. Nositelj: `vlasnik`.", [U("step form", "-"), "Pokretanje#-: procedure has no steps"]],
    ["step right after a paragraph", "Uvod.\n1. Odluči. Nositelj: `vlasnik`.", [U("step right after a paragraph")]],
    ["step right after a bullet", "- Uvod.\n2. Odluči. Nositelj: `vlasnik`.", [U("line form", "-"), "Pokretanje#2: step is numbered 2, expected 1"]],
    ["quote after a list marker", "1. Odluči.\n   - > Nositelj: `vlasnik`.", [U("indented line"), ...NONE]],
    ["link reference definition in a step", "1. [x]: /a \"Nositelj: `vlasnik`\"", [U("step form")]],
    ["inline HTML comment around the owner", "1. Odluči. <!-- Nositelj: `vlasnik`. -->", [U("inline HTML")]],
    ["inline tag around the owner", "1. Odluči. Nositelj: <span>`vlasnik`</span>.", [U("inline HTML")]],
    ["inline HTML in prose", "1. Prvi. Nositelj: `vlasnik`.\n\nNapomena <b>važno</b>.", [U("inline HTML", "-")]],
    ["a placeholder in code is not HTML", "1. Stani. Naredba: `kill -TERM <pid>`; Nositelj: `vlasnik`.", []],
    ["bot: a double-backtick span is refused", "1. Odluči što se vraća. Primjer zapisa: ``Nositelj: `vlasnik` ``.", [U("two or more backticks in a row")]],
    ["Naredba: inside a double-backtick span is refused", "1. Pokreni. Primjer: ``Naredba: `rm -rf /` ``. Nositelj: `vlasnik`.", [U("two or more backticks in a row")]],
    ["orchestrator: Naredba: inside a code span is refused", "1. Pokreni. Primjer: `Naredba: rm -rf /`. Nositelj: `vlasnik`.", [U("marker inside a code span")]],
    ["orchestrator: Nositelj: inside a code span is refused", "1. Odluči. Primjer: `Nositelj: vlasnik`.", [U("marker inside a code span")]],
    ["orchestrator: a bold marker inside a code span is refused", "1. Odluči. `**Nositelj:** x` Nositelj: `vlasnik`.", [U("marker inside a code span")]],
    ["orchestrator: a lower-case marker inside a code span is refused", "1. Odluči. `naredba: x` Nositelj: `vlasnik`.", [U("marker inside a code span")]],
    ["bot: Nositelj: in a link title is refused", '1. Odluči. [vidi](/x "Nositelj: `vlasnik`")', [U("square bracket outside code (link or image)")]],
    ["bot: Naredba: in a link title is refused", '1. Pokreni. [vidi](/x "Naredba: `pnpm local:up`")', [U("square bracket outside code (link or image)")]],
    ["bot: Nositelj: in an image alt text is refused", "1. Odluči. ![Nositelj: `vlasnik`](/x.png)", [U("square bracket outside code (link or image)")]],
    ["a plain link in a step is refused", "1. Odluči. Vidi [upute](/x). Nositelj: `vlasnik`.", [U("square bracket outside code (link or image)")]],
    ["brackets inside code in a step are allowed", "1. Odluči. Nositelj: `vlasnik`. `[PRAVILO]`", []],
    ["a link on a prose line is not read", "1. Prvi. Nositelj: `vlasnik`.\n\nVidi [upute](/x \"Naredba: `x`\").", []],
    ["a marker in a code span on a prose line is not read", "1. Prvi. Nositelj: `vlasnik`.\n\nPrimjer `Naredba: x`.", []],
    ["a marker after a single-backtick span still counts", "1. Odluči o `x`. Nositelj: `vlasnik`.", []],
    ["an unmatched `` is refused", "1. Odluči ``a`. Nositelj: `vlasnik`.", [U("two or more backticks in a row")]],
    ["three backticks inside a step", "1. Odluči ```x``` Nositelj: `vlasnik`.", [U("two or more backticks in a row")]],
    ["a code span not closed on its step line", "1. Odluči `x. Nositelj: `vlasnik`.", [U("code span not closed on its line")]],
    ["a code span not closed on a prose line", "1. Prvi. Nositelj: `vlasnik`.\n\nNapomena `x.", [U("code span not closed on its line", "-")]],
    // Review c.6747088572, verbatim.
    ["review: a span closed by a double backtick", "1. Pokreni. Naredba: `pnpm local:up``; rm -rf data`.", [U("two or more backticks in a row")]],
    // QA c.6747098696, verbatim.
    ["QA: a chain after a double backtick", "1. Pokreni. Naredba: `pnpm local:up`` && pnpm prod:up`.", [U("two or more backticks in a row")]],
    // Grok c.6746696160, verbatim.
    ["Grok: an escaped backtick", "1. Odluči. \\`` x `` Nositelj: `vlasnik` `` y.", [U("backslash before a backtick")]],
    ["setext = underline after prose", "1. Prvi. Nositelj: `vlasnik`.\n\nDodatak\n=======", [U("setext heading underline", "-")]],
    ["setext -- underline after prose", "1. Prvi. Nositelj: `vlasnik`.\n\nDodatak\n--", [U("setext heading underline", "-")]],
    ["setext = underline in a step's content", "1. Odluči.\n   ===\n   Nositelj: `vlasnik`.", [U("setext heading underline"), U("indented line"), ...NONE]],
    ["a single = is an underline too", "1. Odluči.\n   =\n   Nositelj: `vlasnik`.", [U("setext heading underline"), U("indented line"), ...NONE]],
  ] as const)("%s", (_name, steps, expected) => {
    expect(messages(doc(steps))).toEqual(expected);
  });

  it("a step outside a procedure is refused", () => {
    const text = doc("1. Odluči. Nositelj: `vlasnik`.").replace("## Postupci\n\n", "## Postupci\n\n1. Skriveni. Nositelj: `vlasnik`.\n\n");
    expect(messages(text)).toEqual(["Postupci#-: unsupported markdown: step outside a procedure"]);
  });

  it("bot: a setext heading before the next section is refused", () => {
    const text = doc("1. Odluči. Nositelj: `vlasnik`.", { extra: "\nDodatak\n=======\n\n9. Nešto. Nositelj: `vlasnik`.\n\n## Pilot (M12)\n" });
    expect(messages(text)).toContain(`${REQUIRED_PROCEDURES.at(-1)}#-: unsupported markdown: setext heading underline`);
  });

  it("an HTML block before the procedures is refused, so it cannot hide one", () => {
    const text = doc("1. Odluči. Nositelj: `vlasnik`.").replace("## Postupci\n\n", "## Postupci\n\n<!--\n### Skriveni\n\n1. Korak. Nositelj: `vlasnik`.\n\n-->\n\n");
    expect(messages(text)).toContain("Postupci#-: unsupported markdown: HTML block");
  });
});

describe("checkOperations: the Nositelji table is one plain table", () => {
  const step = "1. Prvi. Nositelj: `vlasnik`.";
  const missing = (what: string) => [
    "Nositelji#-: owners table is missing or empty",
    `Nositelji#-: unsupported markdown: ${what}`,
    "Pokretanje#1: owner not in Nositelji: vlasnik",
  ];
  it.each([
    ["without a separator row", OWNERS.replace("| --- | --- |\n", ""), missing("table without a separator row")],
    // QA c.6747107868: a table without a separator row is not a table.
    ["with a separator of the wrong width", OWNERS.replace("| --- | --- |", "| --- |"), missing("table separator does not match the header")],
    ["right after a paragraph", OWNERS.replace("\n\n|", "\nUvod.\n|"), missing("table right after a paragraph")],
    ["followed by a line without a blank", `${OWNERS}Dodatak.\n`, ["Nositelji#-: unsupported markdown: line right after a table"]],
    ["followed by an indented row", `${OWNERS}  | \`x\` | y |\n`, ["Nositelji#-: unsupported markdown: indented line"]],
    // QA and review FAIL on e472fa77 (c.6751405101, c.6751408864): a body row of another width is refused.
    ["with a row of fewer cells", `${OWNERS}| \`dežurni\` |\n`, ["Nositelji#-: unsupported markdown: table row does not match the header"]],
    ["with a row of more cells", `${OWNERS}| \`dežurni\` | x | y |\n`, ["Nositelji#-: unsupported markdown: table row does not match the header"]],
    [
      "with the only matching owner in a short row",
      OWNERS.replace("| `vlasnik` | tehnički kvarovi |", "| `vlasnik` |"),
      ["Nositelji#-: unsupported markdown: table row does not match the header", "Pokretanje#1: owner not in Nositelji: vlasnik"],
    ],
    ["with an owner in a double-backtick span", `${OWNERS}| \`\`dežurni\`\` | x |\n`, ["Nositelji#-: unsupported markdown: two or more backticks in a row"]],
  ] as const)("%s", (_name, owners, expected) => {
    expect(messages(doc(step, { owners }))).toEqual(expected);
  });
});

describe("checkOperations: curl names exactly one plain URL", () => {
  const curl = (args: string) => `1. Provjeri. Naredba: \`curl ${args}\`.`;
  const ready = "http://localhost:3000/api/ready";
  const health = "http://localhost:3000/api/health";
  const nope = "http://localhost:3000/api/nope";
  const missing = ["Pokretanje#1: no route app/api/nope/route.ts"];
  const several = (...urls: string[]) => [`Pokretanje#1: curl names more than one URL: ${urls.join(" ")}`];
  it.each([
    ["N2 one URL that exists", `-fsS ${ready}`, []],
    ["N2 one URL that does not exist", `-fsS ${nope}`, missing],
    ["N2 two URLs that exist", `-fsS ${ready} ${health}`, several(ready, health)],
    ["N2 two URLs, the first missing", `-fsS ${nope} ${ready}`, several(nope, ready)],
    ["N2 two URLs, the second missing", `-fsS ${ready} ${nope}`, several(ready, nope)],
    ["N2 three URLs, the first missing", `${nope} ${ready} ${health}`, several(nope, ready, health)],
    ["N2 three URLs, the second missing", `${ready} ${nope} ${health}`, several(ready, nope, health)],
    ["N2 three URLs, the third missing", `${ready} ${health} ${nope}`, several(ready, health, nope)],
    ["N2 a URL without a scheme", "-fsS localhost:3000/api/ready", ["Pokretanje#1: curl argument is not an http(s) URL: localhost:3000/api/ready"]],
    ["N2 --url is not an allowed option", `--url ${nope} ${ready}`, ["Pokretanje#1: curl option not allowed: --url"]],
    ["N2 an option with a file", `-o out ${ready}`, ["Pokretanje#1: curl option not allowed: -o"]],
    ["N2 a config file", `-K cfg ${ready}`, ["Pokretanje#1: curl option not allowed: -K"]],
    ["N2 a header", `-H X-Test:1 ${ready}`, ["Pokretanje#1: curl option not allowed: -H"]],
    ["N2 a value joined to short flags", `-fsSo out ${ready}`, ["Pokretanje#1: curl option not allowed: -fsSo"]],
    ["N2 a value joined to an option", `-oout ${ready}`, ["Pokretanje#1: curl option not allowed: -oout"]],
    ["N2 a long option with a value", `--config=cfg ${ready}`, ["Pokretanje#1: curl option not allowed: --config=cfg"]],
    ["N2 allowed flags", `--fail --silent --show-error -i ${ready}`, []],
    ["N2 a brace glob", "http://localhost:3000/api/{ready,nope}", ["Pokretanje#1: curl URL globbing is not allowed: http://localhost:3000/api/{ready,nope}"]],
    ["N2 a range glob", `${ready}[1-2]`, [`Pokretanje#1: curl URL globbing is not allowed: ${ready}[1-2]`]],
  ] as const)("%s", (_name, args, expected) => {
    expect(messages(doc(curl(args)))).toEqual(expected);
  });
});

// Review FAIL c.6764268500 on 4203cc68 (#1803), contract #1836 c.6764529056
// (w540k): Bash drops an unquoted backslash while new URL() reads it as `/`,
// and new URL() resolves dot segments that curl may send as written, so the
// path that is checked must be the path in the text of the URL.
describe("checkOperations: the curl path is checked as written", () => {
  const curl = (url: string) => `1. Provjeri. Naredba: \`curl -fsS ${url}\`.`;
  const slash = (url: string) => [`Pokretanje#1: curl URL contains a backslash: ${url}`];
  const normal = (url: string) => [`Pokretanje#1: curl URL path is not in normal form: ${url}`];
  const base = "http://localhost:3000";
  it.each([
    ["B1 a backslash for a slash in the path", `${base}/api\\health`, slash],
    // At the end of the span the backslash is refused earlier, before a backtick.
    ["B2 a backslash at the end", `${base}/api/health\\`, () => [U("backslash before a backtick")]],
    ["B2 a backslash before the query", `${base}/api/ready\\?x=1`, slash],
    ["B3 a backslash in the authority", `${base}\\api/health`, slash],
    ["B4 a doubled backslash", `${base}/api\\\\health`, slash],
    ["B5 a backslash before a letter", `${base}/api/\\health`, slash],
    ["B6 a backslash in the query", `${base}/api/ready?x=\\1`, slash],
    ["P1 a dot-dot segment", `${base}/api/x/../health`, normal],
    ["P2 a dot segment", `${base}/api/./health`, normal],
    ["P3 an encoded dot-dot segment", `${base}/api/x/%2e%2e/health`, normal],
    ["P3 a mixed encoded dot-dot segment", `${base}/api/x/%2E./health`, normal],
    ["P4 an empty segment is kept as written", `${base}/api//health`, () => ["Pokretanje#1: no route app/api//health/route.ts"]],
    ["K1 a plain path", `${base}/api/health`, () => []],
    ["K1 a query", `${base}/api/ready?x=1`, () => []],
    ["K1 a trailing slash", `${base}/api/ready/`, () => []],
  ] as const)("%s", (_name, url, expected) => {
    expect(messages(doc(curl(url)))).toEqual(expected(url));
  });
});

describe("checkOperations: document structure", () => {
  it("7 a numbered line in a fence at the top level is not a step", () => {
    const steps = "1. Prvi. Nositelj: `vlasnik`.\n\n```\n2. nije korak\n```";
    expect(messages(doc(steps))).toEqual([]);
    expect(parseOperations(doc(steps)).procedures[0]?.steps).toHaveLength(1);
  });

  it("8 a missing required procedure", () => {
    const text = doc("1. Prvi. Nositelj: `vlasnik`.").replace("### Incident", "### Nešto drugo");
    expect(messages(text)).toEqual(["Incident#-: required procedure is missing"]);
  });

  it("8 a duplicated procedure", () => {
    const text = doc("1. Prvi. Nositelj: `vlasnik`.", { extra: "\n### Povrat\n\n1. Opet. Nositelj: `vlasnik`.\n" });
    expect(messages(text)).toEqual(["Povrat#-: procedure appears more than once"]);
  });

  it("8 a procedure without steps", () => {
    expect(messages(doc("Ovdje još nema koraka."))).toEqual(["Pokretanje#-: procedure has no steps"]);
  });

  it("8 a procedure outside the Postupci section is not checked", () => {
    const text = doc("1. Prvi. Nositelj: `vlasnik`.", { extra: "\n## Pilot\n\n### STOP\n\n1. Bez nositelja.\n" });
    expect(messages(text)).toEqual([]);
  });

  it("8 no Postupci section at all", () => {
    const text = `# Operacije\n\n${OWNERS}`;
    expect(messages(text)).toEqual(REQUIRED_PROCEDURES.map((name) => `${name}#-: required procedure is missing`));
  });

  it("10 a missing owners table", () => {
    const text = doc("1. Prvi. Nositelj: `vlasnik`.", { owners: "" });
    expect(messages(text)).toEqual(["Nositelji#-: owners table is missing or empty", "Pokretanje#1: owner not in Nositelji: vlasnik"]);
  });

  it("10 an owner row that is a placeholder is refused", () => {
    const owners = `${OWNERS}| \`[Q-13: imenovati]\` | zamjena |\n`;
    expect(messages(doc("1. Prvi. Nositelj: `vlasnik`.", { owners }))).toEqual([
      "Nositelji#-: owner is not a plain role name: [Q-13: imenovati]",
    ]);
  });

  it("11 CRLF and trailing spaces give the same result as LF", () => {
    const text = doc("1. Prvi. Nositelj: `vlasnik`.  \n2. Drugi. Naredba: `pnpm nope`.   \n3. Treći.");
    const crlf = text.replace(/\n/g, "\r\n").replace(/\.\r\n/g, ".  \r\n");
    expect(messages(crlf)).toEqual(messages(text));
    expect(messages(text)).toEqual(["Pokretanje#2: pnpm script not in package.json: nope", "Pokretanje#3: step has neither Naredba: nor Nositelj:"]);
  });

  it("reports the line of the step", () => {
    const text = doc("1. Prvi. Nositelj: `vlasnik`.\n2. Drugi.");
    const [problem] = checkOperations(text, CONTEXT);
    expect(text.split("\n")[(problem?.line ?? 0) - 1]).toBe("2. Drugi.");
  });
});

// Review and QA FAIL on 2d9c1e79 (#1803 c.6760241487, c.6760261772), contract
// on #1836 (w540j): classes P1 to P7 for `pnpm run`, H1 to H10 for headings.
describe("checkOperations: pnpm run always names a package.json script", () => {
  const MISSING_INSTALL = ["Pokretanje#1: pnpm script not in package.json: install"];
  const withInstall = { ...CONTEXT, scripts: new Set([...CONTEXT.scripts, "install"]) };
  it.each([
    ["P1 pnpm install is built in", "`pnpm install`", CONTEXT, []],
    ["P2 pnpm install with an allowed option", "`pnpm install --frozen-lockfile`", CONTEXT, []],
    ["P3 pnpm run install without an install script", "`pnpm run install`", CONTEXT, MISSING_INSTALL],
    ["P4 pnpm run install with an option, without the script", "`pnpm run install --frozen-lockfile`", CONTEXT, MISSING_INSTALL],
    ["P5 pnpm run install with an install script", "`pnpm run install`", withInstall, []],
    ["P6 pnpm run with a script that exists", "`pnpm run local:up`", CONTEXT, []],
    ["P7 pnpm run without a script", "`pnpm run`", CONTEXT, ["Pokretanje#1: pnpm command names no script"]],
  ] as const)("%s", (_name, command, context, expected) => {
    const found = checkOperations(doc(`1. Pokreni. Naredba: ${command}.`), context).map((p) => `${p.procedure}#${p.step ?? "-"}: ${p.message}`);
    expect(found).toEqual(expected);
  });
});

describe("checkOperations: a closing run of # is not part of a heading (CommonMark ATX)", () => {
  const BAD = "1. Odluči što dalje.";
  const MISSING = REQUIRED_PROCEDURES.map((name) => `${name}#-: required procedure is missing`);
  const postupci = (heading: string) => doc(BAD).replace("\n## Postupci\n", `\n${heading}\n`);
  it.each([
    ["H1 closing run after a space", postupci("## Postupci ##"), NONE],
    ["H2 closing run of one #", postupci("## Postupci #"), NONE],
    ["H2 closing run longer than the opening", postupci("## Postupci ##########"), NONE],
    ["H3 closing run after a tab, tabs around the title", postupci("##\tPostupci\t##\t"), NONE],
    ["H4 # without a space before it stays in the title", postupci("## Postupci##"), MISSING],
    ["H5 only the last run is a closing run", postupci("## Postupci # #"), MISSING],
    ["H6 a heading of # only is empty", postupci("## ##"), MISSING],
    ["H6 a heading of one # is empty", postupci("## #"), MISSING],
    ["H7 an escaped # is not a closing run", postupci("## Postupci \\##"), MISSING],
    ["H8 a procedure heading with a closing run", doc(BAD).replace("### Pokretanje\n", "### Pokretanje ###\n"), NONE],
    ["H9 the owners heading with a closing run", doc("1. Odluči. Nositelj: `vlasnik`.").replace("## Nositelji\n", "## Nositelji ##\n"), []],
    [
      "H10 QA: a second Postupci with a closing run is read strictly",
      doc("1. Odluči. Nositelj: `vlasnik`.", { extra: "\n## Postupci ##\n\n### Dodatni\n\n1. Bez naredbe i nositelja.\n" }),
      ["Dodatni#1: step has neither Naredba: nor Nositelj:"],
    ],
  ] as const)("%s", (_name, text, expected) => {
    expect(messages(text)).toEqual(expected);
  });
});

// QA FAIL c.6764305873 on 4203cc68 (#1803), contract #1836 c.6764529056
// (w540k): CommonMark strips only spaces (U+0020) and tabs around a heading
// and its closing run, so any other space character stays in the title.
const UNICODE_SPACES = [
  "\u00a0", "\u1680", "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006", "\u2007",
  "\u2008", "\u2009", "\u200a", "\u202f", "\u205f", "\u3000", "\ufeff", "\u0085", "\u000b", "\u000c",
  "\u2028", "\u2029",
] as const;

describe("checkOperations: only spaces and tabs are stripped around a heading", () => {
  const BAD = "1. Odluči što dalje.";
  const MISSING = REQUIRED_PROCEDURES.map((name) => `${name}#-: required procedure is missing`);
  const postupci = (heading: string) => doc(BAD).replace("\n## Postupci\n", `\n${heading}\n`);
  const code = (z: string) => `U+${z.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`;
  const rows = UNICODE_SPACES.flatMap((z) => [
    [`U1 ${code(z)} after the closing run`, postupci(`## Postupci ##${z}`)],
    [`U2 ${code(z)} between the closing run and a space`, postupci(`## Postupci ##${z} `)],
    [`U3 ${code(z)} for the space before the closing run`, postupci(`## Postupci${z}##`)],
    [`U4 ${code(z)} at the end of the title`, postupci(`## Postupci${z}`)],
    [`U5 ${code(z)} at the start of the title`, postupci(`## ${z}Postupci`)],
  ]);
  it.each(rows)("%s: Postupci is not found", (_name, text) => {
    expect(messages(text)).toEqual(expect.arrayContaining(MISSING));
  });

  it.each(UNICODE_SPACES.map((z) => [code(z), z]))("U1 %s after the closing run of a procedure heading", (_name, z) => {
    const text = doc(BAD).replace("### Pokretanje\n", `### Pokretanje ###${z}\n`);
    expect(messages(text)).toContain("Pokretanje#-: required procedure is missing");
  });

  it.each(UNICODE_SPACES.map((z) => [code(z), z]))("U6 a line of %s only in a procedure is not a blank line", (_name, z) => {
    const text = doc(`1. Prvi. Nositelj: \`vlasnik\`.\n${z}\n2. Drugi. Nositelj: \`vlasnik\`.`);
    expect(messages(text).some((m) => m.includes("unsupported markdown: "))).toBe(true);
  });

  it.each([
    ["K2 a space after the closing run", postupci("## Postupci ## "), NONE],
    ["K2 a tab after the closing run", postupci("## Postupci ##\t"), NONE],
    ["K2 a tab before the title", postupci("##\tPostupci"), NONE],
    ["K2 a line of spaces and tabs is a blank line", doc("1. Prvi. Nositelj: `vlasnik`.\n \t \n2. Drugi. Nositelj: `vlasnik`."), []],
  ] as const)("%s", (_name, text, expected) => {
    expect(messages(text)).toEqual(expected);
  });
});

describe("docs/OPERATIONS.md on this branch", () => {
  const text = readFileSync(new URL("../../docs/OPERATIONS.md", import.meta.url), "utf8");
  const context = repoContext(new URL("../..", import.meta.url));

  it("has every required procedure with steps and passes the check", () => {
    const { procedures } = parseOperations(text);
    for (const name of REQUIRED_PROCEDURES) {
      expect(procedures.find((p: { name: string }) => p.name === name)?.steps.length ?? 0).toBeGreaterThan(0);
    }
    expect(checkOperations(text, context)).toEqual([]);
  });

  it("refuses the real document once its owners table loses the separator row", () => {
    const broken = text.replace(/^\| --- \| --- \| --- \| --- \| --- \|\n/m, "");
    expect(broken).not.toBe(text);
    const found = checkOperations(broken, context).map((p) => `${p.procedure}#${p.step ?? "-"}: ${p.message}`);
    expect(found).toContain("Nositelji#-: unsupported markdown: table without a separator row");
  });

  it("the repository context sees real scripts, files and routes only", () => {
    expect(context.scripts.has("local:up")).toBe(true);
    expect(context.scripts.has("prod:up")).toBe(false);
    expect(context.fileExists("scripts/operations/check-procedures.mjs")).toBe(true);
    expect(context.fileExists("scripts/operations/nope.mjs")).toBe(false);
    expect(context.fileExists("../outside.mjs")).toBe(false);
    expect(context.routeExists("/api/ready")).toBe(true);
    expect(context.routeExists("/api/nope")).toBe(false);
    expect(context.routeExists("/api/../package.json")).toBe(false);
  });
});
