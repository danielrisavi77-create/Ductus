import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

// Guards the CI step that runs the node:test suites (attack plan #195).
// A node --test glob that matches nothing exits 0, so the step must fail on
// an empty glob (failglob), keep its job and step names (branch protection
// requires the job name) and must not be skippable.
const ciPath = new URL("../../.github/workflows/ci.yml", import.meta.url);
const orchestratorDir = new URL("../orchestrator/", import.meta.url);

const JOB_NAME = "Lint, typecheck, test and build";
const STEP_NAME = "Engineering system unit tests";

// Whole job block: from the job key to the next job key (2-space indent) or a
// top-level key. YAML does not fix key order, so a job-level `if:` or
// `continue-on-error` may sit before `name:`, between `name:` and `steps:` or
// after the `steps:` block; each would skip or soften every step of the job.
function jobBlock(ci) {
  const nameAt = ci.indexOf(`    name: ${JOB_NAME}\n`);
  assert.ok(nameAt >= 0, "the required job must keep its name");
  // Start at the job key (2-space indent) above the name, so keys written
  // before `name:` are part of the block too.
  const keyAt = ci.slice(0, nameAt).search(/\n {2}[\w-]+:\n(?: {4}.*\n)*$/);
  assert.ok(keyAt >= 0, "name belongs to a job key");
  const job = ci.slice(keyAt + 1);
  const firstLineEnd = job.indexOf("\n");
  const rest = job.slice(firstLineEnd);
  const end = rest.search(/\n(?: {2}["']?[\w-]+["']?\s*:|[^\s#])/);
  const block = job.slice(0, firstLineEnd + (end < 0 ? rest.length : end));
  assert.match(block, /^ {4}steps:$/m, "the required job has steps");
  return block;
}

// Job-level keys sit at exactly 4 spaces; step-level `if:` lines are deeper.
// Quoted keys ("if": false) are the same key to YAML.
const JOB_IF = /^ {4}["']?if["']?\s*:/m;
const JOB_CONTINUE = /^ {4}["']?continue-on-error["']?\s*:/m;

function assertJobNotSkippable(ci) {
  const block = jobBlock(ci);
  assert.doesNotMatch(block, JOB_IF, "required job must not have a job-level if");
  assert.doesNotMatch(block, JOB_CONTINUE, "required job must not be non-blocking");
}

async function stepBlock() {
  const ci = await readFile(ciPath, "utf8");
  const nameAt = ci.indexOf(`    name: ${JOB_NAME}\n`);
  assert.ok(nameAt >= 0, "the required job must keep its name");
  // The job block runs from its key (2-space indent) to the next job key.
  const prevLine = ci.slice(0, nameAt - 1).split("\n").pop();
  assert.match(prevLine, /^ {2}[\w-]+:$/, "name belongs to a job key");
  const after = ci.slice(nameAt);
  const nextJob = after.search(/\n {2}[\w-]+:\n/);
  const job = after.slice(0, nextJob < 0 ? undefined : nextJob);
  const start = job.indexOf(`      - name: ${STEP_NAME}\n`);
  assert.ok(start >= 0, "the step must keep its name and stay inside the required job");
  const rest = job.slice(start + 1);
  const next = rest.search(/\n {6}- /);
  return rest.slice(0, next < 0 ? undefined : next);
}

test("CI node:test step fails on an empty glob and covers both suites", async () => {
  const step = await stepBlock();
  const run = step.match(/^ {8}run: (.+)$/m)?.[1];
  assert.ok(run, "step has a one-line run command");
  // Exact form: any extra flag (--test-only, --test-name-pattern, --test-shard,
  // --test-skip-pattern) or shell operator would change what runs.
  assert.equal(
    run,
    "shopt -s failglob; node --test scripts/engineering/*.test.mjs scripts/orchestrator/*.test.mjs",
  );
});

test("CI node:test step cannot be skipped or made non-blocking", async () => {
  const step = await stepBlock();
  assert.doesNotMatch(step, /^ {8}if:/m);
  assert.doesNotMatch(step, /continue-on-error/);
  assert.doesNotMatch(step, /working-directory/);
  assert.doesNotMatch(step, /shell:/);
});

test("the required job itself cannot be skipped or made non-blocking (#195 item 4)", async () => {
  const ci = await readFile(ciPath, "utf8");
  assertJobNotSkippable(ci);
  // The guard must catch each job-level weakening (checked on in-memory copies).
  const header = `    name: ${JOB_NAME}\n`;
  // End of the required job: the line before the next job key.
  const nameAt = ci.indexOf(header);
  const nextJob = nameAt + ci.slice(nameAt).search(/\n {2}[\w-]+:\n/) + 1;
  assert.ok(nextJob > nameAt, "the required job is followed by another job");
  const extras = [
    "    if: github.event_name == 'push'\n",
    "    continue-on-error: true\n",
    '    "if": false\n',
    "    'continue-on-error': true\n",
    "    if : false\n",
  ];
  for (const extra of extras) {
    const placements = {
      "after name": ci.replace(header, header + extra),
      "before name": ci.replace(header, extra + header),
      "after steps": ci.slice(0, nextJob) + extra + ci.slice(nextJob),
    };
    for (const [where, weakened] of Object.entries(placements)) {
      assert.notEqual(weakened, ci);
      assert.throws(() => assertJobNotSkippable(weakened), `${extra.trim()} ${where}`);
    }
  }
  // Control: a step-level `if:` inside the job (deeper indent) and a job-level
  // `if:` in another job are not the required job's own keys.
  const stepIf = ci.slice(0, nextJob) + "      - if: false\n        run: true\n" + ci.slice(nextJob);
  assert.doesNotThrow(() => assertJobNotSkippable(stepIf));
  const otherJob = ci.slice(0, nextJob) + ci.slice(nextJob).replace(/\n {4}name: /, "\n    if: false\n    name: ");
  assert.notEqual(otherJob, ci);
  assert.doesNotThrow(() => assertJobNotSkippable(otherJob));
});

// F-035 c: the gate's own tests (scripts/engineering) and the hook tests
// (scripts/hooks) get the same scan. The only marker allowed there is a
// runtime skip call of the test context for a platform that cannot run the case, and the
// guard must decide that very call, not merely stand nearby (Codex on #1110):
// either the skip is the body of `if (process.platform !== "linux")` on its
// own line, or the line right above ends every other way out, by throwing
// unless the platform is Windows or by asserting that CI is not the caller.
// The CI runner is Linux, so such a marker never fires there. An option key
// is caught also when the object spans lines (`{\n  skip: true,`) and when
// the key is quoted. The Windows guard may add only one `|| name !== "value"`
// term: with `||` the throw still fires whenever the platform is not Windows.
const MARKERS = ["skip", "todo", "only"].join("|");
const MARKED = new RegExp(
  `\\b(?:test|describe|it|t)\\.(?:${MARKERS})\\b|(?:[{,]|^)\\s*(["'\`]?)(?:${MARKERS})\\1\\s*:`,
);
const SKIP_CALL = `(?:return )?t\\.${"skip"}\\("[^"]*"\\);?\\s*$`;
const GUARDED_ON_LINE = new RegExp(`^\\s*if \\(process\\.platform !== "linux"\\) ${SKIP_CALL}`);
const BARE_SKIP = new RegExp(`^\\s*${SKIP_CALL}`);
const GUARD_ABOVE =
  /^\s*(?:if \(process\.platform !== "win32"(?: \|\| [\w.]+ !== "[^"]*")?\) throw [\w.]+;|if \(process\.platform !== "win32"\) throw new Error\("[^"]*"\);|assert\.ok\(!IN_CI, "[^"]*"\);)\s*$/;
export function unguardedMarkers(src) {
  const lines = src.split("\n");
  const out = [];
  lines.forEach((line, i) => {
    if (!MARKED.test(line)) return;
    const guarded = GUARDED_ON_LINE.test(line) || (BARE_SKIP.test(line) && i > 0 && GUARD_ABOVE.test(lines[i - 1]));
    if (!guarded) out.push(`${i + 1}: ${line.trim()}`);
  });
  return out;
}

test("engineering and hook tests carry no marker that turns a case off, except a guarded platform one", async () => {
  let scanned = 0;
  for (const dir of [new URL("./", import.meta.url), new URL("../hooks/", import.meta.url)]) {
    for (const name of (await readdir(dir)).filter((n) => n.endsWith(".test.mjs"))) {
      scanned += 1;
      assert.deepEqual(unguardedMarkers(await readFile(new URL(name, dir), "utf8")), [], name);
    }
  }
  assert.ok(scanned > 20, "the scan reads the directories");
  // The scanner itself: each of these must be caught (built from parts, so
  // this file holds no marker of its own).
  const call = (who, kind, rest) => `${who}.${kind}(${rest});`;
  for (const bad of [
    call("test", "skip", '"x", () => {}'),
    call("describe", "only", '"x", () => {}'),
    call("it", "todo", '"x"'),
    `test("x", { ${"skip"}: true }, () => {});`,
    `test("x", { ${"todo"}: "later" }, () => {});`,
    call("t", "skip", '"not now"'),
    // A guard that fires on Linux, i.e. on CI.
    `if (process.platform === "linux") ${call("t", "skip", '"slow"')}`,
    // No guard in the three lines above.
    `if (process.platform !== "linux") {}\n\n\n\n${call("t", "skip", '"runs on Linux CI"')}`,
    // Codex on #1110: an option key on its own line of a multi-line object.
    `test("x", {\n  ${"skip"}: true,\n}, () => {});`,
    `describe("x", {\n  ${"only"}: true }, () => {});`,
    // Codex on #1110: a platform check nearby that does not decide the call.
    `if (process.platform !== "linux") {}\n${call("t", "skip", '"never runs"')}`,
    `const onLinux = process.platform !== "linux";\n${call("t", "skip", '"never runs"')}`,
    `if (process.platform !== "win32") throw new Error("x");\n\n${call("t", "skip", '"gap"')}`,
    `assert.ok(!IN_CI, "x");\nconsole.log("between");\n${call("t", "skip", '"gap"')}`,
    // Codex on #1110, second round: a quoted option key.
    `test("x", { "${"skip"}": true }, () => {});`,
    `test("x", { '${"only"}': true }, () => {});`,
    `describe("x", {\n  "${"todo"}": "later",\n}, () => {});`,
    // Codex on #1110, second round: a guard term that lets Linux fall through.
    `if (process.platform !== "win32" && error.code !== "EPERM") throw error;\n${call("t", "skip", '"x"')}`,
    `if (process.platform !== "win32" || a ? b : c) throw error;\n${call("t", "skip", '"x"')}`,
    `if (process.platform !== "win32" || ok()) throw error;\n${call("t", "skip", '"x"')}`,
    `assert.ok(!IN_CI || true, "x");\n${call("t", "skip", '"x"')}`,
  ]) assert.notDeepEqual(unguardedMarkers(bad), [], bad);
  // The three forms the scanned tests use stay allowed.
  for (const good of [
    `if (process.platform !== "linux") return ${call("t", "skip", '"needs /proc; runs on Linux CI"')}`,
    `if (process.platform !== "win32" || error.code !== "EPERM") throw error;\n    ${call("t", "skip", '"no symlink privilege; runs on Linux CI"')}`,
    `assert.ok(!IN_CI, "bash is required in CI");\n      return ${call("t", "skip", '"bash not found"')}`,
  ]) assert.deepEqual(unguardedMarkers(good), [], good);
});

test("orchestrator tests are not skipped, todo or focused with only", async () => {
  const names = (await readdir(orchestratorDir)).filter((n) => n.endsWith(".test.mjs"));
  assert.ok(names.length > 0);
  const bad = /\b(?:test|describe|it|t)\.(?:skip|todo|only)\b|[{,]\s*(?:skip|todo|only)\s*:/;
  for (const name of names) {
    const src = await readFile(new URL(name, orchestratorDir), "utf8");
    assert.doesNotMatch(src, bad, `${name} must not skip, todo or focus tests`);
  }
});
