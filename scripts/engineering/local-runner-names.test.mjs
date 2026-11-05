// DAN-434 (#1053): the local runner lives under scripts/local/ and its pnpm
// scripts are named local:*. The retired "demo" folder, script, flag and
// workflow names must not come back where they would run: the package
// manifest, the workflows and the runner itself. The run instructions in
// docs/ follow in the docs PR right after this one (#1091 c.6666213662).
// A tracked file under scripts/demo/ is refused too, because the critical
// risk floor (F-140, F-144) now names scripts/local/ only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

export const RETIRED = [
  /scripts[\\/]demo[\\/]/i,
  /\bdemo:(up|prepare|bootstrap-accounts)\b/i,
  /\btest:demo\b/i,
  /\bdemo-native\b/i,
  /\bdemo native\b/i,
  /--no-demo-data\b/i,
];
const RETIRED_SCRIPT_KEY = /^(demo:|test:demo)/i;

export function retiredIn(text) {
  return RETIRED.filter((pattern) => pattern.test(text)).map(String);
}

export function retiredScriptKeys(scripts) {
  return Object.keys(scripts).filter((name) => RETIRED_SCRIPT_KEY.test(name));
}

export function retiredTrackedFiles(paths) {
  return paths.filter((file) => /^scripts[\\/]demo[\\/]/i.test(file));
}

// One row per input class from the contract (#1091 c.6666018641). `bad` must
// be caught; `good` is the renamed or out-of-scope form and must pass.
const CLASSES = [
  { name: "1 package.json script key", keys: { bad: { "demo:up": "x", "test:demo:browser": "x", "Demo:prepare": "x" }, good: { "local:up": "x", "test:local": "x", "db:demo-k3": "x" } } },
  { name: "2 script path, either slash, any case", bad: ["node scripts/demo/up.mjs", "node scripts\\demo\\native\\up.mjs", "node Scripts/Demo/up.mjs"], good: ["node scripts/local/up.mjs", "node scripts\\local\\native\\up.mjs", "node scripts/demonstration.mjs"] },
  { name: "2b retired pnpm command", bad: ["pnpm demo:up", "pnpm demo:up:native", "pnpm demo:prepare", "pnpm demo:bootstrap-accounts", "pnpm test:demo", "pnpm test:demo:browser"], good: ["pnpm local:up", "pnpm local:up:native", "pnpm test:local:browser"] },
  { name: "3 retired flag", bad: ["up.mjs --no-demo-data", "--NO-DEMO-DATA"], good: ["up.mjs --no-sample-data"] },
  { name: "4 workflow name, job or group", bad: ["demo-native.yml", "name: Demo native (Windows)", "group: demo-native-${{ github.ref }}"], good: ["local-native.yml", "name: Local native (Windows)", "group: local-native-${{ github.ref }}"] },
  { name: "5 tracked file under scripts/demo/", files: { bad: ["scripts/demo/up.mjs", "scripts\\demo\\native\\up.mjs", "Scripts/Demo/x.mjs"], good: ["scripts/local/up.mjs", "scripts/demonstration/x.mjs", "db/local/demo-k3.sql"] } },
  { name: "7 out of scope, allowed", bad: [], good: ["db/local/demo-k3.sql", "db/local/provision-demo-teacher.sql", "E2E_DEMO_NATIVE=1", "Demo prijava", "demo-student"] },
];

for (const row of CLASSES) {
  test(`input class ${row.name}`, () => {
    if (row.keys) {
      assert.deepEqual(retiredScriptKeys(row.keys.bad).length, Object.keys(row.keys.bad).length);
      assert.deepEqual(retiredScriptKeys(row.keys.good), []);
    } else if (row.files) {
      assert.deepEqual(retiredTrackedFiles(row.files.bad), row.files.bad);
      assert.deepEqual(retiredTrackedFiles(row.files.good), []);
    } else {
      for (const sample of row.bad) assert.notDeepEqual(retiredIn(sample), [], sample);
      for (const sample of row.good) assert.deepEqual(retiredIn(sample), [], sample);
    }
  });
}

test("class 5: no tracked file is left under scripts/demo/ and scripts/local/ holds the runner", () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  assert.deepEqual(retiredTrackedFiles(tracked), []);
  for (const file of ["scripts/local/up.mjs", "scripts/local/native/up.mjs", "scripts/local/provision-teacher.mjs", "scripts/local/bootstrap-accounts.mjs"]) {
    assert.ok(tracked.includes(file), file);
  }
});

test("classes 1 to 3: package.json names the local scripts and none of the retired ones", () => {
  const manifest = read("package.json");
  assert.deepEqual(retiredIn(manifest), []);
  const { scripts } = JSON.parse(manifest);
  assert.deepEqual(retiredScriptKeys(scripts), []);
  for (const name of ["local:up", "local:prepare", "local:up:native", "local:bootstrap-accounts", "test:local", "test:local:browser"]) {
    assert.ok(scripts[name], name);
  }
});

test("class 4: no workflow uses a retired name", () => {
  const files = readdirSync(new URL(".github/workflows/", root)).filter((file) => /\.ya?ml$/.test(file));
  assert.ok(files.includes("local-native.yml"));
  for (const file of files) {
    assert.deepEqual(retiredIn(file), [], file);
    assert.deepEqual(retiredIn(read(`.github/workflows/${file}`)), [], file);
  }
});

test("class 3: the runner itself uses no retired name", () => {
  const tracked = execFileSync("git", ["ls-files", "-z", "scripts/local"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  assert.ok(tracked.length > 0);
  for (const file of tracked) assert.deepEqual(retiredIn(read(file)), [], file);
});
