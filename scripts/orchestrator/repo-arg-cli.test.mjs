// DAN-734 (S-0.21): with `--repo` every gh call of an orch:* script goes to the
// requested repository and nowhere else. The CLI tests run the real scripts with
// gh answered by fake-gh-routes-preload.mjs from invented rows that exist only
// under repos/ductura/server; any other path, including an unresolved
// {owner}/{repo}, fails the call, so a passing test shows that only that
// repository was read.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ghJson, repoId, targetArgs, setTargetRepo } from "./gh.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const R = "repos/ductura/server";
const PAGE = `${R}/pulls?state=open&per_page=100&page=1`;
const META = { [R]: [{ name: "server", owner: { login: "ductura" }, full_name: "ductura/server" }] };
const EMPTY = {
  ...META,
  [PAGE]: [[]],
  [`${R}/pulls/1`]: [{ $error: "gh: Not Found (HTTP 404)" }],
  [`${R}/branches/main`]: [{ $error: "gh: Branch not found (HTTP 404)" }],
};
const pull = {
  number: 5, title: "t", body: null, state: "open", draft: false, merged_at: null, mergeable: true,
  head: { sha: "d".repeat(40), ref: "feat", repo: { full_name: "ductura/server" } },
  base: { ref: "main", repo: { full_name: "ductura/server" } }, created_at: "2026-10-01T00:00:00Z", auto_merge: null,
  user: { login: "ductura", type: "Organization" },
};
const C = `${R}/commits/${"d".repeat(40)}`;
const ONE = {
  ...META,
  [PAGE]: [[pull]],
  [`${R}/pulls/5/files?per_page=100&page=1`]: [[{ filename: "src/a.ts" }]],
  [`${R}/issues/5/comments?per_page=100&page=1`]: [[]],
  [`${C}/check-runs?per_page=100&page=1`]: [{ total_count: 1, check_runs: [{ name: "test", status: "completed", conclusion: "success" }] }],
  [`${C}/statuses?per_page=100&page=1`]: [[{ context: "Engineering Gate", state: "pending", created_at: "2026-10-01T00:00:00Z" }]],
};

function run(script, args, routes) {
  const dir = mkdtempSync(join(tmpdir(), "repo-arg-cli-"));
  try {
    const file = join(dir, "routes.json");
    writeFileSync(file, JSON.stringify(routes));
    return spawnSync(process.execPath, [
      "--import", pathToFileURL(join(here, "fake-gh-routes-preload.mjs")).href, join(here, script), ...args,
    ], { env: { ...process.env, FAKE_GH_ROUTES: file }, encoding: "utf8", windowsHide: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("without a target the gh arguments are passed on unchanged, placeholders included", async () => {
  const seen = [];
  const exec = async (_cmd, args) => { seen.push(args); return "{}"; };
  setTargetRepo(null);
  await ghJson(["api", "repos/{owner}/{repo}/pulls/1"], exec);
  assert.deepEqual(seen, [["api", "repos/{owner}/{repo}/pulls/1"]]);
  assert.deepEqual(targetArgs(["api", "graphql", "-f", "owner={owner}"]), ["api", "graphql", "-f", "owner={owner}"]);
});

test("with a target every placeholder names that repository, and repoId is read again from it", async () => {
  const seen = [];
  const exec = async (_cmd, args) => {
    seen.push(args[1]);
    const [, owner, name] = args[1].split("/");
    return JSON.stringify({ owner: { login: owner }, name });
  };
  const json = (args) => ghJson(args, exec);
  try {
    setTargetRepo(null);
    assert.deepEqual(await repoId({ json }), { owner: "{owner}", repo: "{repo}" });
    setTargetRepo("ductura/web");
    assert.deepEqual(await repoId({ json }), { owner: "ductura", repo: "web" });
    assert.deepEqual(seen, ["repos/{owner}/{repo}", "repos/ductura/web"]);
    assert.deepEqual(targetArgs(["api", "graphql", "-F", "owner={owner}", "-F", "repo={repo}", 7]),
      ["api", "graphql", "-F", "owner=ductura", "-F", "repo=web", 7]);
  } finally {
    setTargetRepo(null);
  }
});

test("setTargetRepo refuses a value that is not owner/name", () => {
  for (const bad of ["ductura", "a/b/c", "{owner}/{repo}", "../x", ""]) assert.throws(() => setTargetRepo(bad), /owner\/name/, bad);
});

test("an empty repository (no PRs, no main branch) breaks none of the scripts", () => {
  const status = run("pr-status.mjs", ["--json", "--repo", "ductura/server"], EMPTY);
  assert.equal(status.status, 0, status.stderr);
  assert.deepEqual(JSON.parse(status.stdout), []);
  const table = run("pr-status.mjs", ["--repo=ductura/server"], EMPTY);
  assert.equal(table.status, 0, table.stderr);
  assert.match(table.stdout, /no open PRs/);
  const overlap = run("pr-overlap.mjs", ["--repo", "ductura/server"], EMPTY);
  assert.equal(overlap.status, 0, overlap.stderr);
  assert.match(overlap.stdout, /0 open PRs, 0 overlapping pairs/);
  const merge = run("merge-ready.mjs", ["--all", "--repo", "ductura/server"], EMPTY);
  assert.equal(merge.status, 0, merge.stderr);
  for (const script of ["preflight.mjs", "pr-ready.mjs"]) {
    const r = run(script, ["1", "--repo", "ductura/server"], EMPTY);
    assert.equal(r.status, 2, `${script}: ${r.stderr}`);
    assert.match(r.stderr, /Not Found/, script);
    assert.doesNotMatch(r.stderr, /\n\s+at /, `${script}: no stack trace`);
  }
});

test("a PR in the requested repository is listed, and only that repository is read", () => {
  const r = run("pr-status.mjs", ["--repo", "Ductura/Server", "--json"], ONE);
  assert.equal(r.status, 0, r.stderr);
  const rows = JSON.parse(r.stdout);
  assert.deepEqual(rows.map((x) => [x.number, x.head, x.base, x.external]), [[5, "dddddddd", "main", null]]);
  // Every per-PR read (files, checks, gate status) answered from ductura/server.
  assert.notEqual(rows[0].ci, "?");
  assert.notEqual(rows[0].gate, "?");
});

test("without --repo the scripts still ask for the working directory's repository", () => {
  const r = run("pr-status.mjs", ["--json"], ONE);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unexpected path repos\/\{owner\}\/\{repo\}\/pulls/);
});

test("a bad --repo is a usage error with exit 2, before any gh call", () => {
  const cases = [
    ["pr-status.mjs", ["--repo", "ductura/nepostojeci"]],
    ["pr-status.mjs", ["--Repo", "ductura/server"]],
    ["pr-status.mjs", ["\u2014repo", "ductura/server"]],
    ["pr-overlap.mjs", ["--repos", "ductura/server"]],
    ["preflight.mjs", ["1", "--repo"]],
    ["pr-ready.mjs", ["1", "--repo", "ductura/server", "--repo", "ductura/server"]],
    ["merge-ready.mjs", ["--all", "--repo=../server"]],
  ];
  for (const [script, args] of cases) {
    const r = run(script, args, {});
    assert.equal(r.status, 2, `${script} ${args.join(" ")}: ${r.stderr}`);
    assert.match(r.stderr, /^usage error: /, script);
    assert.doesNotMatch(r.stderr, /fake gh/, script);
  }
});

test("orch:metrics with --repo reads the merged PRs, comments, files and events of that repository only", () => {
  const merged = { ...pull, state: "closed", merged_at: "2026-10-02T00:00:00Z" };
  const routes = {
    ...META,
    [`${R}/pulls?state=closed&base=main&per_page=100&page=1`]: [[merged]],
    [`${R}/issues/5/comments?per_page=100&page=1`]: [[]],
    [`${R}/pulls/5/files?per_page=100&page=1`]: [[{ filename: "src/a.ts" }]],
    [`${R}/issues/5/events?per_page=100&page=1`]: [[]],
  };
  const r = run("pr-metrics.mjs", ["--since", "2026-10-01", "--json", "--repo", "ductura/server"], routes);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.rows.map((x) => x.number), [5]);
  // Without --repo the same script asks for the working directory's repository, as before.
  const plain = run("pr-metrics.mjs", ["--since", "2026-10-01", "--json"], routes);
  assert.equal(plain.status, 2);
  assert.match(plain.stderr, /unexpected path repos\/\{owner\}\/\{repo\}\/pulls/);
  const bad = run("pr-metrics.mjs", ["--since", "2026-10-01", "--repos", "ductura/server"], routes);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /^usage error: /);
  assert.doesNotMatch(bad.stderr, /fake gh/);
});

test("every other GitHub-reading orch:* script refuses --repo instead of silently reading the working directory", () => {
  const cases = [
    ["health.mjs", ["--repo", "ductura/server"]],
    ["health.mjs", ["--Repo=ductura/server"]],
    ["pr-brief.mjs", ["1", "--repo", "ductura/server"]],
    ["evidence.mjs", ["--pr", "1", "--repo", "ductura/server"]],
    ["failure-capsule.mjs", ["--run", "1", "--repo", "ductura/server"]],
    ["ci-twin.mjs", ["--since", "2026-10-01", "--repo", "ductura/server"]],
    ["override-block.mjs", ["1", "--repo", "ductura/server"]],
    ["wait-verdict.mjs", ["1", "--repo", "ductura/server"]],
    ["verdict.mjs", ["1", "--repo", "ductura/server"]],
    ["push-verify.mjs", ["--repo", "ductura/server"]],
    ["session-worktree-clean.mjs", ["--repo", "ductura/server"]],
    ["pr-status.mjs", ["\uff0d\uff0drepo", "ductura/server"]],
    ["pr-metrics.mjs", ["--since", "2026-10-01", "--\u200brepo", "ductura/server"]],
    ["pr-status.mjs", ["--json", "--re\u200bpo", "ductura/server"]],
    ["health.mjs", ["--re\u200bpo", "ductura/server"]],
    ["session-worktree-clean.mjs", ["--rep\u00ado=ductura/server"]],
    ["pr-overlap.mjs", ["--r\u2060epo", "ductura/server"]],
  ];
  for (const [script, args] of cases) {
    const r = run(script, args, {});
    assert.equal(r.status, 2, `${script} ${args.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stderr + r.stdout, /fake gh/, `${script}: no gh call`);
  }
});
