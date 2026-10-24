// DAN-269: invented repositories made in a temp directory; no network, no GitHub.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseShadowArgs, renderShadow, shadowMerge } from "./shadow-core.mjs";

const git = (args, cwd) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
const must = (args, cwd) => {
  const r = git(["-c", "user.name=t", "-c", "user.email=t@invalid", "-c", "commit.gpgsign=false", ...args], cwd);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

/** main has a.txt and b.txt; returns a function that commits a change on a branch and gives its SHA. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "shadow-test-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  must(["init", "-q", "-b", "main"], repo);
  writeFileSync(join(repo, "a.txt"), "one\ntwo\nthree\n");
  writeFileSync(join(repo, "b.txt"), "x\n");
  must(["add", "."], repo);
  must(["commit", "-q", "-m", "base"], repo);
  const base = must(["rev-parse", "HEAD"], repo);
  const branch = (name, files) => {
    must(["checkout", "-q", "-b", name, base], repo);
    for (const [f, text] of Object.entries(files)) writeFileSync(join(repo, f), text);
    must(["add", "."], repo);
    must(["commit", "-q", "-m", name], repo);
    return must(["rev-parse", "HEAD"], repo);
  };
  return { root, repo, base, branch, dir: join(root, "wt"), done: () => rmSync(root, { recursive: true, force: true }) };
}

test("arguments are strict", () => {
  assert.deepEqual(parseShadowArgs(["5", "7", "--json"]), { prs: [5, 7], checks: [], json: true });
  assert.deepEqual(parseShadowArgs(["5", "7", "--check", "typecheck", "--check", "typecheck"]).checks, ["typecheck"]);
  assert.throws(() => parseShadowArgs(["5"]), /usage/);
  assert.throws(() => parseShadowArgs(["5", "5"]), /usage/);
  assert.throws(() => parseShadowArgs(["5", "7", "--check", "rm"]), /invalid/);
  assert.throws(() => parseShadowArgs(["5", "7", "--force"]), /invalid/);
  assert.throws(() => parseShadowArgs(["0", "7"]), /invalid/);
});

test("two PRs on different files merge cleanly and the worktree is gone", () => {
  const f = fixture();
  try {
    const a = f.branch("pr-a", { "a.txt": "ONE\ntwo\nthree\n" });
    const b = f.branch("pr-b", { "b.txt": "y\n" });
    let seen;
    const r = shadowMerge({ git, repo: f.repo, dir: f.dir, base: f.base, heads: [{ pr: 1, sha: a }, { pr: 2, sha: b }], after: (wt) => {
      seen = existsSync(join(wt, "a.txt"));
    } });
    assert.deepEqual(r.steps, [{ pr: 1, outcome: "clean" }, { pr: 2, outcome: "clean" }]);
    assert.match(r.head, /^[0-9a-f]{40}$/);
    assert.equal(seen, true);
    assert.equal(existsSync(f.dir), false);
    assert.equal(must(["rev-parse", "pr-a"], f.repo), a, "the branch is untouched");
  } finally {
    f.done();
  }
});

test("two PRs that change the same line conflict together, and the second one is named", () => {
  const f = fixture();
  try {
    const a = f.branch("pr-a", { "a.txt": "A\ntwo\nthree\n" });
    const b = f.branch("pr-b", { "a.txt": "B\ntwo\nthree\n" });
    let ran = false;
    const r = shadowMerge({ git, repo: f.repo, dir: f.dir, base: f.base, heads: [{ pr: 1, sha: a }, { pr: 2, sha: b }], after: () => {
      ran = true;
    } });
    assert.deepEqual(r.steps, [{ pr: 1, outcome: "clean" }, { pr: 2, outcome: "conflict", files: ["a.txt"] }]);
    assert.equal(r.head, null);
    assert.equal(ran, false, "no checks on a tree that did not merge");
    assert.equal(existsSync(f.dir), false);
  } finally {
    f.done();
  }
});

test("a head that is not a SHA is refused before git runs", () => {
  const calls = [];
  const spy = (args) => {
    calls.push(args);
    return { status: 0, stdout: "", stderr: "" };
  };
  assert.throws(() => shadowMerge({ git: spy, repo: ".", dir: "x", base: "main", heads: [] }), /full SHAs/);
  assert.throws(() => shadowMerge({ git: spy, repo: ".", dir: "x", base: "a".repeat(40), heads: [{ pr: 1, sha: "--upload-pack=evil" }] }), /full SHAs/);
  assert.deepEqual(calls, []);
});

test("a worktree that cannot be made is reported, not thrown", () => {
  const fail = () => ({ status: 1, stdout: "", stderr: "no" });
  const r = shadowMerge({ git: fail, repo: ".", dir: "x", base: "a".repeat(40), heads: [{ pr: 1, sha: "b".repeat(40) }] });
  assert.deepEqual(r.steps, [{ pr: null, outcome: "error" }]);
});

test("file names in the report are filtered", () => {
  const f = fixture();
  try {
    const name = "evil\u001b[2J.txt";
    const a = f.branch("pr-a", { [name]: "1\n" });
    const b = f.branch("pr-b", { [name]: "2\n" });
    const r = shadowMerge({ git, repo: f.repo, dir: f.dir, base: f.base, heads: [{ pr: 1, sha: a }, { pr: 2, sha: b }] });
    assert.equal(r.steps[1].outcome, "conflict");
    const text = renderShadow({ prs: [1, 2], steps: r.steps }).join("\n");
    assert.ok(!text.includes("\u001b"));
    assert.match(text, /<not printed>/);
  } finally {
    f.done();
  }
});

test("report states that it is advisory", () => {
  const text = renderShadow({ prs: [1, 2], steps: [{ pr: 1, outcome: "clean" }, { pr: 2, outcome: "clean" }], checks: [{ name: "typecheck", outcome: "passes" }] }).join("\n");
  assert.match(text, /#2: merges cleanly/);
  assert.match(text, /check typecheck: passes/);
  assert.match(text, /does not replace CI or QA/);
});
