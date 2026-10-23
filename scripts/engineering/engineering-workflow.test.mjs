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

const relayPath = new URL("../../.github/workflows/engineering-gate-review-signal.yml", import.meta.url);

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
