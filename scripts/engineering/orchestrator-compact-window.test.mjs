// #211, item 1 (owner decision 12 Oct 2026): the orchestrator sets the 400k
// auto-compact window at launch for its own session only (`--settings`),
// never in .claude/settings.local.json, which every session in the checkout
// and every local worktree (.worktreeinclude) reads.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const read = (file) => fs.readFileSync(path.join(repo, file), "utf8");

test("ORKESTRATOR.md and SESSIONS.md set the 400k window at launch, never in settings.local.json", () => {
  const rules = read("docs/ORKESTRATOR.md");
  const sessions = read("docs/SESSIONS.md");
  assert.match(rules, /--settings '\{"env":\{"CLAUDE_CODE_AUTO_COMPACT_WINDOW":"400000"\}\}'/);
  for (const [name, text] of [["ORKESTRATOR.md", rules], ["SESSIONS.md", sessions]]) {
    assert.match(text, /--settings/, name);
    assert.match(text, /ne upisuje u `\.claude\/settings\.local\.json`/, name);
    assert.doesNotMatch(text, /400000 (u vlastitom|drži u vlastitom) `\.claude\/settings\.local\.json`/, name);
    assert.doesNotMatch(text, /prihvaćeno ograničenje/i, name);
  }
});

test("the shared settings keep the 200k window for every other session", () => {
  const settings = JSON.parse(read(".claude/settings.json"));
  assert.equal(settings.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "200000");
});

test(".worktreeinclude still copies settings.local.json, so it must not carry the window", () => {
  // If this ever stops being true the rule above can be relaxed; until then the
  // documents must keep forbidding the value in settings.local.json.
  const lines = read(".worktreeinclude").split(/\r?\n/).map((line) => line.trim());
  assert.ok(lines.includes(".claude/settings.local.json"));
});
