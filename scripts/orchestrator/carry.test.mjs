import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { carryEnv, carryVerdict, DIFF_ARGS, gitEnv, patchIdOf, refreshOnly, remoteIs, treesProven, unsafeConfigKeys } from "./carry-core.mjs";

const ok = { state: "success" };
const good = { refreshed: true, treeProven: true, oldPatchId: "a".repeat(40), newPatchId: "a".repeat(40), gate: ok };
const v = (over = {}) => carryVerdict({ ...good, ...over });

test("a proven refresh with main only, the same patch-id and gate success carries", () => {
  assert.equal(v().carry, true);
});

test("every missing element of the proof stops the carry", () => {
  assert.equal(v({ refreshed: false }).carry, false); // force push or rebuilt commits with the same diff
  assert.equal(v({ refreshed: undefined }).carry, false);
  assert.equal(v({ treeProven: false }).carry, false); // manual edit inside a merge commit
  assert.equal(v({ treeProven: undefined }).carry, false);
  assert.equal(v({ oldPatchId: null }).carry, false);
  assert.equal(v({ newPatchId: "b".repeat(40) }).carry, false);
  assert.equal(v({ gate: { state: "pending" } }).carry, false);
  assert.equal(v({ gate: undefined }).carry, false);
  assert.equal(v({ gate: { error: "x" } }).carry, false);
});

test("patchIdOf reads the first field only and nothing for an empty diff", () => {
  assert.equal(patchIdOf(`${"c".repeat(40)} ${"d".repeat(40)}\n`), "c".repeat(40));
  assert.equal(patchIdOf(""), null);
  assert.equal(patchIdOf(undefined), null);
});

test("treesProven needs every pair present, full object ids and equal", () => {
  const t = "e".repeat(40);
  assert.equal(treesProven([{ actual: t, merged: t }]), true);
  assert.equal(treesProven([{ actual: t, merged: "f".repeat(40) }]), false);
  assert.equal(treesProven([{ actual: t, merged: null }]), false);
  assert.equal(treesProven([{ actual: t, merged: "short" }]), false);
  assert.equal(treesProven([]), false);
  assert.equal(treesProven(undefined), false);
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
  const long = Array.from({ length: 11 }, () => ({ sha: sha("1"), parents: [sha("1"), sha("2")] }));
  assert.equal(refreshOnly({ oldHead, chain: long, mainContains: mainHas(sha("2")) }), false);
  assert.equal(refreshOnly({ oldHead: "short", chain: one, mainContains: mainHas(sha("1")) }), false);
});

test("carryEnv drops variables that redirect git or gh; gitEnv forbids replacement objects", () => {
  const env = carryEnv({ PATH: "p", GH_REPO: "x/y", gh_host: "h", GIT_EXTERNAL_DIFF: "e", GIT_DIR: "d", GH_TOKEN: "t", GIT_NO_REPLACE_OBJECTS: "0" });
  assert.deepEqual(Object.keys(env).sort(), ["GH_TOKEN", "PATH"]);
  assert.equal(gitEnv({ GIT_NO_REPLACE_OBJECTS: "0", PATH: "p" }).GIT_NO_REPLACE_OBJECTS, "1");
});

test("remoteIs accepts only the exact canonical repository on github.com", () => {
  const repo = "danielrisavi77-create/Ductus";
  for (const ok of [
    "https://github.com/danielrisavi77-create/Ductus.git",
    "https://github.com/danielrisavi77-create/Ductus",
    "https://user@github.com/Danielrisavi77-Create/ductus.git",
    "git@github.com:danielrisavi77-create/Ductus.git",
    "ssh://git@github.com/danielrisavi77-create/Ductus.git",
  ]) assert.equal(remoteIs(ok, repo), true, ok);
  for (const bad of [
    "https://github.com/someone/Ductus.git",
    "https://github.com/danielrisavi77-create/Ductus-fork.git",
    "https://evil.example/danielrisavi77-create/Ductus.git",
    "https://github.com.evil.example/danielrisavi77-create/Ductus.git",
    "git@github.com:danielrisavi77-create/Ductus/extra.git",
    "",
    undefined,
  ]) assert.equal(remoteIs(bad, repo), false, String(bad));
});

// Real repository: a clean refresh is proven by git's own merge, a merge with a moved
// change is not, and a configured external diff cannot replace the diff text.
const lines = (n, extra = {}) => Array.from({ length: n }, (_, i) => extra[i] ?? `line ${i}`).join("\n") + "\n";

function repoWith(fn) {
  const dir = mkdtempSync(join(tmpdir(), "carry-"));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", env: gitEnv(process.env) });
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "t");
    fn({ dir, git, write: (name, text) => writeFileSync(join(dir, name), text) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const mergeTree = (git, a, b) => git("merge-tree", "--write-tree", "--no-messages", a, b).split("\n")[0].trim();
const treeOf = (git, rev) => git("rev-parse", `${rev}^{tree}`).trim();
test("a clean refresh is proven, a moved change inside the merge commit is not", () => {
  repoWith(({ git, write }) => {
    // a file with two blocks of identical context
    const block = (tag) => `ctx1\nctx2\nctx3\nif (${tag}) check();\nctx4\nctx5\nctx6\n`;
    write("f.txt", `${block("a")}---\n${block("b")}`);
    write("other.txt", "x\n");
    git("add", "f.txt", "other.txt");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "pr");
    write("f.txt", `${block("a").replace("if (a) check();\n", "")}---\n${block("b")}`);
    git("commit", "-qam", "pr removes the first check");
    const oldHead = git("rev-parse", "HEAD").trim();
    git("checkout", "-q", "main");
    write("other.txt", "x\ny\n");
    git("commit", "-qam", "main moves on");
    const mainHead = git("rev-parse", "HEAD").trim();

    // honest refresh
    git("checkout", "-q", "pr");
    git("merge", "--no-ff", "-qm", "refresh", mainHead);
    const honest = git("rev-parse", "HEAD").trim();
    assert.equal(treeOf(git, honest), mergeTree(git, oldHead, mainHead));
    assert.equal(treesProven([{ actual: treeOf(git, honest), merged: mergeTree(git, oldHead, mainHead) }]), true);

    // dishonest refresh: the second parent is in main, but the tree restores the first
    // check and removes the second one (same hunk shape, other block)
    git("checkout", "-q", "-B", "evil", oldHead);
    git("merge", "--no-ff", "--no-commit", "-q", mainHead);
    write("f.txt", `${block("a")}---\n${block("b").replace("if (b) check();\n", "")}`);
    git("add", "f.txt");
    git("commit", "-qm", "refresh");
    const evil = git("rev-parse", "HEAD").trim();
    assert.notEqual(treeOf(git, evil), mergeTree(git, oldHead, mainHead));
    assert.equal(treesProven([{ actual: treeOf(git, evil), merged: mergeTree(git, oldHead, mainHead) }]), false);
  });
});

test("merge-tree reports no tree for a conflicting merge", () => {
  repoWith(({ git, write }) => {
    write("f.txt", "a\n");
    git("add", "f.txt");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "one");
    write("f.txt", "one\n");
    git("commit", "-qam", "one");
    git("checkout", "-q", "main");
    write("f.txt", "two\n");
    git("commit", "-qam", "two");
    assert.throws(() => mergeTree(git, "one", "main"));
  });
});

test("the real diff arguments ignore a configured external diff", () => {
  repoWith(({ git, write }) => {
    write("w.yml", "a:\n  b: 1\n");
    git("add", "w.yml");
    git("commit", "-qm", "base");
    write("w.yml", "a:\n  b: 2\n");
    git("commit", "-qam", "p");
    const plain = git(...DIFF_ARGS, "HEAD~1", "HEAD");
    git("config", "diff.external", "echo SAME");
    assert.match(git(...DIFF_ARGS, "HEAD~1", "HEAD"), /^diff --git /m);
    assert.equal(git(...DIFF_ARGS, "HEAD~1", "HEAD"), plain);
  });
});

test("gitEnv isolates transport, global configuration and replacement objects", () => {
  const env = gitEnv({ GIT_SSH: "x", GIT_SSH_COMMAND: "y", GIT_PROXY_COMMAND: "z", GIT_ATTR_SOURCE: "a", PATH: "p" });
  assert.deepEqual(Object.keys(env).filter((k) => /SSH|PROXY|ATTR/.test(k)), []);
  assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  assert.match(env.GIT_CONFIG_GLOBAL, /NUL|\/dev\/null/);
});

test("unsafeConfigKeys finds settings that run programs or change the transport", () => {
  const list = (...pairs) => pairs.map(([k, v]) => `${k}\n${v}\0`).join("");
  assert.deepEqual(unsafeConfigKeys(list(["core.bare", "false"], ["remote.origin.url", "u"], ["user.name", "t"])), []);
  for (const key of ["core.sshCommand", "merge.default", "merge.x.driver", "diff.external", "diff.y.textconv", "include.path", "url.x.insteadOf", "core.fsmonitor", "credential.helper"]) {
    assert.deepEqual(unsafeConfigKeys(list([key, "v"])), [key.toLowerCase() === key ? key : key], key);
  }
});

test("a real merge driver in the local configuration is found and git with the isolated environment ignores global ones", () => {
  repoWith(({ git }) => {
    git("config", "merge.evil.driver", "echo x");
    assert.deepEqual(unsafeConfigKeys(git("config", "--local", "--list", "-z")), ["merge.evil.driver"]);
  });
});