// D-91 (2), DAN-71: every run that applies migrations uses `dbmate up --strict`
// (or `migrate --strict`), so a migration older than the newest applied one is
// refused instead of applied out of order. CI applies them through
// `pnpm db:migrate` (.github/workflows/ci.yml); the Windows local runner
// through scripts/local/native/up.mjs (DAN-434 moved it from scripts/demo).
// No deploy path exists yet; one that is added later is caught by the scans
// below.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const read = (file) => readFileSync(file, "utf8");
// Matched within one command segment (split below), so a URL with "&" stays whole.
const APPLY = /\bdbmate\b.*\s(up|migrate)\b/;

/** Each command segment of a script line that runs dbmate up or migrate. */
function applying(text) {
  return text
    .split(/\r?\n|&&|\|\||;/)
    .filter((segment) => APPLY.test(segment));
}

test("the pattern finds dbmate up and migrate, and only those", () => {
  assert.deepEqual(applying("dbmate --url x --wait up && pnpm next"), ["dbmate --url x --wait up "]);
  assert.equal(applying("npx dbmate migrate").length, 1);
  assert.equal(applying("dbmate --url x rollback").length, 0);
  assert.equal(applying("dbmate new name").length, 0);
  assert.equal(applying("dbmate status").length, 0);
  assert.equal(applying('dbmate --url "postgres://h/d?a=1&role=r" --wait up && next').length, 1);
});

test("every package.json script that applies migrations passes --strict", () => {
  const { scripts } = JSON.parse(read("package.json"));
  const found = Object.entries(scripts).flatMap(([name, command]) => applying(command).map((segment) => [name, segment]));
  assert.ok(found.some(([name]) => name === "db:migrate"), "db:migrate applies migrations");
  for (const [name, segment] of found) assert.match(segment, /\s--strict\b/, `${name}: ${segment.trim()}`);
});

test("CI applies migrations only through pnpm db:migrate or with --strict", () => {
  const dir = ".github/workflows";
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    for (const segment of applying(read(path.join(dir, file)))) {
      assert.match(segment, /\s--strict\b/, `${file}: ${segment.trim()}`);
    }
  }
  assert.match(read(".github/workflows/ci.yml"), /- run: pnpm db:migrate\n/);
});

test("a script that calls the dbmate CLI with up or migrate passes --strict in the same argv", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.m?[jt]s$/.test(entry.name) && !/\.test\.m?[jt]s$/.test(entry.name)) files.push(full);
    }
  };
  walk("scripts");
  const calls = [];
  for (const file of files) {
    const text = read(file);
    if (!/dbmate/.test(text)) continue;
    for (const line of text.split(/\r?\n/)) {
      if (/\[[^\]]*dbmate[^\]]*"(up|migrate)"/.test(line)) calls.push([file, line]);
    }
  }
  // The exact path, so no other folder whose name merely ends in "local" counts.
  const runner = path.join("scripts", "local", "native", "up.mjs");
  assert.ok(calls.some(([file]) => file === runner), "the native local runner applies migrations");
  for (const [file, line] of calls) assert.match(line, /"--strict"/, `${file}: ${line.trim()}`);
});
