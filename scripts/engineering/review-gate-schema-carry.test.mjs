// D-293 (#87 c.6858156704 point 2): review and QA PASS carry over a base conflict resolution that changed only
// db/schema.sql and db/migrations.sum when the rest of the diff is identical and the D-91 checks are green on the
// new head; a FAIL carries as before. Every input class from the contract (#1836 c.6858312517) is a table row.
// F-299/F-300 (DAN-865, contract #1836 c.6914873597): stricter carry-over through a regenerated schema.
import test from "node:test";
import assert from "node:assert/strict";

import {
  SCHEMA_CHECK_RUNS,
  carriedByCompare,
  carriedHeadCandidates,
  evaluateGate,
  evaluateMergeAuthorization,
  onlyBaseMerges,
  regenAfterMigrationMerge,
  regenEffect,
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
// A base merge moves the hunks and their context; the PR's own added and removed lines stay (F-299).
const regenerated = (base) => ({ ...base, patch: `@@ -9,2 +9,3 @@ main\n main\n${base.patch.split("\n").slice(1).join("\n")}` });
const earlierDiff = { files: [APP, MIGRATION, SCHEMA, SUM] };

const merge = (sha) => ({ sha, parents: [{}, {}], mergesBase: true });
// F-300: a base merge that brought in a migration, as GET commits/{sha} lists it against the first parent.
const migrationMerge = (sha) => ({ ...merge(sha), files: [{ filename: "db/migrations/20261112000000_main.sql", status: "added" }] });
const plain = (sha) => ({ sha, parents: [{}], files: [{ filename: "src/a.ts", status: "modified" }] });
const regenFiles = [{ filename: "db/schema.sql", status: "modified" }, { filename: "db/migrations.sum", status: "modified" }];
const regen = (sha, files = regenFiles) => ({ sha, parents: [{}], files });

const run = (name, conclusion = "success", extra = {}) => ({
  ...{ id: counter++, name, head_sha: head, status: conclusion ? "completed" : "in_progress", conclusion },
  ...{ app: { slug: "github-actions" }, ...extra },
});
const greenRuns = (sha = head) => SCHEMA_CHECK_RUNS.map((name) => run(name, "success", { head_sha: sha }));

test("compare classes: only the two regenerated files may differ", () => {
  const rows = [
    ["schema and ledger regenerated", [APP, MIGRATION, regenerated(SCHEMA), regenerated(SUM)], true],
    ["only the schema regenerated", [APP, MIGRATION, regenerated(SCHEMA), SUM], true],
    // F-299: without a patch the regenerated content cannot be compared.
    ["regenerated file too large for a patch", [APP, MIGRATION, { ...SCHEMA, patch: undefined }, SUM], false],
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
  // A compare at the 300-file cap may be truncated, even when the two files are set aside.
  const capped = (diff) => [...diff, ...Array.from({ length: 300 - diff.length }, (_, i) => file(`src/f${i}.ts`))];
  assert.equal(sameChangeOutsideSchema({ files: capped([APP, MIGRATION, regenerated(SCHEMA), SUM]) }, { files: capped(earlierDiff.files) }), false);
  assert.equal(sameChangeOutsideSchema({ files: capped([APP, MIGRATION, regenerated(SCHEMA), SUM]).slice(1) }, { files: capped(earlierDiff.files).slice(1) }), true);
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

// F-299: the regenerated files' own added and removed lines are compared. Hunk positions and context are not,
// and in db/schema.sql neither is the trailing run of schema_migrations version rows.
const lines = (...rows) => rows.join("\n");
const MIGRATIONS_ROW = "INSERT INTO public.schema_migrations (version) VALUES";
const schemaPatch = (body, tail) => lines("@@ -40,2 +40,3 @@ CREATE TABLE a", " CREATE TABLE a ();", ...body, " ", "@@ -900,2 +901,3 @@ INSERT INTO public.schema_migrations (version) VALUES", ...tail);
const tailAfter = (last, added = "20261116000000") => [`     ('20261113000000'),`, `-    ('${last}');`, `+    ('${last}'),`, `+    ('${added}');`];
const EFFECT = ["+CREATE TABLE x ();"];
const SCHEMA_EARLIER = file("db/schema.sql", schemaPatch(EFFECT, tailAfter("20261114100000")));
const SCHEMA_MOVED = file("db/schema.sql", schemaPatch(EFFECT, tailAfter("20261115000000")).replace("@@ -40,2 +40,3 @@", "@@ -52,2 +52,3 @@"));
const effectDiff = (schema, sum = SUM) => ({ files: [APP, MIGRATION, schema, sum] });

test("effect classes: the regenerated files must add and remove the same lines on both heads", () => {
  const withSchema = (patch) => file("db/schema.sql", patch);
  const rows = [
    ["hunks and context moved", effectDiff(SCHEMA_MOVED), true],
    ["only the trailing version rows differ", effectDiff(withSchema(schemaPatch(EFFECT, tailAfter("20261115000000")))), true],
    ["an added line differs", effectDiff(withSchema(schemaPatch(["+CREATE TABLE x (id int);"], tailAfter("20261114100000")))), false],
    ["an extra removed line", effectDiff(withSchema(schemaPatch([...EFFECT, "-CREATE TABLE b ();"], tailAfter("20261114100000")))), false],
    ["a line dropped", effectDiff(withSchema(schemaPatch([], tailAfter("20261114100000")))), false],
    ["the same lines in another order", effectDiff(withSchema(schemaPatch(["+CREATE TABLE y ();", ...EFFECT], tailAfter("20261114100000")))), false],
    ["a version-shaped row outside the trailing run", effectDiff(withSchema(schemaPatch([...EFFECT, "+    ('20261101000000'),"], tailAfter("20261114100000")))), false],
    ["the trailing run ends in another line", effectDiff(withSchema(`${SCHEMA_MOVED.patch}\n+-- end`)), false],
    ["no newline marker only", effectDiff(withSchema(`${SCHEMA_MOVED.patch}\n\\ No newline at end of file`)), true],
    ["patch missing on the current head", effectDiff({ ...SCHEMA_EARLIER, patch: undefined }), false],
    ["patch empty on the current head", effectDiff({ ...SCHEMA_EARLIER, patch: "" }), false],
    ["schema unchanged on the current head", { files: [APP, MIGRATION, SUM] }, false],
    ["schema listed twice", { files: [APP, MIGRATION, SCHEMA_MOVED, SCHEMA_MOVED, SUM] }, false],
    ["ledger context moved", effectDiff(SCHEMA_MOVED, file("db/migrations.sum", "@@ -90,2 +90,3 @@\n a\n+x")), true],
    ["ledger line differs", effectDiff(SCHEMA_MOVED, file("db/migrations.sum", "@@ -1 +1,2 @@\n a\n+y")), false],
    ["ledger version-shaped row is compared", effectDiff(SCHEMA_MOVED, file("db/migrations.sum", "@@ -1 +1,2 @@\n a\n+x\n+    ('20261116000000');")), false],
    ["ledger patch missing", effectDiff(SCHEMA_MOVED, { ...SUM, patch: undefined }), false],
  ];
  for (const [name, current, expected] of rows) assert.equal(sameChangeOutsideSchema(current, effectDiff(SCHEMA_EARLIER)), expected, name);
  // A run that does not end the patch is compared like any other line.
  const ended = (schema) => effectDiff(file("db/schema.sql", `${schema.patch}\n+-- end`));
  assert.equal(sameChangeOutsideSchema(ended(SCHEMA_EARLIER), ended(SCHEMA_EARLIER)), true);
  assert.equal(sameChangeOutsideSchema(ended(SCHEMA_MOVED), ended(SCHEMA_EARLIER)), false);
  // Missing or one-sided on the earlier head as well.
  assert.equal(sameChangeOutsideSchema(effectDiff(SCHEMA_MOVED), effectDiff({ ...SCHEMA_EARLIER, patch: undefined })), false);
  assert.equal(sameChangeOutsideSchema(effectDiff({ ...SCHEMA_MOVED, patch: null }), effectDiff({ ...SCHEMA_EARLIER, patch: null })), false);
  assert.equal(sameChangeOutsideSchema(effectDiff({ ...SCHEMA_MOVED, patch: "" }), effectDiff({ ...SCHEMA_EARLIER, patch: "" })), false);
  assert.equal(sameChangeOutsideSchema(effectDiff(SCHEMA_MOVED), { files: [APP, MIGRATION, SUM] }), false);
  // Neither head touches either file: the rest decides.
  assert.equal(sameChangeOutsideSchema({ files: [APP, MIGRATION] }, { files: [APP, MIGRATION] }), true);
});

test("regenEffect keeps only added and removed lines", () => {
  const rows = [
    ["no file", null, null],
    ["no patch", { filename: "db/schema.sql" }, null],
    ["patch not a string", { filename: "db/schema.sql", patch: 1 }, null],
    ["empty patch", { filename: "db/schema.sql", patch: "" }, null],
    ["context and positions dropped", { filename: "db/migrations.sum", patch: "@@ -1 +1,2 @@\n a\n+x\n-y" }, ["+x", "-y"]],
    ["schema trailing versions dropped", SCHEMA_MOVED, EFFECT],
    ["only versions", { filename: "db/schema.sql", patch: lines(`@@ -1 +1,2 @@ ${MIGRATIONS_ROW}`, "-    ('20261114100000');", "+    ('20261114100000'),", "+    ('20261116000000');") }, []],
    ["versions in an earlier hunk kept", { filename: "db/schema.sql", patch: lines("@@ -1 +1 @@", "+    ('20261116000000'),", "@@ -9 +9 @@", "+x") }, ["+    ('20261116000000'),", "+x"]],
    ["only the last hunk's run dropped", { filename: "db/schema.sql", patch: lines("@@ -1 +1 @@", "+    ('20261101000000'),", `@@ -9 +9,2 @@ ${MIGRATIONS_ROW}`, "     ('20261113000000'),", "+    ('20261116000000');") }, ["+    ('20261101000000'),"]],
    ["versions between context rows dropped", { filename: "db/schema.sql", patch: lines(`@@ -9,3 +9,4 @@ ${MIGRATIONS_ROW}`, "     ('20261101000000'),", "+    ('20261105000000'),", "     ('20261110000000'),", "-    ('20261113000000');", "+    ('20261113000000'),", "+    ('20261116000000');") }, []],
    ["a changed statement line ends the run", { filename: "db/schema.sql", patch: lines(`@@ -9 +9,2 @@ ${MIGRATIONS_ROW}`, "+    ('20261116000000'),", "+    ('x');") }, ["+    ('20261116000000'),", "+    ('x');"]],
    ["the insert line as context", { filename: "db/schema.sql", patch: lines("@@ -1 +1,2 @@ CREATE TABLE z", ` ${MIGRATIONS_ROW}`, "+    ('20261116000000');") }, []],
    ["versions after another statement kept", { filename: "db/schema.sql", patch: lines("@@ -1 +1 @@ CREATE FUNCTION f()", "+    ('20261116000000');") }, ["+    ('20261116000000');"]],
    ["versions after a later statement kept", { filename: "db/schema.sql", patch: lines(`@@ -1 +1,3 @@ ${MIGRATIONS_ROW}`, " CREATE FUNCTION f()", "+    ('20261116000000');") }, ["+    ('20261116000000');"]],
    ["the insert line only added", { filename: "db/schema.sql", patch: lines("@@ -1 +1,2 @@", `+${MIGRATIONS_ROW}`, "+    ('20261116000000');") }, [`+${MIGRATIONS_ROW}`, "+    ('20261116000000');"]],
    ["ledger keeps version-shaped rows", { filename: "db/migrations.sum", patch: "@@ -1 +1 @@\n+    ('20261116000000');" }, ["+    ('20261116000000');"]],
    ["short version kept", { filename: "db/schema.sql", patch: "@@ -1 +1 @@\n+    ('2026111600000');" }, ["+    ('2026111600000');"]],
    ["version with a tail kept", { filename: "db/schema.sql", patch: "@@ -1 +1 @@\n+    ('20261116000000'); DROP" }, ["+    ('20261116000000'); DROP"]],
  ];
  for (const [name, input, expected] of rows) assert.deepEqual(regenEffect(input), expected, name);
});

// F-300: a regeneration commit carries only when a base merge that brought in db/migrations/ changes lies before it.
test("order classes: a regeneration commit must follow a base merge that brought migrations", () => {
  const d = "d".repeat(40);
  const rows = [
    ["migration merge before the regeneration", [regen(head), migrationMerge(middle), plain(earlier)], true],
    ["two regenerations after one migration merge", [regen(head), regen(d), migrationMerge(middle), plain(earlier)], true],
    ["no regeneration commit", [merge(head), plain(earlier)], true],
    ["regeneration with no merge", [regen(head), plain(earlier)], false],
    ["merge brought no migration", [regen(head), merge(middle), plain(earlier)], false],
    ["merge files empty", [regen(head), { ...merge(middle), files: [] }, plain(earlier)], false],
    ["merge brought only the ledger", [regen(head), { ...merge(middle), files: [{ filename: "db/migrations.sum" }] }, plain(earlier)], false],
    ["merge brought only a note", [regen(head), { ...merge(middle), files: [{ filename: "db/migrations/README.md", status: "added" }] }, plain(earlier)], false],
    ["merge only removed a migration", [regen(head), { ...merge(middle), files: [{ ...migrationMerge(middle).files[0], status: "removed" }] }, plain(earlier)], false],
    ["merge only edited a migration", [regen(head), { ...merge(middle), files: [{ ...migrationMerge(middle).files[0], status: "modified" }] }, plain(earlier)], false],
    ["merge added a nested file", [regen(head), { ...merge(middle), files: [{ filename: "db/migrations/x/1.sql", status: "added" }] }, plain(earlier)], false],
    ["migration merge only after the regeneration", [migrationMerge(head), regen(middle), plain(earlier)], false],
    ["a later regeneration with nothing before it", [regen(head), migrationMerge(middle), regen(d), plain(earlier)], false],
    ["migration merge not from the base", [regen(head), { ...migrationMerge(middle), mergesBase: false }, plain(earlier)], false],
    ["migration merge with three parents", [regen(head), { ...migrationMerge(middle), parents: [{}, {}, {}] }, plain(earlier)], false],
    ["migration merge beyond the earlier head", [regen(head), plain(earlier), migrationMerge(middle)], false],
    ["earlier head not reached", [regen(head), migrationMerge(middle)], false],
    ["earlier head is the current head", [plain(earlier)], false],
    ["no path", null, false],
  ];
  for (const [name, path, expected] of rows) assert.equal(regenAfterMigrationMerge(path, earlier), expected, name);
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
  const separate = await schemaCarry(true, [regen(head), migrationMerge(middle), plain(earlier)]);
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

test("the D-91 checks must have been green on the earlier head too", async () => {
  const asked = [];
  const greenAt = (earlierGreen, currentGreen = true) => async (sha) => {
    asked.push(sha);
    if (sha === undefined) return currentGreen;
    if (earlierGreen === "throws") throw new Error("check-runs 500");
    return earlierGreen;
  };
  const both = await carryWith(changed, greenAt(true));
  assert.deepEqual([...both.verdictOnly], [earlier]);
  assert.ok(asked.includes(earlier));
  for (const [name, earlierGreen, currentGreen] of [
    ["earlier head red", false, true],
    ["earlier head not read", "throws", true],
    ["earlier head not a boolean", "yes", true],
    ["current head red", true, false],
  ]) {
    const carried = await carryWith(changed, greenAt(earlierGreen, currentGreen));
    assert.equal(carried.verdictOnly.size, 0, name);
    assert.deepEqual([...carried.heldNegatives], [earlier], name);
    assert.equal(evaluate([review(earlier), qa(earlier)], carried).state, "pending", name);
    assert.match(evaluate([review(earlier, "FAIL"), qa(earlier)], carried).description, /fail/i, name);
  }
});

test("a regeneration commit without a migration merge before it carries no PASS, but a FAIL still blocks", async () => {
  for (const path of [
    [regen(head), plain(earlier)],
    [regen(head), merge(middle), plain(earlier)],
    [migrationMerge(head), regen(middle), plain(earlier)],
  ]) {
    const carried = await schemaCarry(true, path);
    assert.equal(carried.verdictOnly.size, 0);
    assert.deepEqual([...carried.heldNegatives], [earlier]);
    assert.equal(evaluate([review(earlier), qa(earlier)], carried).state, "pending");
    assert.match(evaluate([review(earlier, "FAIL"), qa(earlier)], carried).description, /fail/i);
  }
  const ordered = await schemaCarry(true, [regen(head), migrationMerge(middle), plain(earlier)]);
  assert.deepEqual([...ordered.verdictOnly], [earlier]);
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

// The runner: walk and compares are anchored on pr.head.sha; check-runs are read on it and on the earlier head.
test("the runner reads the D-91 checks on both heads and carries the PASS", async () => {
  const [base, mainParent] = ["e".repeat(40), "f".repeat(40)];
  const tree = (paths) => ({ truncated: false, tree: paths.map((path) => ({ path, mode: "100644", type: "blob" })) });
  const asCompare = (files) => ({ merge_base_commit: { sha: base }, files: files.map(({ entry, baseEntry, ...rest }) => rest) });
  const runs = { value: greenRuns(), earlier: greenRuns(earlier), hidden: 0 };
  const calls = [];
  const routes = (path) => {
    if (path === "/repos/o/r/branches/main") return { commit: { sha: base } };
    if (path.includes("/git/trees/")) return tree(["src/a.ts", "db/schema.sql", "db/migrations.sum", MIGRATION.filename]);
    if (path.endsWith(`/commits/${head}`)) return { sha: head, parents: [{ sha: middle }], files: regen(head).files };
    if (path.endsWith(`/commits/${middle}`)) return { sha: middle, parents: [{ sha: earlier }, { sha: mainParent }], files: migrationMerge(middle).files };
    if (path.endsWith(`/commits/${earlier}`)) return { sha: earlier, parents: [{ sha: "0".repeat(40) }], files: [] };
    if (path.includes(`/compare/main...${mainParent}`)) return { status: "behind", files: [] };
    if (path.includes(`/compare/${base}...${head}`)) return asCompare(changed.files);
    if (path.includes(`/compare/${base}...${earlier}`)) return asCompare(earlierDiff.files);
    const named = /\/commits\/([0-9a-f]{40})\/check-runs\?check_name=([^&]+)&filter=all/.exec(path);
    const listed = named && { [head]: runs.value, [earlier]: runs.earlier }[named[1]];
    const list = listed && listed.filter((item) => item.name === decodeURIComponent(named[2]));
    if (list) return { total_count: list.length + runs.hidden, check_runs: list };
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
  const checked = calls.filter((path) => path.includes("/check-runs"));
  assert.ok(checked.every((path) => path.includes(`/commits/${head}/check-runs`) || path.includes(`/commits/${earlier}/check-runs`)));
  assert.ok(checked.some((path) => path.includes(`/commits/${earlier}/check-runs`)));
  // Red on the earlier head: no PASS carries, the FAIL path stays.
  runs.earlier = [...greenRuns(earlier), run(SCHEMA_CHECK_RUNS[1], "failure", { head_sha: earlier })];
  const earlierRed = await carriedHeads(api, "o", "r", pr, comments, { log: () => {} });
  assert.equal(earlierRed.verdictOnly.size, 0);
  assert.deepEqual([...earlierRed.heldNegatives], [earlier]);
  // Missing or still running on the earlier head: no PASS carries either.
  for (const pending of [[], greenRuns(earlier).map((item, index) => (index === 0 ? run(item.name, null, { head_sha: earlier }) : item))]) {
    runs.earlier = pending;
    const notGreen = await carriedHeads(api, "o", "r", pr, comments, { log: () => {} });
    assert.equal(notGreen.verdictOnly.size, 0);
    assert.deepEqual([...notGreen.heldNegatives], [earlier]);
  }
  runs.earlier = greenRuns(earlier);
  // A later failed re-run of one shard takes the PASS away; the FAIL path stays.
  runs.value = [...greenRuns(), run(SCHEMA_CHECK_RUNS[2], "failure")];
  const red = await carriedHeads(api, "o", "r", pr, comments, { log: () => {} });
  assert.equal(red.verdictOnly.size, 0);
  assert.deepEqual([...red.heldNegatives], [earlier]);
  assert.equal(evaluate(comments, red).state, "pending");
  // More runs than one page holds: the newest may be unseen, so nothing carries.
  Object.assign(runs, { value: greenRuns(), hidden: 1 });
  assert.equal((await carriedHeads(api, "o", "r", pr, comments, { log: () => {} })).verdictOnly?.size ?? 0, 0);
});
