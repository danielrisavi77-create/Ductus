// DAN-270: pure logic for `pnpm orch:capsule`. No gh/git calls here.
// A capsule names what a failed CI run needs to be reproduced: the SHA, the
// failed jobs and steps, the command, the toolchain and the existing artifacts.
// It carries names and links only, never log text: logs can hold secrets and
// personal data.

const SHA_RE = /^[0-9a-f]{40}$/i;
const GITHUB_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+(\/job\/\d+)?$/;
// Same allow-list as preflight-core: anything else is author- or app-controlled
// text that is not echoed to the terminal.
const SAFE_NAME = /^[\w .,()/:=@+-]{1,100}$/;
const VERSION = /^[\w .<>=~^|*@-]{1,40}$/;
// F-122: a reproduce command is never taken from step text. Only "Run pnpm <script>" or
// "Run pnpm run <script>" with no further argument, and only when <script> is a script of
// package.json on main, becomes `pnpm <script>`.
const RUN_STEP = /^Run pnpm (?:run )?([\w:-]{1,60})$/;
const SCRIPT_NAME = /^[\w:-]{1,60}$/;
const FAILED = new Set(["failure", "timed_out"]);

export function parseCapsuleArgs(argv) {
  let run = null;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--run") run = argv[++i];
    else if (argv[i] === "--json") json = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!/^[1-9]\d{0,14}$/.test(run ?? "")) throw new Error("--run <numeric run id> is required");
  return { run, json };
}

// Every value that is not a link is filtered here, once, so the text and the JSON output
// carry the same thing and neither can print a name outside the allowed shape.
const shown = (s) => (SAFE_NAME.test(String(s ?? "")) ? String(s) : "<not printed>");
const version = (s) => (VERSION.test(String(s ?? "")) ? String(s) : "<not printed>");
const link = (url) => (typeof url === "string" && GITHUB_URL.test(url) ? url : null);

/** Script names of a package.json text (main's); empty for an unreadable file. */
export function scriptsOf(packageJsonText) {
  try {
    const scripts = JSON.parse(packageJsonText)?.scripts;
    return new Set(scripts && typeof scripts === "object" ? Object.keys(scripts).filter((k) => SCRIPT_NAME.test(k)) : []);
  } catch {
    return new Set();
  }
}

/** `pnpm <script>` when the step is a plain run of a script that exists on main; null otherwise. */
export function commandOf(stepName, allowed = new Set()) {
  const script = RUN_STEP.exec(String(stepName ?? ""))?.[1];
  return script !== undefined && allowed.has(script) ? `pnpm ${script}` : null;
}

/**
 * True unless the run was made from this very repository. A pull_request run from a fork
 * uses the workflow file of the fork, so its step names, job names and commit are chosen by
 * an outsider (F-122). Missing data counts as external: fail closed.
 */
export function isExternalRun(run) {
  const here = String(run?.repository?.full_name ?? "").toLowerCase();
  const from = String(run?.head_repository?.full_name ?? "").toLowerCase();
  return here === "" || from === "" || here !== from;
}
/** Toolchain pins from a package.json text; null for a field that is missing or not a string. */
export function toolchainOf(packageJsonText) {
  let pkg;
  try {
    pkg = JSON.parse(packageJsonText);
  } catch {
    return { packageManager: null, node: null };
  }
  const text = (v) => (typeof v === "string" ? version(v) : null);
  return { packageManager: text(pkg?.packageManager), node: text(pkg?.engines?.node) };
}

/**
 * The capsule of one run. Throws when the run did not fail, so a capsule never
 * claims a failure that did not happen.
 */
export function buildCapsule({ run, jobs, artifacts, packageJsonText }) {
  if (!FAILED.has(run?.conclusion)) throw new Error(`run ${run?.id} did not fail (conclusion: ${run?.conclusion ?? "unknown"})`);
  if (typeof run.head_sha !== "string" || !SHA_RE.test(run.head_sha)) throw new Error("run has no valid head SHA");
  // `packageJsonText` is package.json of main, never of the run head (F-122).
  const allowed = scriptsOf(packageJsonText);
  if (isExternalRun(run)) {
    // Counts and our own link only: no name, no SHA, no command from outside this repository.
    return {
      external: true,
      runId: run.id,
      url: link(run.html_url),
      event: shown(run.event),
      attempt: run.run_attempt,
      failedJobs: jobs.filter((job) => FAILED.has(job.conclusion)).length,
      toolchain: toolchainOf(packageJsonText),
    };
  }
  const failedJobs = jobs
    .filter((job) => FAILED.has(job.conclusion))
    .map((job) => ({
      name: shown(job.name),
      url: link(job.html_url),
      failedSteps: (job.steps ?? [])
        .filter((step) => FAILED.has(step.conclusion))
        .map((step) => ({ number: step.number, name: shown(step.name), command: commandOf(step.name, allowed) })),
    }));
  return {
    runId: run.id,
    url: link(run.html_url),
    event: shown(run.event),
    attempt: run.run_attempt,
    headSha: run.head_sha,
    branch: shown(run.head_branch ?? ""),
    failedJobs,
    artifacts: artifacts.map((a) => ({ name: shown(a.name), expired: a.expired === true, sizeBytes: a.size_in_bytes })),
    toolchain: toolchainOf(packageJsonText),
  };
}


export function renderCapsule(capsule) {
  if (capsule.external) {
    return [
      `Failure capsule, run ${capsule.runId}, attempt ${capsule.attempt}: EXTERNAL RUN`,
      "This run is not from this repository (a fork or unknown origin): its code, step names and commit are chosen by someone else.",
      "No SHA, branch, job or step name and no reproduce command is printed. Do not check out, install or run anything from it.",
      `Run: ${capsule.url ?? "<not printed>"}   Event: ${shown(capsule.event)}   Failed jobs: ${capsule.failedJobs}`,
      `Toolchain (from main): packageManager ${version(capsule.toolchain.packageManager ?? "-")}, node ${version(capsule.toolchain.node ?? "-")}`,
    ];
  }
  const lines = [
    `Failure capsule, run ${capsule.runId}, attempt ${capsule.attempt} (names and links only, no log text)`,
    `SHA: ${capsule.headSha}`,
    `Branch: ${shown(capsule.branch)}   Event: ${shown(capsule.event)}`,
    `Run: ${capsule.url ?? "<not printed>"}`,
    `Toolchain: packageManager ${version(capsule.toolchain.packageManager ?? "-")}, node ${version(capsule.toolchain.node ?? "-")}`,
    "",
    `Failed jobs (${capsule.failedJobs.length}):`,
  ];
  for (const job of capsule.failedJobs) {
    lines.push(`- ${shown(job.name)}  ${job.url ?? "<not printed>"}`);
    for (const step of job.failedSteps) {
      lines.push(`    step ${step.number}: ${shown(step.name)}${step.command ? `  -> reproduce: ${step.command}` : ""}`);
    }
  }
  lines.push("", "Artifacts:");
  for (const a of capsule.artifacts) lines.push(`- ${shown(a.name)}${a.expired ? " (expired)" : ""}`);
  if (!capsule.artifacts.length) lines.push("- none");
  return lines;
}
