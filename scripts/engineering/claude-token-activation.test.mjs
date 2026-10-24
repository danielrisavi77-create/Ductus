import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const settingsPath = path.join(root, ".claude", "settings.json");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("Claude statusline is configured as a local Node command without shell/network indirection", () => {
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.statusLine, {
    type: "command",
    command: "node scripts/engineering/claude-statusline.mjs",
  });
  assert.doesNotMatch(settings.statusLine.command, /[;&|<>$\\]/);
  assert.ok(settings.hooks.PreToolUse.some(e =>
    e.matcher === "Bash|PowerShell" &&
    e.hooks.some(h => h.onFailure === "block" &&
      String(h.command).includes("safety-net.mjs"))));
  assert.ok(settings.hooks.PreToolUse.some(e => e.matcher === "Read"));
  assert.ok(settings.hooks.UserPromptSubmit?.length);
  assert.ok(settings.permissions.deny.includes("Read(**/.env.local)"));
  assert.ok(settings.permissions.deny.includes("Bash(git push origin main)"));
  assert.equal(settings.enabledPlugins["claude-security@claude-plugins-official"], true);
});

test("both runtime-neutral skill copies are exactly identical and keep scope bounded", () => {
  const a = read(".claude/skills/ductus-token-budget/SKILL.md");
  const b = read(".agents/skills/ductus-token-budget/SKILL.md");
  assert.equal(a, b);
  assert.match(a, /name: ductus-token-budget/);
  assert.match(a, /DAN-275\/276\/277/);
  assert.match(a, /not the Max subscription quota/);
  assert.match(a, /Preserve all existing independent review\/QA checks/);
  assert.ok(a.length < 4_000, "skill must stay a thin router");
});

test("statusLine actually executes with official JSON fields and fails closed to n/a for bad input", () => {
  const script = "scripts/engineering/claude-statusline.mjs";
  assert.ok(fs.existsSync(path.join(root, script)), "DAN-275 must merge first");
  const run = (input) => spawnSync(process.execPath, [script], {
    cwd: root, encoding: "utf8", input, timeout: 5_000, maxBuffer: 64_000,
  });
  const good = run(JSON.stringify({
    model: { display_name: "Claude Sonnet" },
    context_window: { used_percentage: 42.4 },
    rate_limits: { five_hour: { used_percentage: 17 }, seven_day: { used_percentage: 53 } },
    prompt_cache: { hit_ratio: 0.9 },
  }));
  assert.equal(good.status, 0);
  assert.equal(good.stdout.trim(), "Claude Sonnet | CTX 42% | 5h 17% | 7d 53% | Cache 90%");
  const bad = run("{ not-json");
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout.trim(), "Claude | CTX n/a | 5h n/a | 7d n/a | Cache n/a");
  assert.doesNotMatch(bad.stdout + bad.stderr, /not-json/);
});

test("project package keeps existing token-report trigger", () => {
  const p = JSON.parse(read("package.json"));
  assert.equal(p.scripts["tokens:report"], "node scripts/engineering/token-report.mjs");
});
