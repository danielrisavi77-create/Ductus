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
const RUN_STEP = /^Run (pnpm [^\n]{1,200})$/;
const WORD = /^-{0,2}\w[\w:.=/-]{0,60}$/;
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

/** The shell command of a "Run <command>" step when it is a plain pnpm call; null otherwise. */
export function commandOf(stepName) {
  const rest = RUN_STEP.exec(String(stepName ?? ""))?.[1];
  if (rest === undefined) return null;
  // Words are checked one by one after a split, so no pattern can backtrack over the whole text.
  const words = rest.split(" ");
  return words.length <= 12 && words.every((w, i) => (i === 0 ? w === "pnpm" : WORD.test(w))) ? rest : null;
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
  const failedJobs = jobs
    .filter((job) => FAILED.has(job.conclusion))
    .map((job) => ({
      name: shown(job.name),
      url: link(job.html_url),
      failedSteps: (job.steps ?? [])
        .filter((step) => FAILED.has(step.conclusion))
        .map((step) => ({ number: step.number, name: shown(step.name), command: commandOf(step.name) })),
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
