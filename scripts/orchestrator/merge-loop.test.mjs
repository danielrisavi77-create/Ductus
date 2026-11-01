import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalBlock, field } from "../engineering/metadata-parser.mjs";
import { commandOnHead, parseArgs, patchId } from "./merge-loop.mjs";
import { commandProblem, EXIT, newMemory, ownerCommandText, step, unfilled, zagrebDate } from "./merge-loop-core.mjs";

const H1 = "1".repeat(40);
const H2 = "2".repeat(40);
const P = "a1b2c3".padEnd(40, "0");
const readiness = (state, checks = []) => ({ state, reason: `${state} reason`, checks });
const obs = (over = {}) => ({ state: "OPEN", head: H1, patchId: null, readiness: readiness("WAITS_OWNER"), commandOnHead: false, ...over });
const mem = (over = {}) => newMemory({ commandedHead: H1, commandedPatch: P, ...over });

test("the date is computed in Zagreb, in the repo's form", () => {
  assert.equal(zagrebDate(new Date("2026-11-01T10:00:00Z")), "1. 11. 2026.");
  // 23:30 UTC on 31 Oct is already 1 Nov in Zagreb (CET, UTC+1).
  assert.equal(zagrebDate(new Date("2026-10-31T23:30:00Z")), "1. 11. 2026.");
  assert.equal(zagrebDate(new Date("2027-03-01T00:00:00Z")), "1. 3. 2027.");
});

test("the Owner-Command text reads back the way the gate reads it, with the real date", () => {
  const text = ownerCommandText({ number: 1041, head: H1, commandedHead: H1, quote: "Spoji 1153, 1136, 1041,1157", date: zagrebDate(new Date("2026-11-01T10:00:00Z")) });
  assert.ok(canonicalBlock(text, "Owner-Command"));
  assert.equal(field(text, "Owner-Command"), "merge");
  assert.equal(field(text, "Command-Head"), H1);
  assert.match(text, /\(Daniel u sesiji orkestratora, 1\. 11\. 2026\.: "Spoji 1153, 1136, 1041,1157"\)\.\n$/);
  assert.equal(commandProblem(text, H1), null);
  const carried = ownerCommandText({ number: 1041, head: H2, commandedHead: H1, quote: "Spoji 1041", date: "1. 11. 2026." });
  assert.match(carried, /Naredba je dana na 11111111; .* D-156\./);
  assert.equal(commandProblem(carried, H2), null);
});

test("a text with an unfilled variable is refused, including the exact one from #1153", () => {
  const bad = `Owner-Command: merge\nCommand-Head: ${H1}\nSpoji #1153 na ovom headu (Daniel u sesiji orkestratora, \${QDATE:-1. 11. 2026.}: "Spoji 1153").\n`;
  assert.match(commandProblem(bad, H1), /unfilled variable.*\$\{/);
  for (const left of ["$(date)", "%s", "<datum>", "undefined", "NaN", "$QDATE", "[object Object]"]) {
    assert.ok(unfilled(`Spoji (${left})`), left);
    const text = ownerCommandText({ number: 1, head: H1, commandedHead: H1, quote: "Spoji 1", date: left });
    assert.match(commandProblem(text, H1), /unfilled/, left);
  }
  assert.equal(unfilled('Spoji #1041 na ovom headu (Daniel, 1. 11. 2026.: "Spoji 1041").'), null);
});

test("a text that does not name this head as Owner-Command: merge is refused", () => {
  const text = ownerCommandText({ number: 1, head: H1, commandedHead: H1, quote: "Spoji 1", date: "1. 11. 2026." });
  assert.match(commandProblem(text, H2), /does not read back/);
  assert.match(commandProblem(text.replace("merge", "merg"), H1), /does not read back/);
  assert.match(commandProblem(`x\n${text}`, H1), /does not read back/, "the block must come first");
  assert.match(commandProblem(text, "abc"), /full SHA/);
});

test("MERGED, closed and an unreadable head each end with their own code", () => {
  assert.equal(step(mem(), obs({ state: "MERGED" })).code, EXIT.MERGED);
  assert.equal(step(mem(), obs({ state: "CLOSED" })).code, EXIT.FAIL);
  assert.equal(step(mem(), obs({ head: null })).code, EXIT.FAIL);
});

test("the owner command is posted once per head, also when the PR already has it", () => {
  const m = mem();
  assert.equal(step(m, obs()).action, "post-command");
  m.posted.add(H1);
  assert.equal(step(m, obs()).action, "wait", "not twice for the same head");
  assert.equal(step(mem(), obs({ commandOnHead: true })).action, "wait", "an earlier run already posted it");
  // A new head with the same patch-id gets its own command.
  assert.equal(step(m, obs({ head: H2, patchId: P })).action, "post-command");
});

test("queue once per head when Merge authorization passes", () => {
  const m = mem();
  assert.equal(step(m, obs({ readiness: readiness("READY") })).action, "queue");
  m.queued.add(H1);
  assert.equal(step(m, obs({ readiness: readiness("READY") })).action, "wait");
  assert.equal(step(m, obs({ head: H2, patchId: P, readiness: readiness("READY") })).action, "queue");
});

test("a changed patch-id voids the command; an unreadable one never passes as the same", () => {
  const changed = step(mem(), obs({ head: H2, patchId: "other".padEnd(40, "0") }));
  assert.equal(changed.code, EXIT.PATCH);
  assert.match(changed.reason, /void \(D-156\)/);
  assert.equal(step(mem(), obs({ head: H2, patchId: null })).code, EXIT.FAIL);
});

test("BLOK for a thread or another GitHub block, FAIL for red CI or gate, each with the reason", () => {
  const thread = step(mem(), obs({ readiness: { state: "BLOCKED", reason: "1 unresolved review thread(s)", checks: [{ level: "FAIL", id: "threads" }] } }));
  assert.equal(thread.code, EXIT.BLOK);
  assert.match(thread.reason, /^BLOK: 1 unresolved review thread/);
  const hidden = step(mem(), obs({ readiness: { state: "BLOCKED", reason: "GitHub blocks the merge", checks: [{ level: "FAIL", id: "merge-state" }] } }));
  assert.equal(hidden.code, EXIT.BLOK);
  for (const id of ["ci", "gate", "authorization"]) {
    const red = step(mem(), obs({ readiness: { state: "BLOCKED", reason: `${id} red`, checks: [{ level: "FAIL", id }] } }));
    assert.equal(red.code, EXIT.FAIL, id);
  }
});

test("waiting is bounded: TIMEOUT after maxRounds, and too many head changes stop it", () => {
  const m = mem({ maxRounds: 3 });
  assert.equal(step(m, obs({ readiness: readiness("WAITING") })).action, "wait");
  assert.equal(step(m, obs({ readiness: readiness("UNREAD") })).action, "wait");
  const out = step(m, obs({ readiness: readiness("WAITING") }));
  assert.equal(out.code, EXIT.TIMEOUT);
  assert.match(out.reason, /TIMEOUT after 3 rounds: WAITING/);
  const heads = mem({ maxHeads: 2 });
  assert.equal(step(heads, obs({ head: H2, patchId: P, readiness: readiness("WAITING") })).action, "wait");
  assert.equal(step(heads, obs({ head: "3".repeat(40), patchId: P, readiness: readiness("WAITING") })).code, EXIT.HEADS);
});

test("CLI: arguments are a PR number, a full commanded head and the owner's words", () => {
  assert.deepEqual(parseArgs(["1041", H1, "Spoji 1041"]), { n: 1041, head: H1, quote: "Spoji 1041", rounds: 75, interval: 120, dryRun: false });
  assert.equal(parseArgs(["1041", H1, "Spoji 1041", "--rounds", "3", "--interval", "0", "--dry-run"]).rounds, 3);
  for (const bad of [[], ["x", H1, "q"], ["1041", "abc", "q"], ["1041", H1, " "], ["1041", H1, "q", "--rounds", "0"], ["1041", H1, "q", "--force"]]) {
    assert.equal(parseArgs(bad), null, JSON.stringify(bad));
  }
});

test("CLI: an earlier Owner-Command counts only from the owner, for this exact head, not through an App", () => {
  const text = ownerCommandText({ number: 1, head: H1, commandedHead: H1, quote: "Spoji 1", date: "1. 11. 2026." });
  const c = (over) => ({ body: text, author_association: "OWNER", performed_via_github_app: null, ...over });
  assert.equal(commandOnHead([c()], H1), true);
  assert.equal(commandOnHead([c()], H2), false);
  assert.equal(commandOnHead([c({ author_association: "MEMBER" })], H1), false);
  assert.equal(commandOnHead([c({ performed_via_github_app: { slug: "claude" } })], H1), false);
  assert.equal(commandOnHead([c({ body: `note\n${text}` })], H1), false);
});

test("CLI: patch-id is git diff merge-base..head through git patch-id --stable; any failure is null", () => {
  const calls = [];
  const run = (args, input) => {
    calls.push([args[0], input ?? null]);
    if (args[0] === "merge-base") return `${H2}\n`;
    if (args[0] === "diff") return "diff --git a/x b/x\n";
    if (args[0] === "patch-id") return `${P} ${H1}\n`;
    return "";
  };
  assert.equal(patchId(1041, H1, run), P);
  assert.deepEqual(calls.map(([a]) => a), ["fetch", "merge-base", "diff", "patch-id"]);
  assert.equal(calls[3][1], "diff --git a/x b/x\n", "the diff is piped into patch-id");
  assert.equal(patchId(1041, H1, () => { throw new Error("fetch failed"); }), null);
  assert.equal(patchId(1041, H1, (args) => (args[0] === "patch-id" ? "" : `${H2}\n`)), null, "an empty diff has no patch-id");
});

test("every exit code is distinct", () => {
  assert.equal(new Set(Object.values(EXIT)).size, Object.keys(EXIT).length);
});
