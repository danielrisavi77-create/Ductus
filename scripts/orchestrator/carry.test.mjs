import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { carryEnv, carryVerdict, DIFF_ARGS, normalizeDiff, refreshOnly } from "./carry-core.mjs";

const ok = { state: "success" };
const diff = "diff --git a/x b/x\nindex 1111111..2222222 100644\n--- a/x\n+++ b/x\n@@ -4,3 +4,3 @@ head\n ctx\n-a\n+b\n ctx2\n";
const v = (over = {}) => carryVerdict({ oldDiff: diff, newDiff: diff, gate: ok, refreshed: true, ...over });

test("identical diff, refresh with main only and gate success carries", () => {
  assert.equal(v().carry, true);
});

test("a whitespace-only change does not carry", () => {
  assert.equal(v({ newDiff: diff.replace("+b", "+b ") }).carry, false);
});

test("gate not success, unreadable or empty diffs do not carry", () => {
  assert.equal(v({ gate: { state: "pending" } }).carry, false);
  assert.equal(v({ gate: undefined }).carry, false);
  assert.equal(v({ gate: { error: "x" } }).carry, false);
  assert.equal(v({ oldDiff: null }).carry, false);
  assert.equal(v({ oldDiff: "", newDiff: "" }).carry, false);
});

test("a head that is not a refresh with main does not carry (review: force push, same diff)", () => {
  assert.equal(v({ refreshed: false }).carry, false);
  assert.equal(v({ refreshed: undefined }).carry, false);
});

test("hunk offsets and blob ids moved by a base merge do not change the verdict; content does", () => {
  const moved = diff.replace("index 1111111..2222222", "index 3333333..4444444").replace("@@ -4,3 +4,3 @@ head", "@@ -10,3 +10,3 @@ other");
  assert.equal(v({ newDiff: moved }).carry, true);
  for (const changed of [
    moved.replace("+b", "+c"),
    moved.replace("-a", "-z"),
    moved.replace(" ctx2", " ctx3"),
    moved.replace("-10,3 +10,3", "-10,3 +10,4"),
    `${moved}@@ -50,1 +50,1 @@\n-q\n+r\n`,
  ]) {
    assert.equal(v({ newDiff: changed }).carry, false, changed);
  }
});

test("normalizeDiff touches only structural lines", () => {
  assert.equal(normalizeDiff("+index not structural\n"), "+index not structural\n");
  assert.equal(normalizeDiff("+@@ -1 +1 @@\n"), "+@@ -1 +1 @@\n");
});

const sha = (c) => c.repeat(40);
const mainHas = (...set) => (s) => set.includes(s);
test("refreshOnly: only two-parent merges of main on top of the old head", () => {
  const oldHead = sha("a");
  const one = [{ sha: sha("c"), parents: [oldHead, sha("1")] }];
  assert.equal(refreshOnly({ oldHead, chain: one, mainContains: mainHas(sha("1")) }), true);
  const two = [{ sha: sha("d"), parents: [sha("c"), sha("2")] }, ...one];
  assert.equal(refreshOnly({ oldHead, chain: two, mainContains: mainHas(sha("1"), sha("2")) }), true);
  // second parent not in main, an ordinary commit, an octopus, a break in the chain, empty, too long
  assert.equal(refreshOnly({ oldHead, chain: one, mainContains: mainHas() }), false);
  assert.equal(refreshOnly({ oldHead, chain: [{ sha: sha("c"), parents: [oldHead] }], mainContains: mainHas(sha("1")) }), false);
  assert.equal(refreshOnly({ oldHead, chain: [{ sha: sha("c"), parents: [oldHead, sha("1"), sha("2")] }], mainContains: mainHas(sha("1"), sha("2")) }), false);
  assert.equal(refreshOnly({ oldHead, chain: [{ sha: sha("c"), parents: [sha("e"), sha("1")] }], mainContains: mainHas(sha("1")) }), false);
  assert.equal(refreshOnly({ oldHead, chain: [], mainContains: mainHas() }), false);
  const long = Array.from({ length: 11 }, (_, i) => ({ sha: sha("1"), parents: [sha("1"), sha("1")], i }));
  assert.equal(refreshOnly({ oldHead, chain: long, mainContains: mainHas(sha("1")) }), false);
  assert.equal(refreshOnly({ oldHead: "short", chain: one, mainContains: mainHas(sha("1")) }), false);
});

test("carryEnv drops variables that redirect git or gh", () => {
  const env = carryEnv({ PATH: "p", GH_REPO: "x/y", gh_host: "h", GIT_EXTERNAL_DIFF: "e", GIT_DIR: "d", GH_TOKEN: "t" });
  assert.deepEqual(Object.keys(env).sort(), ["GH_TOKEN", "PATH"]);
});

// Real repository: patch-id would not see a whitespace change, and a configured external
// diff must not replace the diff text.
test("the real diff arguments see whitespace changes and ignore an external diff", () => {
  const dir = mkdtempSync(join(tmpdir(), "carry-"));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  try {
    git("init", "-q");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "t");
    writeFileSync(join(dir, "w.yml"), "a:\n  b: 1\n");
    git("add", "w.yml");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "p1");
    writeFileSync(join(dir, "w.yml"), "a:\n  b: 2\n");
    git("commit", "-qam", "p");
    const one = git(...DIFF_ARGS, "HEAD~1", "HEAD");
    writeFileSync(join(dir, "w.yml"), "a:\n  b:  2\n");
    git("commit", "-qam", "q");
    const two = git(...DIFF_ARGS, "HEAD~2", "HEAD");
    assert.equal(carryVerdict({ oldDiff: one, newDiff: two, gate: ok, refreshed: true }).carry, false);

    git("config", "diff.external", "echo SAME");
    assert.match(git(...DIFF_ARGS, "HEAD~2", "HEAD"), /^diff --git /m);
    assert.equal(git(...DIFF_ARGS, "HEAD~2", "HEAD"), two);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
