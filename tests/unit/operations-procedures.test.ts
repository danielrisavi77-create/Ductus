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
    ["4 empty inline code", "1. Ništa. Naredba: ``.", ["Pokretanje#1: Naredba: is not followed by a command in inline code"]],
    ["4 marker without code", "1. Ništa. Naredba: pokreni aplikaciju.", ["Pokretanje#1: Naredba: is not followed by a command in inline code"]],
    ["4 docker compose with a subcommand", "1. Stani. Naredba: `docker compose stop`.", []],
    ["4 docker without compose", "1. Stani. Naredba: `docker stop ductus`.", ["Pokretanje#1: docker command is not docker compose <subcommand>"]],
    ["4 kill with TERM", "1. Stani. Naredba: `kill -TERM <pid>`.", []],
    ["4 kill without a stop signal", "1. Stani. Naredba: `kill -9 <pid>`.", ["Pokretanje#1: kill sends neither -TERM nor -INT"]],
    ["4 command chain", "1. Pokreni. Naredba: `pnpm install --frozen-lockfile && pnpm prod:up`.", ["Pokretanje#1: command chains, pipes or redirects are not allowed: pnpm install --frozen-lockfile && pnpm prod:up"]],
    ["4 command sequence", "1. Pokreni. Naredba: `pnpm install; rm -rf data`.", ["Pokretanje#1: command chains, pipes or redirects are not allowed: pnpm install; rm -rf data"]],
    ["4 pipe and redirect", "1. Pokreni. Naredba: `pnpm local:up | tee log`, `pnpm local:up > log`.", ["Pokretanje#1: command chains, pipes or redirects are not allowed: pnpm local:up | tee log", "Pokretanje#1: command chains, pipes or redirects are not allowed: pnpm local:up > log"]],
    ["4 environment prefix is skipped", "1. Pokreni. Naredba: `NODE_ENV=development pnpm local:up`.", []],
    ["5 owner from the table", "1. Odluči. Nositelj: `vlasnik`.", []],
    ["5 owner with a space", "1. Odluči. Nositelj: `zamjenik vlasnika`.", []],
    ["5 owner not in the table", "1. Odluči. Nositelj: `dežurni`.", ["Pokretanje#1: owner not in Nositelji: dežurni"]],
    ["5 owner placeholder", "1. Odluči. Nositelj: `[Q-13: imenovati]`.", ["Pokretanje#1: owner not in Nositelji: [Q-13: imenovati]"]],
    ["5 owner without code", "1. Odluči. Nositelj: vlasnik.", ["Pokretanje#1: Nositelj: is not followed by an owner in inline code"]],
    ["5 command and owner together", "1. Odluči. Naredba: `pnpm local:up`; Nositelj: `vlasnik`.", []],
    ["5 a bad command is not saved by an owner", "1. Odluči. Naredba: `pnpm nope`; Nositelj: `vlasnik`.", ["Pokretanje#1: pnpm script not in package.json: nope"]],
    ["6 neither command nor owner", "1. Odluči što dalje.", ["Pokretanje#1: step has neither Naredba: nor Nositelj:"]],
    ["6 code that is not after a marker", "1. Pogledaj `pnpm local:up` u dokumentu.", ["Pokretanje#1: step has neither Naredba: nor Nositelj:"]],
    ["7 marker on an indented continuation line", "1. Odluči.\n   Nositelj: `vlasnik`.", []],
    ["7 marker on a lazy continuation line", "1. Odluči.\nNositelj: `vlasnik`.", []],
    ["7 marker after a blank line, indented", "1. Odluči.\n\n   Nositelj: `vlasnik`.", []],
    ["7 marker after a blank line, not indented, is prose", "1. Odluči.\n\nNositelj: `vlasnik`.", ["Pokretanje#1: step has neither Naredba: nor Nositelj:"]],
    ["7 marker after a blank line, one space short of the step, is prose", "1. Odluči.\n\n Nositelj: `vlasnik`.", ["Pokretanje#1: step has neither Naredba: nor Nositelj:"]],
    ["7 marker after a blank line, two spaces short of the step, is prose", "1. Odluči.\n\n  Nositelj: `vlasnik`.", ["Pokretanje#1: step has neither Naredba: nor Nositelj:"]],
    ["7 marker after a blank line, short of a wide step, is prose", `${NINE_STEPS}10. Odluči.\n\n   Nositelj: \`vlasnik\`.`, ["Pokretanje#10: step has neither Naredba: nor Nositelj:"]],
    ["7 marker after a blank line, at a wide step's content", `${NINE_STEPS}10. Odluči.\n\n    Nositelj: \`vlasnik\`.`, []],
    ["7 several commands after one marker", "1. Oba. Naredba: `pnpm local:up`, `pnpm nope`.", ["Pokretanje#1: pnpm script not in package.json: nope"]],
    ["7 code after the marker's sentence is not a command", "1. Spremnost. Naredba: `curl http://localhost:3000/api/ready`; odgovor `503` znači stani.", []],
    ["7 marker inside an indented fence does not count", "1. Odluči.\n   ```\n   Nositelj: `vlasnik`\n   ```", ["Pokretanje#1: step has neither Naredba: nor Nositelj:"]],
    ["7 a step indented by up to three spaces is a step", "1. Prvi. Nositelj: `vlasnik`.\n 2. Drugi bez markera.", ["Pokretanje#2: step has neither Naredba: nor Nositelj:"]],
    ["7 an indented first step is a step", "   1. Prvi bez markera.", ["Pokretanje#1: step has neither Naredba: nor Nositelj:"]],
    ["7 a numbered line at the step's content is nested", "1. Prvi. Nositelj: `vlasnik`.\n   2. podtočka", []],
    ["7 a step numbered with a parenthesis is a step", "1. Prvi. Nositelj: `vlasnik`.\n2) Drugi bez markera.", ["Pokretanje#2: step has neither Naredba: nor Nositelj:"]],
    ["9 numbering with a gap", "1. Prvi. Nositelj: `vlasnik`.\n3. Treći. Nositelj: `vlasnik`.", ["Pokretanje#3: step is numbered 3, expected 2"]],
    ["9 numbering not from one", "2. Drugi. Nositelj: `vlasnik`.", ["Pokretanje#2: step is numbered 2, expected 1"]],
    ["12 bold markers", "1. Odluči. **Nositelj:** `vlasnik`. **Naredba:** `pnpm local:up`.", []],
    ["12 lower-case marker is not a marker", "1. Odluči. nositelj: `vlasnik`.", ["Pokretanje#1: step has neither Naredba: nor Nositelj:"]],
  ] as const)("%s", (_name, steps, expected) => {
    expect(messages(doc(steps))).toEqual(expected);
  });
});

// Review c.6744073156 and QA c.6744081333 on #1803 (contract #1091 c.6744231330,
// confirmed in c.6744314188):
// a line belongs to a step only where CommonMark puts it in the list item.
const NONE = ["Pokretanje#1: step has neither Naredba: nor Nositelj:"];
const NINE = Array.from({ length: 9 }, (_, i) => `${i + 1}. Korak. Nositelj: \`vlasnik\`.`).join("\n");

describe("checkOperations: a line belongs to a step only inside the list item", () => {
  it.each([
    ["N1 blank line, indent 0 is prose", "1. Odluči.\n\nNositelj: `vlasnik`.", NONE],
    ["N1 blank line, indent 1 is prose", "1. Odluči.\n\n Nositelj: `vlasnik`.", NONE],
    ["N1 blank line, indent 2 is prose", "1. Odluči.\n\n  Nositelj: `vlasnik`.", NONE],
    ["N1 blank line, indent 3 is in the step", "1. Odluči.\n\n   Nositelj: `vlasnik`.", []],
    ["N1 blank line, indent 4 is in the step", "1. Odluči.\n\n    Nositelj: `vlasnik`.", []],
    ["N1 blank line, indent 6 is in the step", "1. Odluči.\n\n      Nositelj: `vlasnik`.", []],
    ["N1 blank line, a tab reaches column 4", "1. Odluči.\n\n\tNositelj: `vlasnik`.", []],
    ["N1 step 10, indent 3 is prose", `${NINE}\n10. Deseti.\n\n   Nositelj: \`vlasnik\`.`, ["Pokretanje#10: step has neither Naredba: nor Nositelj:"]],
    ["N1 step 10, indent 4 is in the step", `${NINE}\n10. Deseti.\n\n    Nositelj: \`vlasnik\`.`, []],
    ["N1 step 10, a tab is in the step", `${NINE}\n10. Deseti.\n\n\tNositelj: \`vlasnik\`.`, []],
    ["N1 step indented by one, indent 3 is prose", " 1. Odluči.\n\n   Nositelj: `vlasnik`.", NONE],
    ["N1 two spaces after the number, indent 3 is prose", "1.  Odluči.\n\n   Nositelj: `vlasnik`.", NONE],
    ["N1 tab after the number, indent 3 is prose", "1.\tOdluči.\n\n   Nositelj: `vlasnik`.", NONE],
    ["N1 tab after the number, a tab is in the step", "1.\tOdluči.\n\n\tNositelj: `vlasnik`.", []],
    ["N1 five or more spaces after the number count as one", "1.      Odluči.\n\n   Nositelj: `vlasnik`.", []],
    ["N1 lazy line after an indented paragraph", "1. Odluči.\n\n   Dalje.\nNositelj: `vlasnik`.", []],
    ["N1 bullet in column 0 ends the step", "1. Odluči.\n- Nositelj: `vlasnik`.", NONE],
    ["N1 quote in column 0 ends the step", "1. Odluči.\n> Nositelj: `vlasnik`.", NONE],
    ["N1 thematic break in column 0 ends the step", "1. Odluči.\n---\nNositelj: `vlasnik`.", NONE],
    ["N1 fence in column 0 ends the step", "1. Odluči.\n```\nx\n```\nNositelj: `vlasnik`.", NONE],
    ["N1 indented bullet is in the step", "1. Odluči.\n   - Nositelj: `vlasnik`.", []],
    ["N1 indented quote is in the step", "1. Odluči.\n   > Nositelj: `vlasnik`.", []],
    ["N1 no lazy line after a closed indented fence", "1. Odluči.\n   ```\n   x\n   ```\nNositelj: `vlasnik`.", NONE],
  ] as const)("%s", (_name, steps, expected) => {
    expect(messages(doc(steps))).toEqual(expected);
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
    const text = doc("1. Prvi. Nositelj: `vlasnik`.  \n2. Drugi.   \n   Naredba: `pnpm nope`.");
    const crlf = text.replace(/\n/g, "\r\n").replace(/\.\r\n/g, ".  \r\n");
    expect(messages(crlf)).toEqual(messages(text));
    expect(messages(text)).toEqual(["Pokretanje#2: pnpm script not in package.json: nope"]);
  });

  it("reports the line of the step", () => {
    const text = doc("1. Prvi. Nositelj: `vlasnik`.\n2. Drugi.");
    const [problem] = checkOperations(text, CONTEXT);
    expect(text.split("\n")[(problem?.line ?? 0) - 1]).toBe("2. Drugi.");
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
