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
// runtime one for a platform that cannot run the case, guarded within three
// lines by a check that the platform is not Linux (`!== "linux"`), that it is
// Windows (`!== "win32"` then throw), or by an assertion that CI is not the
// caller. The CI runner is Linux, so such a marker never fires there.
const MARKERS = ["skip", "todo", "only"].join("|");
const MARKED = new RegExp(`\\b(?:test|describe|it|t)\\.(?:${MARKERS})\\b|[{,]\\s*(?:${MARKERS})\\s*:`);
const PLATFORM_ONLY = new RegExp(`^\\s*(?:if \\(.*\\) )?(?:return )?t\\.${"skip"}\\("[^"]*"\\);?\\s*$`);
const NOT_ON_CI = /process\.platform !== "linux"|process\.platform !== "win32"[^\n]*throw|assert\.ok\(!IN_CI/;
export function unguardedMarkers(src) {
  const lines = src.split("\n");
  const out = [];
  lines.forEach((line, i) => {
    if (!MARKED.test(line)) return;
    const guard = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
    if (!(PLATFORM_ONLY.test(line) && NOT_ON_CI.test(guard))) out.push(`${i + 1}: ${line.trim()}`);
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
  ]) assert.notDeepEqual(unguardedMarkers(bad), [], bad);
  assert.deepEqual(unguardedMarkers(`if (process.platform !== "linux") return ${call("t", "skip", '"needs /proc; runs on Linux CI"')}`), []);
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
