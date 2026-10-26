import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CRITICAL_PATHS } from "./pr-metadata-core.mjs";
import { matchesPath } from "./protected-paths.mjs";

// F-152 (F-148 residual): a node:test file on a critical path is a guard only
// when CI runs it. Every such file must appear in a command that ci.yml runs:
// a `pnpm test:*` script (followed through scripts that call other test:*
// scripts) or a `node --test` line of the workflow, literally or by its glob.
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, "utf8");

/** Every *.test.mjs under the repository's scripts/ and db/ trees, as repo paths. */
function nodeTestFiles(dir) {
  const found = [];
  for (const entry of readdirSync(`${root}${dir}`, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...nodeTestFiles(path));
    else if (entry.name.endsWith(".test.mjs")) found.push(path);
  }
  return found;
}

/** The text of every command CI runs: the node --test lines and the test:* scripts behind `pnpm test:*`. */
export function ciTestCommands(ci, scripts) {
  const commands = [...ci.matchAll(/node --test [^\n]*/g)].map((match) => match[0]);
  const pending = [...ci.matchAll(/pnpm (?:run )?(test:[\w:-]+)/g)].map((match) => match[1]);
  const seen = new Set();
  while (pending.length > 0) {
    const name = pending.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const script = scripts[name];
    if (script === undefined) continue;
    commands.push(script);
    for (const match of script.matchAll(/pnpm (?:run )?(test:[\w:-]+)/g)) pending.push(match[1]);
  }
  return commands;
}

/** Whether a repo path is named by one of the commands, literally or by a dir/*.test.mjs glob. */
export function runBy(commands, file) {
  return commands.some((command) =>
    command.split(/\s+/).some((word) => {
      if (word === file) return true;
      const glob = /^([\w./-]+)\/\*\.test\.mjs$/.exec(word);
      return glob !== null && file.startsWith(`${glob[1]}/`) && !file.slice(glob[1].length + 1).includes("/");
    }));
}

test("every node:test file on a critical path runs in CI", () => {
  const commands = ciTestCommands(read(".github/workflows/ci.yml"), JSON.parse(read("package.json")).scripts);
  const critical = ["scripts", "db"].flatMap(nodeTestFiles).filter((file) => matchesPath(file, CRITICAL_PATHS));
  assert.ok(critical.includes("scripts/demo/bootstrap-accounts.test.mjs"), "the critical list is read");
  assert.deepEqual(critical.filter((file) => !runBy(commands, file)), []);
});

test("the matcher follows test:* scripts and globs, and refuses what no command names", () => {
  const ci = "run: pnpm test:demo && pnpm test:fake-oidc\nrun: node --test scripts/engineering/*.test.mjs\n";
  const scripts = { "test:demo": "node --test a/x.test.mjs && pnpm test:inner", "test:inner": "node --test b/y.test.mjs" };
  const commands = ciTestCommands(ci, scripts);
  assert.ok(runBy(commands, "a/x.test.mjs"));
  assert.ok(runBy(commands, "b/y.test.mjs"));
  assert.ok(runBy(commands, "scripts/engineering/z.test.mjs"));
  assert.ok(!runBy(commands, "scripts/engineering/deeper/z.test.mjs"));
  assert.ok(!runBy(commands, "a/other.test.mjs"));
  assert.ok(!runBy(commands, "a/x.test.mjs.bak"));
});
