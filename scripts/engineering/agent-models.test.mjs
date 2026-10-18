// DAN-213: model per agent profile, no global subagent model (owner decision 18 Oct 2026,
// #87 issuecomment-6249010423). Writers, review, QA and security stay on Opus.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const agents = path.join(repo, ".claude", "agents");

function profiles() {
  const out = {};
  // Claude Code loads profiles from the whole tree, so every nested .md counts (#429 review).
  const files = fs.readdirSync(agents, { recursive: true }).map(String).filter((x) => x.endsWith(".md"));
  for (const f of files) {
    const head = fs.readFileSync(path.join(agents, f), "utf8").split(/^---$/m)[1] ?? "";
    const fields = Object.fromEntries(
      head.split("\n").map((l) => /^([A-Za-z]+):\s*(.+)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]),
    );
    out[fields.name ?? f] = { model: fields.model, maxTurns: fields.maxTurns };
  }
  return out;
}

const EXPECTED = {
  "ductus-backend-data": "opus",
  "ductus-frontend-editor": "opus",
  "ductus-platform-sre": "opus",
  "ductus-independent-reviewer": "opus",
  "ductus-adversarial-qa": "opus",
  "ductus-security-reviewer": "opus",
  "ductus-orchestrator": "inherit",
  "ductus-scout": "haiku",
  "ductus-architecture-performance": "sonnet",
  "ductus-privacy-legal-pilot": "sonnet",
  "ductus-product-ux": "sonnet",
  "ductus-accessibility": "sonnet",
  "ductus-bug-hunter": "sonnet",
};

test("settings set no global subagent model that would override the profiles", () => {
  const settings = JSON.parse(fs.readFileSync(path.join(repo, ".claude", "settings.json"), "utf8"));
  assert.equal(settings.env?.CLAUDE_CODE_SUBAGENT_MODEL, undefined);
});

test("every agent profile has the model the owner decided", () => {
  const all = profiles();
  assert.deepEqual(Object.keys(all).sort(), Object.keys(EXPECTED).sort(), "a new profile needs a decided model here");
  for (const [name, model] of Object.entries(EXPECTED)) assert.equal(all[name].model, model, name);
});

test("the three writers stop on maxTurns 500; no other profile is capped", () => {
  for (const [name, p] of Object.entries(profiles())) {
    const writer = ["ductus-backend-data", "ductus-frontend-editor", "ductus-platform-sre"].includes(name);
    assert.equal(p.maxTurns, writer ? "500" : undefined, name);
  }
});
