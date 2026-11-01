// DAN-434: the local runner lives under scripts/local/ and its pnpm scripts are
// named local:*; the old folder and script names must not come back in the
// package manifest or the workflows.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const RETIRED = [/scripts\/demo\//, /\bdemo:(up|prepare|bootstrap-accounts)\b/, /\btest:demo\b/, /\bdemo-native\b/, /--no-demo-data\b/];

function retiredIn(text) {
  return RETIRED.filter((pattern) => pattern.test(text)).map(String);
}

test("the old scripts/demo folder is gone and scripts/local holds the runner", () => {
  assert.equal(existsSync(new URL("scripts/demo", root)), false);
  for (const file of ["scripts/local/up.mjs", "scripts/local/native/up.mjs", "scripts/local/provision-teacher.mjs", "scripts/local/bootstrap-accounts.mjs"]) {
    assert.ok(existsSync(new URL(file, root)), file);
  }
});

test("package.json names the local scripts and none of the retired ones", () => {
  const manifest = read("package.json");
  assert.deepEqual(retiredIn(manifest), []);
  const { scripts } = JSON.parse(manifest);
  for (const name of ["local:up", "local:prepare", "local:up:native", "local:bootstrap-accounts", "test:local", "test:local:browser"]) {
    assert.ok(scripts[name], name);
  }
});

test("no workflow uses a retired name", () => {
  const dir = new URL(".github/workflows/", root);
  const files = readdirSync(dir).filter((file) => /\.ya?ml$/.test(file));
  assert.ok(files.includes("local-native.yml"));
  for (const file of files) assert.deepEqual(retiredIn(read(`.github/workflows/${file}`)), [], file);
});

// Codex on #1059: the run instructions name the same commands, so a stale
// name there sends the reader to a script that no longer exists.
const RUN_DOCS = ["docs/DEMO-UP.md", "docs/DEMO-TEACHER-BOOTSTRAP.md", "docs/DEMO-SUHI-PROLAZ.md", "docs/PLAN-DEMO.md", "docs/engineering/d91-mjere.md"];

test("no run instruction uses a retired name", () => {
  for (const file of RUN_DOCS) assert.deepEqual(retiredIn(read(file)), [], file);
});

test("the guard catches each retired name", () => {
  for (const sample of ["node scripts/demo/up.mjs", "pnpm demo:up", "pnpm demo:prepare", "pnpm demo:bootstrap-accounts", "pnpm test:demo:browser", "demo-native.yml", "--no-demo-data"]) {
    assert.notDeepEqual(retiredIn(sample), [], sample);
  }
  assert.deepEqual(retiredIn("pnpm local:up --no-sample-data"), []);
});
