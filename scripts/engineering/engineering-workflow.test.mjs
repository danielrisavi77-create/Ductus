import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflowPath = new URL("../../.github/workflows/engineering-gate.yml", import.meta.url);

test("privileged engineering workflow remains metadata-only", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /issue_comment:/);
  assert.doesNotMatch(workflow, /pull_request_review:/);

  assert.match(
    workflow,
    /ref:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/,
  );

  for (const forbidden of [
    "github.event.pull_request.head",
    "refs/pull/",
    "gh pr checkout",
    "git fetch",
    "pnpm install",
    "npm install",
    "npm ci",
    "pnpm test",
    "npm test",
  ]) {
    assert.equal(
      workflow.includes(forbidden),
      false,
      `privileged workflow must not contain untrusted-code execution primitive: ${forbidden}`,
    );
  }

  assert.match(workflow, /statuses:\s*write/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /actions:\s*write/);
});

test("privileged workflow documents the dangerous-trigger exception", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /zizmor:\s*ignore\[dangerous-triggers\]/);
  assert.match(workflow, /PR code is never fetched or executed/);
});

// The top-level keys of a workflow's `on:` block (block form only).
function triggers(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^on:(\s*#.*)?$/.test(line));
  assert.ok(start >= 0, "workflow has a block-form `on:`");
  const names = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const key = /^ {2}([A-Za-z_]+):/.exec(line);
    if (key) names.push(key[1]);
    else assert.ok(/^\s*(#.*)?$/.test(line) || /^ {3,}/.test(line), `unexpected line under on: ${line}`);
  }
  return names;
}

test("every trigger of the files under Actions policy 6529 is on the recorded allowed list (DAN-337)", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const listed = /^# actions-policy-6529-allowed-events: (.+)$/m.exec(workflow);
  assert.ok(listed, "engineering-gate.yml records the policy's allowed events");
  const allowed = new Set(listed[1].split(",").map((name) => name.trim()));
  assert.deepEqual([...allowed].sort(), ["issue_comment", "pull_request_target", "workflow_run"]);
  const review = await readFile(new URL("../../.github/workflows/free-ai-pr-review.yml", import.meta.url), "utf8");
  for (const [file, text] of [["engineering-gate.yml", workflow], ["free-ai-pr-review.yml", review]]) {
    const names = triggers(text);
    assert.ok(names.length > 0, `${file} has triggers`);
    for (const name of names) assert.ok(allowed.has(name), `${file}: ${name} is not allowed by policy 6529`);
  }
  assert.deepEqual(triggers(workflow), ["pull_request_target", "issue_comment", "workflow_run"]);
});

test("the trigger reader sees every key under on:", () => {
  const text = "name: x\non: # note\n  push:\n    branches: [main]\n  # a comment\n  workflow_dispatch:\n\npermissions: {}\n";
  assert.deepEqual(triggers(text), ["push", "workflow_dispatch"]);
  assert.throws(() => triggers("on:\n push:\n"), /unexpected line/);
});

const relayPath =new URL("../../.github/workflows/engineering-gate-review-signal.yml", import.meta.url);

test("a PR review reaches the gate only through the unprivileged relay (#128)", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const relay = await readFile(relayPath, "utf8");

  // The privileged gate listens to the relay by name, never to the review itself.
  assert.match(relay, /^name:\s*Engineering gate review signal\s*$/m);
  assert.match(workflow, /workflow_run:\s*\n\s*workflows:\s*\[Engineering gate review signal\]\s*\n\s*types:\s*\[completed\]/);
  assert.doesNotMatch(workflow, /pull_request_review:/);

  assert.match(relay, /pull_request_review:\s*\n\s*types:\s*\[submitted, edited, dismissed\]/);
  assert.match(relay, /^permissions:\s*\{\}\s*$/m);
  for (const forbidden of ["uses:", "secrets.", "github.token", "GITHUB_TOKEN", "${{", "workflow_run", "pull_request_target"]) {
    assert.equal(relay.includes(forbidden), false, `review relay must stay inert: ${forbidden}`);
  }
});
