// F-176: scripts/codex-review.ps1 treats the branch under review as untrusted.
// The script needs Codex and a network, so these checks read its source; the
// order checks keep each guard before the Codex call or before the post.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { D97_PATHS, ownerCommandPaths } from "./protected-paths.mjs";

const src = readFileSync(new URL("../codex-review.ps1", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const codexCall = src.search(/^[ \t]*codex exec review/m);
const post = src.indexOf("gh pr comment");
const at = (needle) => {
  const i = src.indexOf(needle);
  assert.notEqual(i, -1, `missing: ${needle}`);
  return i;
};

test("Codex runs read-only with no approval prompts, overriding the user config", () => {
  const line = src.slice(codexCall, src.indexOf("\n", codexCall));
  assert.match(line, /-c 'sandbox_mode="read-only"'/);
  assert.match(line, /-c 'approval_policy="never"'/);
  assert.doesNotMatch(line, /danger-full-access|workspace-write|--full-auto|--dangerously/);
  const calls = src.split("\n").filter((l) => /^[ \t]*codex\s/.test(l));
  assert.equal(calls.length, 1, "exactly one Codex call");
});

test("GitHub tokens are removed from the environment around the Codex call and restored after", () => {
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "OWNER_COMMAND_TOKEN"]) assert.ok(src.includes(`'${name}'`), name);
  assert.ok(at("SetEnvironmentVariable($name, $null, 'Process')") < codexCall);
  const restore = at("} finally {");
  assert.ok(restore > codexCall && restore < post);
});

test("only main's copy runs, and a branch that changes agent instructions is refused, before Codex", () => {
  assert.ok(at("git show origin/main:scripts/codex-review.ps1") < codexCall);
  assert.ok(at("$PSCommandPath") < codexCall);
  assert.ok(at("differs from origin/main") < codexCall);
  const instructions = at("changes agent instructions");
  assert.ok(instructions < codexCall);
  const re = /\$_ -match '([^']+)' -or \$_ -match '([^']+)'/.exec(src);
  assert.ok(re, "instruction pattern");
  const [agentRe, codexDir] = [new RegExp(re[1].replace("(?i)", ""), "i"), new RegExp(re[2].replace("(?i)", ""), "i")];
  for (const p of ["AGENTS.md", "src/AGENTS.override.md", "CLAUDE.md", "docs/CLAUDE.local.md", "GEMINI.md", ".github/copilot-instructions.md", "x/y.instructions.md"]) {
    assert.ok(agentRe.test(p), p);
  }
  assert.ok(codexDir.test(".codex/config.toml") && codexDir.test("a/.codex/x"));
  for (const p of ["src/agents/list.ts", "docs/PRODUCT.md", "README.md"]) assert.ok(!agentRe.test(p) && !codexDir.test(p), p);
});

test("a review that looks like it carries a credential is never posted", () => {
  const check = at("looks like it contains a credential");
  assert.ok(check > codexCall && check < post);
  const pattern = /\$secretRe = '([^']+)'/.exec(src)?.[1];
  assert.ok(pattern);
  const secretRe = new RegExp(pattern.replace("(?i)", ""), "i");
  for (const leak of [`ghp_${"a".repeat(36)}`, `github_pat_${"b".repeat(30)}`, `sk-${"c".repeat(30)}`, `eyJ${"d".repeat(20)}.${"e".repeat(20)}`, '"refresh_token": "x"', "access_token=x"]) {
    assert.ok(secretRe.test(leak), leak);
  }
  for (const fine of ["Review-Verdict: PASS", "token budget", "src/server/auth/session.ts:12"]) assert.ok(!secretRe.test(fine), fine);
});

test("the review scripts are D-97 paths", () => {
  for (const p of ["scripts/codex-review.ps1", "scripts/grok-review.ps1"]) {
    assert.ok(D97_PATHS.includes(p), p);
    assert.deepEqual(ownerCommandPaths([p]), [p]);
  }
});
