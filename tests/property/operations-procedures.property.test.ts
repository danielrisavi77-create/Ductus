import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { REQUIRED_PROCEDURES, checkOperations } from "../../scripts/operations/check-procedures.mjs";

// DAN-540 (M11.3-P04), contract on #1091: for any document of the four
// required procedures, the check reports a problem exactly for the steps that
// name neither a known command nor a known owner, with the right procedure and
// step number, whether the step starts in the first column or after up to two
// spaces. Prose between procedures, outside a step, changes nothing.

const OWNERS = "## Nositelji\n\n| Nositelj | Odgovornost |\n| --- | --- |\n| `vlasnik` | kvarovi |\n| `koordinator pilota` | pitanja |\n";

const CONTEXT = {
  scripts: new Set(["local:up", "db:status"]),
  fileExists: (path: string) => path === "scripts/db/native-db.mjs",
  routeExists: (route: string) => route === "/api/ready",
};

/** A step kind and whether the check must refuse it. */
const STEPS = [
  { body: "Naredba: `pnpm local:up`.", bad: false },
  { body: "Naredba: `node scripts/db/native-db.mjs status`.", bad: false },
  { body: "Naredba: `curl -fsS http://localhost:3000/api/ready`.", bad: false },
  { body: "Nositelj: `vlasnik`.", bad: false },
  { body: "**Nositelj:** `koordinator pilota`.", bad: false },
  { body: "Naredba: `pnpm prod:up`.", bad: true },
  { body: "Naredba: `rm -rf data`.", bad: true },
  { body: "Naredba: `pnpm install && pnpm prod:up`.", bad: true },
  { body: "Nositelj: `dežurni`.", bad: true },
  { body: "Pogledaj `pnpm local:up` u dokumentu.", bad: true },
  { body: "Odluči što dalje.", bad: true },
] as const;

const PROSE = ["", "Kratka napomena bez naredbe.\n\n", "> Citat: `pnpm nope`.\n\n", "```\n1. nije korak\n```\n\n"] as const;

const stepArb = fc.record({ kind: fc.integer({ min: 0, max: STEPS.length - 1 }), indent: fc.integer({ min: 0, max: 2 }) });
const procedureArb = fc.array(stepArb, { minLength: 1, maxLength: 6 });
const documentArb = fc.record({
  steps: fc.tuple(procedureArb, procedureArb, procedureArb, procedureArb),
  prose: fc.tuple(...REQUIRED_PROCEDURES.map(() => fc.constantFrom(...PROSE))),
});

type StepCase = { kind: number; indent: number };

function render(steps: StepCase[][], prose: readonly string[]): string {
  const sections = REQUIRED_PROCEDURES.map((name, p) => {
    const list = (steps[p] ?? [])
      .map(({ kind, indent }, i) => `${" ".repeat(indent)}${i + 1}. Korak. ${STEPS[kind]?.body ?? ""}`)
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
