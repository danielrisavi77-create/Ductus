// D-293 (#87 c.6858156704 point 2): review and QA PASS carry over a base conflict resolution that changed only
// db/schema.sql and db/migrations.sum when the rest of the diff is identical and the D-91 checks are green on the
// new head; a FAIL carries as before. Every input class from the contract (#1836 c.6858312517) is a table row.
import test from "node:test";
import assert from "node:assert/strict";

import {
  SCHEMA_CHECK_RUNS,
  carriedByCompare,
  carriedHeadCandidates,
  evaluateGate,
  evaluateMergeAuthorization,
  onlyBaseMerges,
  regenOnlyCommit,
  sameChange,
  sameChangeOutsideSchema,
  schemaChecksGreen,
} from "./review-gate-core.mjs";
import { carriedHeads, createApi } from "./review-gate-api.mjs";

const head = "a".repeat(40);
const earlier = "b".repeat(40);
const middle = "c".repeat(40);
const ownerLogin = "danielrisavi77-create";
const BODY = "Agent: claude:a:platforma\nRisk: critical\nTask: B-1\n";

let counter = 0;
const comment = (text, { appSlug = "claude", login = ownerLogin, association = "OWNER" } = {}) => ({
  body: text,
  user: { login, type: "User" },
  author_association: association,
  performed_via_github_app: appSlug ? { slug: appSlug } : null,
  created_at: new Date(1_700_000_000_000 + counter++ * 1000).toISOString(),
});
const review = (sha, verdict = "PASS") => comment(`Agent-Review: claude:b:reviewer\nReview-Head: ${sha}\nReview-Verdict: ${verdict}\n`);
const qa = (sha, verdict = "PASS") =>
  comment(`QA-Agent: chatgpt:c:qa\nQA-Head: ${sha}\nQA-Verdict: ${verdict}\nQA-Scope: gate\n`, {
    appSlug: "chatgpt-codex-connector",
    login: "chatgpt-codex-connector[bot]",
  });
const override = (sha) => comment(`Owner-Override: PASS\nOverride-Head: ${sha}\nOverride-Reason: demo\n`, { appSlug: null });
const command = (sha) => comment(`Owner-Command: merge\nCommand-Head: ${sha}\nDatum: 2026-11-13\n`, { appSlug: null });

const file = (filename, patch = "@@ -1 +1 @@\n-a\n+b", extra = {}) => ({
  filename,
  status: "modified",
  patch,
  entry: "100644 blob",
  baseEntry: "100644 blob",
  ...extra,
});
const APP = file("src/a.ts");
const MIGRATION = file("db/migrations/20261113000000_x.sql", "@@ -0,0 +1 @@\n+create table x ();", { status: "added", baseEntry: "absent" });
const SCHEMA = file("db/schema.sql", "@@ -1 +1,2 @@\n a\n+x");
const SUM = file("db/migrations.sum", "@@ -1 +1,2 @@\n a\n+x");
const regenerated = (base) => ({ ...base, patch: `${base.patch}\n+main` });
const earlierDiff = { files: [APP, MIGRATION, SCHEMA, SUM] };

const merge = (sha) => ({ sha, parents: [{}, {}], mergesBase: true });
const plain = (sha) => ({ sha, parents: [{}], files: [{ filename: "src/a.ts", status: "modified" }] });
const regenFiles = [{ filename: "db/schema.sql", status: "modified" }, { filename: "db/migrations.sum", status: "modified" }];
const regen = (sha, files = regenFiles) => ({ sha, parents: [{}], files });

const run = (name, conclusion = "success", extra = {}) => ({
  ...{ id: counter++, name, head_sha: head, status: conclusion ? "completed" : "in_progress", conclusion },
  ...{ app: { slug: "github-actions" }, ...extra },
});
const greenRuns = () => SCHEMA_CHECK_RUNS.map((name) => run(name));

test("compare classes: only the two regenerated files may differ", () => {
  const rows = [
    ["schema and ledger regenerated", [APP, MIGRATION, regenerated(SCHEMA), regenerated(SUM)], true],
    ["only the schema regenerated", [APP, MIGRATION, regenerated(SCHEMA), SUM], true],
    ["regenerated file too large for a patch", [APP, MIGRATION, { ...SCHEMA, patch: undefined }, SUM], true],
    ["identical diff", [APP, MIGRATION, SCHEMA, SUM], true],
    ["migration content changed", [APP, { ...MIGRATION, patch: `${MIGRATION.patch}\n+x` }, regenerated(SCHEMA), SUM], false],
    ["migration renumbered", [APP, { ...MIGRATION, filename: "db/migrations/20261114000000_x.sql" }, regenerated(SCHEMA), SUM], false],
    ["another file changed", [regenerated(APP), MIGRATION, regenerated(SCHEMA), SUM], false],
    ["another file added", [APP, MIGRATION, SCHEMA, SUM, file("src/b.ts")], false],
    ["a file dropped", [MIGRATION, SCHEMA, SUM], false],
    ["schema became a symlink", [APP, MIGRATION, { ...regenerated(SCHEMA), entry: "120000 blob" }, SUM], false],
    ["ledger mode changed", [APP, MIGRATION, SCHEMA, { ...SUM, entry: "100755 blob" }], false],
    ["schema renamed in", [APP, MIGRATION, { ...SCHEMA, status: "renamed", previous_filename: "db/old.sql" }, SUM], false],
    ["schema without tree entry", [APP, MIGRATION, { ...SCHEMA, entry: undefined }, SUM], false],
    ["schema renamed away", [APP, MIGRATION, { ...SCHEMA, filename: "db/schema2.sql", previous_filename: "db/schema.sql", status: "renamed" }, SUM], false],
  ];
  for (const [name, files, expected] of rows) {
    assert.equal(sameChangeOutsideSchema({ files }, earlierDiff), expected, name);
    // The strict D-101 comparison is unchanged: any regenerated file differs.
    if (expected && files.some((item) => item.patch !== earlierDiff.files.find((other) => other.filename === item.filename)?.patch)) {
      assert.equal(sameChange({ files }, earlierDiff), false, `${name} (strict)`);
    }
  }
  // Nothing left once the two files are set aside: there is no PR diff to vouch for.
  assert.equal(sameChangeOutsideSchema({ files: [regenerated(SCHEMA), SUM] }, { files: [SCHEMA, SUM] }), false);
  assert.equal(sameChangeOutsideSchema({ files: [] }, { files: [] }), false);
  assert.equal(sameChangeOutsideSchema(undefined, earlierDiff), false);
});

test("commit classes: a step that is not a base merge may only regenerate the two files", () => {
  const rows = [
    ["both files", regen(head), true],
    ["schema only", regen(head, [{ filename: "db/schema.sql", status: "modified" }]), true],
    ["ledger only", regen(head, [{ filename: "db/migrations.sum", status: "modified" }]), true],
    ["a third file", regen(head, [{ filename: "db/schema.sql", status: "modified" }, { filename: "src/a.ts", status: "modified" }]), false],
    ["a migration", regen(head, [{ filename: "db/migrations/20261113000000_x.sql", status: "modified" }]), false],
    ["renamed", regen(head, [{ filename: "db/schema.sql", status: "renamed", previous_filename: "db/x.sql" }]), false],
    ["added", regen(head, [{ filename: "db/schema.sql", status: "added" }]), false],
    ["removed", regen(head, [{ filename: "db/migrations.sum", status: "removed" }]), false],
    ["mode only", regen(head, [{ filename: "db/schema.sql", status: "changed" }]), false],
    ["same file twice", regen(head, [{ filename: "db/schema.sql", status: "modified" }, { filename: "db/schema.sql", status: "modified" }]), false],
    ["three entries", regen(head, [...regen(head).files, { filename: "db/schema.sql", status: "modified" }]), false],
    ["empty files", regen(head, []), false],
    ["files unread", { sha: head, parents: [{}] }, false],
    ["two parents", { ...regen(head), parents: [{}, {}] }, false],
    ["no parents", { ...regen(head), parents: [] }, false],
  ];
  for (const [name, commit, expected] of rows) {
    assert.equal(regenOnlyCommit(commit), expected, name);
    assert.equal(onlyBaseMerges([commit, plain(earlier)], earlier, { schema: true }), expected, `${name} (path)`);
    assert.equal(onlyBaseMerges([commit, plain(earlier)], earlier), false, `${name} (strict)`);
  }
  assert.equal(onlyBaseMerges([merge(head), regen(middle), merge("d".repeat(40)), plain(earlier)], earlier, { schema: true }), true);
  assert.equal(onlyBaseMerges([merge(head), plain(earlier)], earlier, { schema: true }), true);
  assert.equal(onlyBaseMerges([{ ...merge(head), mergesBase: false }, plain(earlier)], earlier, { schema: true }), false);
  assert.equal(onlyBaseMerges([{ sha: head, parents: [{}, {}, {}], mergesBase: true }, plain(earlier)], earlier, { schema: true }), false);
});

test("check classes: every D-91 check must be green on the current head", () => {
  const without = (name) => greenRuns().filter((item) => item.name !== name);
  const swap = (name, replacement) => [...without(name), replacement];
  const [ledger, shard] = [SCHEMA_CHECK_RUNS[0], SCHEMA_CHECK_RUNS[1]];
  const rows = [
    ["all green", greenRuns(), true],
    ["ledger job missing", without(ledger), false],
    ["a schema shard missing", without(shard), false],
    ["a shard failed", swap(shard, run(shard, "failure")), false],
    ["a shard still running", swap(shard, run(shard, null)), false],
    ["a shard skipped", swap(shard, run(shard, "skipped")), false],
    ["a shard neutral", swap(shard, run(shard, "neutral")), false],
    ["a shard on another head", swap(shard, run(shard, "success", { head_sha: earlier })), false],
    ["a shard from another app", swap(shard, run(shard, "success", { app: { slug: "ductus-botovi" } })), false],
    ["re-run failed after a success", [...greenRuns(), run(shard, "failure")], false],
    ["re-run passed after a failure", [run(shard, "failure"), ...greenRuns()], true],
    ["not a list", null, false],
  ];
  for (const [name, runs, expected] of rows) assert.equal(schemaChecksGreen(runs, head), expected, name);
});

const evaluate = (comments, carried) => evaluateGate({ body: BODY, headSha: head, ownerLogin, comments, carriedHeads: carried });
const changed = { files: [APP, MIGRATION, regenerated(SCHEMA), SUM] };
const carryWith = (current, schemaGreen, path = [merge(head), plain(earlier)]) =>
  carriedByCompare([earlier], current, async () => earlierDiff, () => {}, { path, schemaGreen });
const schemaCarry = (green, path) => carryWith(changed, async () => green, path);

test("green checks carry review and QA PASS through a regenerated schema", async () => {
  const carried = await schemaCarry(true);
  assert.equal(carried.size, 0);
  assert.deepEqual([...carried.verdictOnly], [earlier]);
  assert.equal(evaluate([review(earlier), qa(earlier)], carried).state, "success");
  // Through a separate regeneration commit as well.
  const separate = await schemaCarry(true, [regen(head), merge(middle), plain(earlier)]);
  assert.equal(evaluate([review(earlier), qa(earlier)], separate).state, "success");
});

test("checks that are not green carry no PASS, but a FAIL still blocks", async () => {
  for (const outcome of [false, "throws"]) {
    const carried = await carryWith(changed, async () => {
      if (outcome === "throws") throw new Error("check-runs 500");
      return outcome;
    });
    assert.equal(carried.verdictOnly.size, 0, String(outcome));
    assert.deepEqual([...carried.heldNegatives], [earlier]);
    assert.equal(evaluate([review(earlier), qa(earlier)], carried).state, "pending");
    const failed = evaluate([review(earlier, "FAIL"), qa(earlier)], carried);
    assert.equal(failed.state, "pending");
    assert.match(failed.description, /fail/i);
  }
  const green = await schemaCarry(true);
  assert.equal(evaluate([review(earlier, "FAIL"), qa(earlier)], green).state, "pending");
});

test("a diff that differs outside the two files carries nothing", async () => {
  const migrationChanged = { files: [APP, { ...MIGRATION, patch: "@@ -0,0 +1 @@\n+create table y ();" }, regenerated(SCHEMA), SUM] };
  let asked = false;
  const carried = await carryWith(migrationChanged, async () => (asked = true));
  assert.equal(carried.size + carried.verdictOnly.size + carried.heldNegatives.size, 0);
  assert.equal(asked, false);
});

test("a schema-path head carries no Owner-Override and no Owner-Command", async () => {
  const carried = await schemaCarry(true);
  assert.equal(evaluate([override(earlier)], carried).state, "pending");
  const authorized = evaluateMergeAuthorization({
    ...{ gate: { state: "success", description: "ok" }, metadata: { ok: true, risk: "critical", minimumRisk: "critical" } },
    ...{ paths: [".github/workflows/engineering-gate.yml"], comments: [command(earlier)], headSha: head, ownerLogin },
    ...{ carriedHeads: carried, sameRepository: true },
  });
  assert.equal(authorized.state, "pending");
  // The strict D-101 path still carries both, as before.
  const strict = await carryWith(earlierDiff, async () => false);
  assert.deepEqual([...strict], [earlier]);
  assert.equal(evaluate([override(earlier)], strict).state, "success");
});

test("the walk passes regeneration commits and still needs a real end", () => {
  const comments = [review(earlier)];
  assert.deepEqual(carriedHeadCandidates(comments, head, [regen(head), plain(earlier)]), { heads: [earlier], reason: null });
  const bad = regen(head, [{ filename: "src/a.ts", status: "modified" }]);
  assert.deepEqual(carriedHeadCandidates(comments, head, [bad, plain(earlier)]), { heads: [], reason: null });
  // Only regeneration commits walked and the named head not reached: nothing carries.
  const unfinished = carriedHeadCandidates([review("d".repeat(40))], head, [regen(head), regen(middle)]);
  assert.match(unfinished.reason ?? "", /did not reach/);
});

// The runner: walk, compares and check-runs are all anchored on pr.head.sha.
test("the runner reads the D-91 checks on the current head and carries the PASS", async () => {
  const [base, mainParent] = ["e".repeat(40), "f".repeat(40)];
  const tree = (paths) => ({ truncated: false, tree: paths.map((path) => ({ path, mode: "100644", type: "blob" })) });
  const asCompare = (files) => ({ merge_base_commit: { sha: base }, files: files.map(({ entry, baseEntry, ...rest }) => rest) });
  const runs = { value: greenRuns() };
  const calls = [];
  const routes = (path) => {
    if (path === "/repos/o/r/branches/main") return { commit: { sha: base } };
    if (path.includes("/git/trees/")) return tree(["src/a.ts", "db/schema.sql", "db/migrations.sum", MIGRATION.filename]);
    if (path.endsWith(`/commits/${head}`)) return { sha: head, parents: [{ sha: middle }], files: regen(head).files };
    if (path.endsWith(`/commits/${middle}`)) return { sha: middle, parents: [{ sha: earlier }, { sha: mainParent }] };
    if (path.endsWith(`/commits/${earlier}`)) return { sha: earlier, parents: [{ sha: "0".repeat(40) }], files: [] };
    if (path.includes(`/compare/main...${mainParent}`)) return { status: "behind", files: [] };
    if (path.includes(`/compare/${base}...${head}`)) return asCompare(changed.files);
    if (path.includes(`/compare/${base}...${earlier}`)) return asCompare(earlierDiff.files);
    const named = /\/commits\/([0-9a-f]{40})\/check-runs\?check_name=([^&]+)&filter=all/.exec(path);
    const list = named && runs.value.filter((item) => item.name === decodeURIComponent(named[2]) && named[1] === head);
    if (list) return { total_count: list.length, check_runs: list };
    throw new Error(`unexpected ${path}`);
  };
  const fetchImpl = async (url) => {
    calls.push(url.replace("https://api.test", ""));
    const value = routes(calls.at(-1));
    return { ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) };
  };
  const api = createApi({ fetchImpl, baseUrl: "https://api.test", token: "t" });
  const pr = { head: { sha: head }, base: { sha: base, ref: "main" } };
  const comments = [review(earlier), qa(earlier)];
  const carried = await carriedHeads(api, "o", "r", pr, comments, { log: () => {} });
  assert.deepEqual([...carried.verdictOnly], [earlier]);
  assert.equal(evaluate(comments, carried).state, "success");
  assert.ok(calls.every((path) => !path.includes("/check-runs") || path.includes(`/commits/${head}/check-runs`)));
  // A later failed re-run of one shard takes the PASS away; the FAIL path stays.
  runs.value = [...greenRuns(), run(SCHEMA_CHECK_RUNS[2], "failure")];
  const red = await carriedHeads(api, "o", "r", pr, comments, { log: () => {} });
  assert.equal(red.verdictOnly.size, 0);
  assert.deepEqual([...red.heldNegatives], [earlier]);
  assert.equal(evaluate(comments, red).state, "pending");
});
