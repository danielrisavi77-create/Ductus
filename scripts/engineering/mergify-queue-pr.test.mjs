import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { isMergifyQueuePr } from "./mergify-queue-pr.mjs";

const carrier = {
  number: 7, state: "open", draft: true, title: "merge queue: main #1",
  user: { login: "mergify[bot]", id: 37929162, type: "Bot" },
  head: { sha: "a".repeat(40), ref: "mergify/merge-queue/012345abcd", repo: { id: 1, full_name: "o/r" } },
  base: { ref: "main", repo: { id: 1, full_name: "o/r" } },
};

const mutations = [
  ["user.login", "someone"], ["user.id", 1], ["user.type", "User"],
  ["draft", false], ["state", "closed"], ["base.ref", "other"],
  ["head.repo.full_name", "fork/r"], ["base.repo.full_name", "fork/r"],
  ["head.repo.id", 2], ["base.repo.id", "1"], ["base.repo.id", 0],
  ["head.ref", "mergify/merge-queue/abc"], ["head.ref", "feature/012345abcd"],
  ["head.ref", "mergify/merge-queue/012345abcd/extra"], ["head.sha", "abc"],
  ["title", "Update merge queue configuration"],
];
function mutate(key, value) {
  const pr = structuredClone(carrier);
  const parts = key.split(".");
  const leaf = parts.pop();
  const object = parts.reduce((obj, part) => obj[part], pr);
  if (value === undefined) delete object[leaf];
  else object[leaf] = value;
  return pr;
}

test("only the complete authenticated carrier is recognized; all missing/mutated markers reject", () => {
  assert.equal(isMergifyQueuePr(carrier, "o/r"), true);
  for (const [key, value] of mutations) {
    assert.equal(isMergifyQueuePr(mutate(key, value), "o/r"), false, key);
    assert.equal(isMergifyQueuePr(mutate(key, undefined), "o/r"), false, `missing ${key}`);
  }
  for (const pr of [null, {}, { head: {} }, { user: carrier.user }]) {
    assert.equal(isMergifyQueuePr(pr, "o/r"), false);
  }
  for (const repository of [undefined, "", "o/other", "o/r/extra"]) {
    assert.equal(isMergifyQueuePr(carrier, repository), false);
  }
});

const fakeFetch = `
const plan = JSON.parse(process.env.FAKE_PLAN);
globalThis.fetch = async (url) => {
  const path = new URL(url).pathname;
  if (plan.fail) throw new Error("API unavailable");
  let data;
  if (path === "/repos/o/r/pulls/7") data = plan.current;
  else if (path === "/repos/o/r/pulls/7/files") data = plan.files;
  else throw new Error("Unexpected API path: " + path);
  return { ok: true, status: 200, json: async () => data };
};
`;

function metadata(pr, { current = pr, files = [], fail = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mergify-metadata-"));
  try {
    writeFileSync(join(dir, "event.json"), JSON.stringify({ pull_request: pr }));
    writeFileSync(join(dir, "fetch.mjs"), fakeFetch);
    return spawnSync(process.execPath, ["--import", pathToFileURL(join(dir, "fetch.mjs")).href,
      resolve("scripts/engineering/pr-metadata-check.mjs")], {
      encoding: "utf8", env: {
        PATH: process.env.PATH, GITHUB_REPOSITORY: "o/r", GITHUB_TOKEN: "synthetic",
        GITHUB_EVENT_PATH: join(dir, "event.json"),
        FAKE_PLAN: JSON.stringify({ current, files, fail }),
      },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("real metadata CLI accepts a carrier but does not exempt any spoof or incomplete marker", () => {
  assert.equal(metadata(carrier).status, 0);
  for (const [key, value] of mutations) {
    assert.notEqual(metadata(mutate(key, value)).status, 0, key);
  }
});

test("real metadata CLI fails on API outage or head replacement, including a forged event carrier", () => {
  assert.notEqual(metadata(carrier, { fail: true }).status, 0);
  assert.notEqual(metadata(carrier, { current: mutate("head.sha", "b".repeat(40)) }).status, 0);
  assert.notEqual(metadata(carrier, { current: mutate("user.id", 2) }).status, 0);
});

test("ordinary source PRs still need metadata and the original critical risk floor", () => {
  const pr = { ...mutate("user.id", 2), changed_files: 1,
    body: "Agent: codex:source:platforma\nRisk: critical\nTask: DAN-263" };
  const files = [{ filename: ".github/mergify.yml", status: "modified" }];
  assert.equal(metadata(pr, { files }).status, 0);
  assert.notEqual(metadata({ ...pr, body: pr.body.replace("critical", "low") }, { files }).status, 0);
  assert.notEqual(metadata(pr, { files: [] }).status, 0, "incomplete file list");
  assert.notEqual(metadata({ ...pr, body: "" }, { files }).status, 0);
});
