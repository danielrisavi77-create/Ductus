// F-010 (#1193 item 13): the real `pr-status.mjs` marks an external PR, with
// `gh` answered by fake-gh-preload.mjs from invented REST rows.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const owner = { login: "owner1", type: "User" };
const pull = (number, head, user) => ({
  number, title: "t", body: null, state: "open", draft: false, merged_at: null, mergeable: true,
  head, base: { ref: "main" }, created_at: "2026-10-01T00:00:00Z", auto_merge: null, user,
});
const PULLS = [
  pull(1, { sha: "a".repeat(40), ref: "x", repo: { full_name: "other/repo1" } }, owner), // external: fork head
  pull(2, { sha: "b".repeat(40), ref: "y", repo: { full_name: "owner1/repo1" } }, owner), // internal
  pull(3, { sha: "c".repeat(40), ref: "z" }, undefined), // incomplete: no head repository, no author
];

function prStatus(args) {
  const dir = mkdtempSync(join(tmpdir(), "pr-status-cli-"));
  try {
    const file = join(dir, "pulls.json");
    writeFileSync(file, JSON.stringify(PULLS));
    return execFileSync(process.execPath, [
      "--import", pathToFileURL(join(here, "fake-gh-preload.mjs")).href, join(here, "pr-status.mjs"), ...args,
    ], { env: { ...process.env, FAKE_GH_PULLS: file }, encoding: "utf8", windowsHide: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("F-010: pr-status --json carries the external reason for a fork and an incomplete row, null for the owner's", () => {
  const rows = new Map(JSON.parse(prStatus(["--json"])).map((r) => [r.number, r]));
  assert.deepEqual([...rows.keys()], [1, 2, 3]);
  assert.match(rows.get(1).external, /head is outside owner1\/repo1 \(other\/repo1\)/);
  assert.equal(rows.get(2).external, null);
  assert.equal(typeof rows.get(3).external, "string");
  assert.notEqual(rows.get(3).external, "");
});

test("F-010: the pr-status table marks the fork and the incomplete row VANJSKI, not the owner's", () => {
  const lines = prStatus([]).split(/\r?\n/);
  const line = (n) => lines.find((l) => l.startsWith(`#${n} `));
  assert.match(line(1), /^#1 a{8} main VANJSKI \(/);
  assert.match(line(3), /^#3 c{8} main VANJSKI \(/);
  assert.doesNotMatch(line(2), /VANJSKI/);
  assert.match(line(2), /^#2 b{8} main \| /);
});
