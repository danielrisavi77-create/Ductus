import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CRITICAL_PATHS } from "./pr-metadata-core.mjs";
import { matchesPath } from "./protected-paths.mjs";

// F-152 (F-148 residual): a node:test file on a critical path is a guard only
// when CI runs it. Every such file in the repository must appear in a command
// that ci.yml runs: a step's `run:` value with a `pnpm test:*` script
// (followed through scripts that call other test:* scripts) or a `node --test`
// line, naming the file literally or by a glob.
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, "utf8");

/** Every tracked *.test.mjs in the repository, as repo paths. */
function trackedNodeTests() {
  return execFileSync("git", ["ls-files", "-z", "--", "*.test.mjs"], { cwd: root, encoding: "utf8" })
    .split("\0").filter(Boolean);
}

/**
 * The `run:` values of the workflow's steps, one string each. A block value
 * (`run: |`) takes the lines indented below its key; comment lines and text
 * outside `run:` (comments, names, `if:`) are not commands.
 */
export function runValues(ci) {
  const values = [];
  const lines = ci.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const key = /^(\s*(?:-\s+)?)run:\s*(.*)$/.exec(lines[i]);
    if (!key) continue;
    // The column of `run` itself; a block's lines are indented deeper.
    const indent = key[1].length;
    if (!/^[|>][+-]?$/.test(key[2])) {
      values.push(key[2]);
      continue;
    }
    const block = [];
    while (i + 1 < lines.length && (lines[i + 1].trim() === "" || /^\s*/.exec(lines[i + 1])[0].length > indent)) {
      i += 1;
      if (!lines[i].trim().startsWith("#")) block.push(lines[i].trim());
    }
    values.push(block.join("\n"));
  }
  return values;
}

/** The text of every command CI runs: the steps' `run:` values and the test:* scripts behind `pnpm test:*`. */
export function ciTestCommands(ci, scripts) {
  const commands = runValues(ci);
  const pending = commands.flatMap((command) => [...command.matchAll(/pnpm (?:run )?(test:[\w:-]+)/g)].map((match) => match[1]));
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

/** One path segment against a pattern whose `*` matches any run of characters. */
function segmentMatches(pattern, segment) {
  const [first, ...rest] = pattern.split("*");
  if (rest.length === 0) return pattern === segment;
  const last = rest.pop();
  if (!segment.startsWith(first) || !segment.endsWith(last) || segment.length < first.length + last.length) return false;
  let at = first.length;
  for (const part of rest) {
    const found = segment.indexOf(part, at);
    if (found < 0 || found + part.length > segment.length - last.length) return false;
    at = found + part.length;
  }
  return true;
}

/** A shell glob word against a repo path; `*` stays inside one path segment. */
function globMatches(word, file) {
  const patterns = word.split("/");
  const segments = file.split("/");
  return patterns.length === segments.length && patterns.every((pattern, i) => segmentMatches(pattern, segments[i]));
}

/** Whether a repo path is named by one of the commands, literally or by a glob. */
export function runBy(commands, file) {
  return commands.some((command) =>
    command.split(/[\s;&|]+/).some((word) => word === file || (word.includes("*") && globMatches(word, file))));
}

test("every node:test file on a critical path runs in CI", () => {
  const commands = ciTestCommands(read(".github/workflows/ci.yml"), JSON.parse(read("package.json")).scripts);
  const critical = trackedNodeTests().filter((file) => matchesPath(file, CRITICAL_PATHS));
  assert.ok(critical.includes("scripts/demo/bootstrap-accounts.test.mjs"), "the critical list is read");
  assert.ok(critical.includes(".claude/skills/run-ductus/process-command.test.mjs"), "the whole tree is read");
  assert.deepEqual(critical.filter((file) => !runBy(commands, file)), []);
});

test("the matcher follows test:* scripts and globs, and refuses what no command names", () => {
  const ci = [
    "      - run: pnpm test:demo && pnpm test:fake-oidc",
    "      - name: Engineering",
    "        run: shopt -s failglob; node --test scripts/engineering/*.test.mjs skills/*/*.test.mjs",
    "      - run: |",
    "          # node --test commented/x.test.mjs",
    "          node --test block/y.test.mjs",
    "      # - run: node --test commented/z.test.mjs",
    "      - name: Not run, pnpm test:named",
    "",
  ].join("\n");
  const scripts = {
    "test:demo": "node --test a/x.test.mjs && pnpm test:inner", "test:inner": "node --test b/y.test.mjs",
    "test:named": "node --test named/n.test.mjs",
  };
  const commands = ciTestCommands(ci, scripts);
  assert.ok(runBy(commands, "a/x.test.mjs"));
  assert.ok(runBy(commands, "b/y.test.mjs"));
  assert.ok(runBy(commands, "block/y.test.mjs"));
  assert.ok(runBy(commands, "scripts/engineering/z.test.mjs"));
  assert.ok(runBy(commands, "skills/run/z.test.mjs"));
  assert.ok(!runBy(commands, "scripts/engineering/deeper/z.test.mjs"));
  assert.ok(!runBy(commands, "a/other.test.mjs"));
  assert.ok(!runBy(commands, "a/x.test.mjs.bak"));
  assert.ok(!runBy(commands, "scripts/engineering/z.test.mjs.bak"));
  assert.ok(!runBy(commands, "scripts/engineering/z.spec.mjs"));  // Comments and step names are not commands.
  assert.ok(!runBy(commands, "commented/x.test.mjs"));
  assert.ok(!runBy(commands, "commented/z.test.mjs"));
  assert.ok(!runBy(commands, "named/n.test.mjs"));
});
