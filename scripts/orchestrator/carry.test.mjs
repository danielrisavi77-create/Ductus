import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { carryVerdict } from "./carry-core.mjs";

const ok = { state: "success" };
const diff = "diff --git a/x b/x\n+a\n";

test("identical diff and gate success carries", () => {
  assert.equal(carryVerdict({ oldDiff: diff, newDiff: diff, gate: ok }).carry, true);
});

test("a whitespace-only change does not carry", () => {
  const spaced = diff.replace("+a", "+a ");
  assert.equal(carryVerdict({ oldDiff: diff, newDiff: spaced, gate: ok }).carry, false);
});

test("gate not success, unreadable or empty diffs do not carry", () => {
  assert.equal(carryVerdict({ oldDiff: diff, newDiff: diff, gate: { state: "pending" } }).carry, false);
  assert.equal(carryVerdict({ oldDiff: diff, newDiff: diff, gate: undefined }).carry, false);
  assert.equal(carryVerdict({ oldDiff: null, newDiff: diff, gate: ok }).carry, false);
  assert.equal(carryVerdict({ oldDiff: "", newDiff: "", gate: ok }).carry, false);
});

// The reason patch-id is not used: it hides a whitespace change that git diff shows.
test("git diff --binary differs where patch-id would not", () => {
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
    const one = git("diff", "--binary", "--full-index", "HEAD~1", "HEAD");
    writeFileSync(join(dir, "w.yml"), "a:\n  b:  2\n");
    git("commit", "-qam", "q");
    const two = git("diff", "--binary", "--full-index", "HEAD~2", "HEAD");
    assert.equal(carryVerdict({ oldDiff: one, newDiff: two, gate: ok }).carry, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});