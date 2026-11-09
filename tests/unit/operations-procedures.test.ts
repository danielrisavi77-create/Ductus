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
    ["3 curl route that does not exist", "1. Zdravlje. Naredba: `curl -fsS http://localhost:3000/api/live-ness`.", ["Pokretanje#1: no route app/api/live-ness/route.ts"]],
    ["3 curl outside /api", "1. Zdravlje. Naredba: `curl http://localhost:3000/`.", ["Pokretanje#1: curl URL is not under /api/: http://localhost:3000/"]],
    ["3 curl without a URL", "1. Zdravlje. Naredba: `curl -fsS`.", ["Pokretanje#1: curl command names no URL"]],
    ["4 program outside the list", "1. Briši. Naredba: `rm -rf data`.", ["Pokretanje#1: program not allowed: rm"]],
    ["4 empty inline code", "1. Ništa. Naredba: ``.", ["Pokretanje#1: Naredba: is not followed by a command in inline code"]],
    ["4 marker without code", "1. Ništa. Naredba: pokreni aplikaciju.", ["Pokretanje#1: Naredba: is not followed by a command in inline code"]],
    ["4 docker compose with a subcommand", "1. Stani. Naredba: `docker compose stop`.", []],
    ["4 docker without compose", "1. Stani. Naredba: `docker stop ductus`.", ["Pokretanje#1: docker command is not docker compose <subcommand>"]],
    ["4 kill with TERM", "1. Stani. Naredba: `kill -TERM <pid>`.", []],
    ["4 kill without a stop signal", "1. Stani. Naredba: `kill -9 <pid>`.", ["Pokretanje#1: kill sends neither -TERM nor -INT"]],
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
    ["7 several commands after one marker", "1. Oba. Naredba: `pnpm local:up`, `pnpm nope`.", ["Pokretanje#1: pnpm script not in package.json: nope"]],
    ["7 code after the marker's sentence is not a command", "1. Spremnost. Naredba: `curl http://localhost:3000/api/ready`; odgovor `503` znači stani.", []],
    ["7 marker inside an indented fence does not count", "1. Odluči.\n   ```\n   Nositelj: `vlasnik`\n   ```", ["Pokretanje#1: step has neither Naredba: nor Nositelj:"]],
    ["9 numbering with a gap", "1. Prvi. Nositelj: `vlasnik`.\n3. Treći. Nositelj: `vlasnik`.", ["Pokretanje#3: step is numbered 3, expected 2"]],
    ["9 numbering not from one", "2. Drugi. Nositelj: `vlasnik`.", ["Pokretanje#2: step is numbered 2, expected 1"]],
    ["12 bold markers", "1. Odluči. **Nositelj:** `vlasnik`. **Naredba:** `pnpm local:up`.", []],
    ["12 lower-case marker is not a marker", "1. Odluči. nositelj: `vlasnik`.", ["Pokretanje#1: step has neither Naredba: nor Nositelj:"]],
  ] as const)("%s", (_name, steps, expected) => {
    expect(messages(doc(steps))).toEqual(expected);
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
