// ci-once: one look at the CI of a head. Pure core only; gh is never called.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ciOnce, ciOnceLines, EXIT, GATE_CONTEXTS, noWaitGh, runCiOnce } from "./ci-once-core.mjs";
import { prView } from "./gh.mjs";
import { requiredStatusChecks } from "./preflight-core.mjs";

const REQUIRED = ["Lint, typecheck, test and build", "Local stack (compose.yaml)", "Security scanners", "Dependency review"]
  .map((context) => ({ context, appId: 15368 }));
const run = (name, conclusion, extra = {}) => ({
  name, appId: 15368, status: conclusion ? "COMPLETED" : "IN_PROGRESS", conclusion: conclusion ?? "IN_PROGRESS",
  startedAt: "2026-10-31T20:00:00Z", ...extra,
});
const green = () => REQUIRED.map((r) => run(r.context, "SUCCESS"));
const gate = (context, state) => ({ context, state, startedAt: "2026-10-31T20:00:00Z" });

test("every required check green, gate statuses pending: green", () => {
  const rollup = [...green(), ...[...GATE_CONTEXTS].map((c) => gate(c, "PENDING"))];
  const r = ciOnce({ rollup, required: [...REQUIRED, { context: "Engineering review gate", appId: 15368 }] });
  assert.equal(r.verdict, "green");
  assert.equal(r.total, 4);
  assert.equal(EXIT[r.verdict], 0);
});

test("skipped and neutral checks are green", () => {
  const rollup = [...green(), run("Mergify Merge Queue", "SKIPPED", { appId: 10562 }), run("Mergify Merge Protections", "NEUTRAL", { appId: 10562 })];
  assert.equal(ciOnce({ rollup, required: REQUIRED }).verdict, "green");
});

test("a failed check is red and named, even while others still run", () => {
  const rollup = [...green().slice(1), run("Lint, typecheck, test and build", "FAILURE"), run("Standard E2E and database (1/3)", null)];
  const r = ciOnce({ rollup, required: REQUIRED });
  assert.equal(r.verdict, "red");
  assert.deepEqual(r.failed, ["Lint, typecheck, test and build=FAILURE"]);
  assert.equal(EXIT[r.verdict], 1);
  assert.match(ciOnceLines(7, "c".repeat(40), r)[0], /^CI RED #7 head cccccccc: Lint, typecheck, test and build=FAILURE$/);
});

test("cancelled, timed out, action required and unknown states are red, never green", () => {
  for (const state of ["CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE", "ERROR", "SOMETHING_NEW"]) {
    const r = ciOnce({ rollup: [...green(), run("Security extra", state)], required: REQUIRED });
    assert.equal(r.verdict, "red", state);
  }
  // A completed run without a conclusion is no green answer.
  const blank = { name: "Security extra", appId: 15368, status: "COMPLETED", conclusion: "", startedAt: "2026-10-31T20:00:00Z" };
  assert.equal(ciOnce({ rollup: [...green(), blank], required: REQUIRED }).verdict, "red");
});

test("a running check is running, and the line says to hand the work back", () => {
  const r = ciOnce({ rollup: [...green(), run("Login E2E (1/6)", null)], required: REQUIRED });
  assert.equal(r.verdict, "running");
  assert.equal(EXIT[r.verdict], 3);
  const lines = ciOnceLines(9, "d".repeat(40), r);
  assert.match(lines[0], /^CI RUNNING #9 head dddddddd: still running: Login E2E \(1\/6\)=IN_PROGRESS$/);
  assert.match(lines[1], /hand the work back/);
});

test("a required check not reported on the head is running, not green", () => {
  const r = ciOnce({ rollup: green().slice(1), required: REQUIRED });
  assert.equal(r.verdict, "running");
  assert.deepEqual(r.missing, ["Lint, typecheck, test and build (app 15368)"]);
});

test("a required check from another app does not count", () => {
  const rollup = [...green().slice(1), run("Lint, typecheck, test and build", "SUCCESS", { appId: 999 })];
  assert.equal(ciOnce({ rollup, required: REQUIRED }).verdict, "running");
});

test("the newest run of a re-run check decides", () => {
  const old = run("Security scanners", "FAILURE", { startedAt: "2026-10-31T19:00:00Z" });
  assert.equal(ciOnce({ rollup: [old, ...green()], required: REQUIRED }).verdict, "green");
});

test("a gate status never decides the verdict, whatever its state", () => {
  for (const state of ["FAILURE", "ERROR", "PENDING"]) {
    const rollup = [...green(), ...[...GATE_CONTEXTS].map((c) => gate(c, state))];
    assert.equal(ciOnce({ rollup, required: REQUIRED }).verdict, "green", state);
  }
});

test("unread checks or unread required checks throw instead of answering", () => {
  assert.throws(() => ciOnce({ rollup: null, required: REQUIRED }), /could not be read/);
  assert.throws(() => ciOnce({ rollup: green(), required: null }), /could not be read/);
  assert.throws(() => ciOnce({ rollup: green(), required: [] }), /could not be read/);
});

test("the script reads once and never loops or sleeps", () => {
  for (const file of ["./ci-once.mjs", "./ci-once-core.mjs"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(src, /setTimeout|setInterval|while\s*\(|for\s*\(\s*;|--watch/, file);
  }
  const cli = readFileSync(new URL("./ci-once.mjs", import.meta.url), "utf8");
  assert.match(cli, /runCiOnce\(/);
  assert.match(cli, /process\.exit\(result\.exit\)/);
  assert.match(readFileSync(new URL("./ci-once-core.mjs", import.meta.url), "utf8"), /exit: EXIT\[result\.verdict\]/);
});

// The CLI path with GitHub injected (#1081 review and QA1081-01, QA1081-02).
const A = "a".repeat(40);
const B = "b".repeat(40);
const PROTECTION = { checks: REQUIRED.map((r) => ({ context: r.context, app_id: r.appId })), contexts: REQUIRED.map((r) => r.context) };
function fakeGh({ heads, protection = PROTECTION, rollup = green() }) {
  let reads = 0;
  return {
    prView: async () => ({ headRefOid: heads[Math.min(reads++, heads.length - 1)] }),
    repoId: async () => ({ owner: "o", repo: "r" }),
    ghJson: async () => ({ protection: { required_status_checks: protection } }),
    checkRollup: async () => rollup,
  };
}
const cli = (opts, expectHead = A) => runCiOnce({ n: 5, expectHead, gh: fakeGh(opts), requiredOf: requiredStatusChecks });

test("green CLI read on a head that stays put exits 0", async () => {
  const r = await cli({ heads: [A, A] });
  assert.equal(r.exit, 0);
  assert.match(r.out[0], /^CI GREEN #5 head aaaaaaaa/);
});

test("a push during the read (head A to B) exits 2, never green for A", async () => {
  for (const expectHead of [A, null]) {
    const r = await cli({ heads: [A, B] }, expectHead);
    assert.equal(r.exit, 2, String(expectHead));
    assert.deepEqual(r.out, []);
    assert.match(r.err[0], /^CI HEAD MOVED #5: expected aaaaaaaa, PR is at bbbbbbbb$/);
  }
  assert.equal((await cli({ heads: [A, null] })).exit, 2);
});

test("a head other than --head before the read exits 2", async () => {
  assert.equal((await cli({ heads: [B, B] })).exit, 2);
});

test("a required check with an invalid context is a read error (exit 2), not a dropped check", async () => {
  for (const bad of [{ context: "", app_id: 15368 }, { context: 7, app_id: 15368 }, { app_id: 15368 }, null]) {
    const protection = { ...PROTECTION, checks: [...PROTECTION.checks.slice(0, 3), bad] };
    const r = await cli({ heads: [A, A], protection, rollup: green().slice(0, 3) });
    assert.equal(r.exit, 2, JSON.stringify(bad));
    assert.match(r.err[0], /required checks of main could not be read/);
  }
  const contexts = { ...PROTECTION, contexts: [...PROTECTION.contexts, ""] };
  assert.equal((await cli({ heads: [A, A], protection: contexts })).exit, 2);
  assert.equal((await cli({ heads: [A, A], protection: { ...PROTECTION, checks: {} } })).exit, 2);
});

// QA of #1081 (c.6557763346): with mergeability still unknown, gh.mjs prView
// waits and reads again. ci-once reads only the head, so through noWaitGh the
// real prView never waits, and the CLI hands that wrapper to runCiOnce.
test("the CLI's PR reads never wait while GitHub computes mergeability", async () => {
  let reads = 0;
  const json = async () => {
    reads += 1;
    return { number: 5, state: "open", head: { sha: A }, mergeable: null, user: {}, base: { ref: "main" } };
  };
  const gh = noWaitGh({ ...fakeGh({ heads: [A] }), prView: (n, opts) => prView(n, { ...opts, json }) });
  const started = Date.now();
  const r = await runCiOnce({ n: 5, expectHead: A, gh, requiredOf: requiredStatusChecks });
  assert.equal(r.exit, 0, r.err.join("\n"));
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
  assert.ok(reads <= 4, `${reads} reads`);
  // Every view goes out with waitMs 0, whatever the wrapped reader is.
  const seen = [];
  const recorded = noWaitGh({ ...fakeGh({ heads: [A] }), prView: async (n, opts) => (seen.push(opts), { headRefOid: A }) });
  await runCiOnce({ n: 5, expectHead: A, gh: recorded, requiredOf: requiredStatusChecks });
  assert.deepEqual(seen, [{ waitMs: 0 }, { waitMs: 0 }]);
  assert.match(readFileSync(new URL("./ci-once.mjs", import.meta.url), "utf8"), /gh: noWaitGh\(\{ prView,/);
});