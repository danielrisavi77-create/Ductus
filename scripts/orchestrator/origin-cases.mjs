// Test helper for F-010 in the orchestrator tools (DAN-574, plan #1671): the
// head-origin classes of #1091 c.6702002871, the R axis (what repoId() answers),
// the scenarios of plan §4 for T1-T3 (B1) and T4-T5 (B2), the gh routes that
// answer them, a runner for the real CLIs under fake-gh-routes-preload.mjs and
// the in-process gh reads the mirrors use. Repository names and logins are invented.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ghJson, ghList } from "./gh.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));

export const REPO = "owner1/repo1";
export const OWNER = "owner1";
export const HEAD = "c".repeat(40);
export const MAIN = "d".repeat(40);
export const NUMBER = 41;
export const ACTIONS = 15368;
export const REQUIRED_NAMES = ["Lint, typecheck, test and build", "Local stack (compose.yaml)", "Security scanners", "Dependency review"];
const T0 = Date.parse("2026-11-01T10:00:00Z");
const at = (i) => new Date(T0 + i * 1000).toISOString();

// Authors of the same-repository classes. S3u is the plan's N14 negative: an
// app login with type User still fails on the author in T1, as on main.
export const AUTHORS = {
  S1: { login: OWNER, type: "User" },
  S2: { login: "helper1", type: "User" },
  S3: { login: "dependabot[bot]", type: "Bot" },
  S3u: { login: "mergify[bot]", type: "User" },
};

// Head and base shapes per class; `undefined` drops that part of the REST object,
// and `null` (O6) makes the whole REST pull object `null`.
const headWith = (repo) => ({ head: { sha: HEAD, ref: "feature/x", repo } });
export const OUTSIDE = {
  O1: headWith({ full_name: "outsider/repo1-fork", fork: true }),
  O2: headWith({ full_name: "outsider1/repo1" }),
  O3: headWith(null),
  O4: { head: { sha: HEAD, ref: "feature/x" } },
  O5: { head: undefined },
  O6: null,
  O7n: headWith({ full_name: 42 }),
  O7o: headWith({ full_name: { toString: () => REPO } }),
  O8: headWith({ full_name: "Owner1/Repo1" }),
  O8r: { ...headWith({ full_name: "Owner1/Repo1" }), base: { ref: "main", repo: { full_name: "Owner1/Repo1" } } }, // repoId answers owner1/repo1 (R1)
  O9t: headWith({ full_name: `${REPO} ` }),
  O9l: headWith({ full_name: ` ${REPO}` }),
  O9g: headWith({ full_name: `${REPO}.git` }),
  O9f: headWith({ full_name: `${REPO}-fork` }),
  O10n: headWith({ full_name: null }),
  O10e: headWith({ full_name: "" }),
  O11m: { base: { ref: "main" } },
  O11n: { base: { ref: "main", repo: null } },
  O11b: { base: undefined },
  O12: { head: { sha: HEAD, ref: "feature/x", repo: {} }, base: { ref: "main", repo: {} } },
  O13: { head: { sha: HEAD, ref: "feature/x", repo: { full_name: "" } }, base: { ref: "main", repo: { full_name: "" } } },
};
// Classes T2 must call BLOCKED (both names readable, different); the rest may be UNREAD.
export const READABLE_OUTSIDE = new Set(["O1", "O2", "O8", "O8r", "O9t", "O9l", "O9g", "O9f"]);

// The R axis: what repoId() answers. R4 fails.
export const R = {
  R1: { owner: { login: "owner1" }, name: "repo1" },
  R2: { owner: { login: "Owner1" }, name: "Repo1" },
  R3: { owner: { login: "owner1" }, name: "renamed1" },
  R4: { $error: "HTTP 404: Not Found (repos/{owner}/{repo})" },
};

/** Raw REST pull object for class `cls` (S1..S3u or O*), with `over` merged last. */
export function rawPull(cls, { baseRef, ...over } = {}) {
  if (OUTSIDE[cls] === null) return null;
  const base = {
    number: NUMBER, title: "fix: example", body: "Agent: claude:w1:platforma\nRisk: standard\nTask: DAN-1\n",
    state: "open", draft: false, merged_at: null, mergeable: true, mergeable_state: "clean",
    head: { sha: HEAD, ref: "feature/x", repo: { full_name: REPO } },
    base: { ref: "main", repo: { full_name: REPO } },
    user: AUTHORS[cls] ?? AUTHORS.S1, created_at: "2026-11-01T09:00:00Z", auto_merge: null,
  };
  const pull = { ...base, ...(OUTSIDE[cls] ?? {}), ...over };
  // A scenario that only moves the base branch keeps the class's base repository (O8r, O11*, O12, O13).
  if (baseRef !== undefined && pull.base) pull.base = { ...pull.base, ref: baseRef };
  return pull;
}

const status = (context, state, description, i) => ({ id: i, context, state, description, created_at: at(i) });
const GATE = "Engineering review gate";
const AUTH = "Merge authorization";
export const DESCRIPTIONS = {
  gateOk: "Review PASS on this head.",
  authOk: "Owner merge command names this head.",
  needsOwner: "Needs the owner's merge command for this head (D-97 or critical).",
};

// Scenarios of plan §4 for T1-T3, each with every other input as for a ready S1.
// gate/auth: status state or null (none) or "error" (statuses unreadable).
export const SCENARIOS = {
  ready: {},
  gateOkNoAuth: { auth: null }, // X1
  gatePending: { gate: ["pending", "Waiting for an independent review."] },
  gateFailure: { gate: ["failure", "Independent review fail on current head."] },
  gateNone: { gate: null, auth: null },
  gateError: { statuses: "error" },
  needsOwner: { auth: ["pending", DESCRIPTIONS.needsOwner] }, // X4
  autoMerge: { pull: { auto_merge: { merge_method: "squash" } } }, // X7
  docsOnly: { files: ["docs/BACKEND.md"] }, // X8
  testsOnly: { files: ["tests/unit/new.test.ts"] },
  d97: { files: ["scripts/engineering/review-gate-core.mjs"] },
  filesError: { files: "error" }, // X9
};

// T4 (preflight): a critical description with Task and every contract line (X11).
export const PREFLIGHT_BODY = [
  "Agent: claude:w1:platforma", "Risk: critical", "Task: DAN-1", "",
  "- **Invarijanta:** example invariant", "- **Mjesta:** scripts/example.mjs",
  "- **Stvarni pozivatelj:** pnpm orch:example", "- **Poznate granice:** none known",
  "- **Što bi ovaj PR moglo oboriti na QA-i?:** a missed path", "",
].join("\n");
const pre = (pull = {}, rest = {}) => ({ ...rest, pull: { body: PREFLIGHT_BODY, ...pull } });
const BEHIND = { status: "diverged", behind_by: 2, ahead_by: 1 };
// Scenarios of plan §4 for T4; `args` follow the PR number on the command line.
export const PREFLIGHT_SCENARIOS = {
  ready: pre(),
  riskStandard: pre({ body: PREFLIGHT_BODY.replace("Risk: critical", "Risk: standard") }),
  expectHead: pre({}, { args: ["--head", HEAD] }), // X11
  headMoved: pre({}, { args: ["--head", "e".repeat(40)] }),
  behind: pre({}, { compare: BEHIND }),
  behindShared: pre({}, { compare: BEHIND, mainFiles: ["src/domain/example.ts", "docs/BACKEND.md"] }),
  behindConflict: pre({ mergeable: false, mergeable_state: "dirty" }, { compare: BEHIND }),
  behindFilesError: pre({}, { compare: BEHIND, files: "error" }), // X9
  behindMainFilesError: pre({}, { compare: BEHIND, mainFiles: "error" }),
  draft: pre({ draft: true }),
  baseOther: pre({ baseRef: "release" }),
  ciRed: pre({}, { ci: "failure" }),
  ciRunning: pre({}, { ci: "in_progress" }),
  gatePending: pre({}, { gate: ["pending", "Waiting for an independent review."], auth: null }),
  noTask: pre({ body: PREFLIGHT_BODY.replace("Task: DAN-1\n", "") }),
  mainUnread: pre({}, { main: "error" }),
  compareUnread: pre({}, { compare: "error" }),
  checksUnread: pre({}, { statuses: "error" }),
  docsOnly: pre({}, { compare: BEHIND, files: ["docs/BACKEND.md"] }), // X8
  testsOnly: pre({}, { compare: BEHIND, files: ["tests/unit/new.test.ts"] }),
};

// T5 (pr-overlap --plan): the subject PR (NUMBER) next to companions in this
// repository. Every PR has its own writer, task and files, and the contract
// assigns each one (X10). `others` are [number offset, draft]; `subject` overrides
// the subject's pull fields.
export const PLAN_SCENARIOS = {
  single: { others: [] },
  draftSubject: { subject: { draft: true }, others: [] },
  withDraft: { others: [[1, true]] }, // a free slot for the companion draft
  slotsTight: { others: [[1, false], [2, false], [3, true]] }, // N12: the draft waits unless a slot is free
  overCapacity: { others: [[1, false], [2, false], [3, false]] }, // 4 out of draft, 3 slots
  noContract: { others: [[1, false]], contract: false },
  filesError: { files: "error", others: [] }, // X9
  docsOnly: { files: ["docs/BACKEND.md"], subject: { draft: true }, others: [] }, // X8
  testsOnly: { files: ["tests/unit/new.test.ts"], others: [] },
  dependsOn: { subject: { body: planBody(NUMBER, "ovisi o #42\n") }, others: [[1, false]] },
};

/** Description of a T5 PR: its own writer and task. */
export function planBody(n, extra = "") {
  return `Agent: claude:w${n}:platforma\nRisk: standard\nTask: DAN-${n}\n${extra}`;
}

/** Pull entries of a T5 scenario: the subject (class `cls`) first, then the companions. */
export function planPulls(cls, sc) {
  const subject = rawPull(cls, { body: planBody(NUMBER), ...sc.subject });
  const pulls = [{ n: NUMBER, raw: subject, listed: subject }];
  for (const [i, draft] of sc.others) {
    const n = NUMBER + i;
    const raw = rawPull("S1", { number: n, draft, body: planBody(n), head: { sha: `${i}`.repeat(40), ref: `lane/${n}`, repo: { full_name: REPO } } });
    pulls.push({ n, raw, listed: raw, files: [`tests/unit/c${n}.test.ts`] });
  }
  return pulls;
}

/** A work contract valid at `now` that assigns every PR of `numbers` to its writer. */
export function contractFor(numbers, now = Date.now()) {
  return {
    schema: 1, repository: "danielrisavi77-create/Ductus",
    issuedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 10 * 60_000).toISOString(),
    assignments: numbers.map((n) => ({
      task: `DAN-${n}`, agent: `claude:w${n}:platforma`, branch: `lane/${n}`, baseSha: "a".repeat(40),
      paths: ["scripts/"], pr: n, failures: [], regressions: 0, blockers: [],
    })),
  };
}

/** gh routes for one PR (`n`, raw pull) in scenario `sc`; `repo` is an R value. */
export function routesFor({ pulls, scenario = {}, repo = R.R1 }) {
  const sc = scenario;
  const routes = { "repos/{owner}/{repo}": [repo], graphql: [{ $error: "HTTP 403: graphql refused" }] };
  const real = repo.$error ? null : `${repo.owner.login}/${repo.name}`;
  if (real) {
    routes[`repos/${real}/branches/main`] = sc.main === "error" ? [{ $error: "HTTP 502: main unreadable" }] : [{
      commit: { sha: MAIN },
      protection: { required_status_checks: { checks: [...REQUIRED_NAMES, GATE].map((context) => ({ context, app_id: ACTIONS })) } },
    }];
  }
  for (const entry of pulls) {
    const { n, raw } = entry;
    const answers = entry.answers ?? [raw];
    const sha = raw?.head?.sha ?? "undefined";
    routes[`repos/{owner}/{repo}/pulls/${n}`] = answers;
    const files = entry.files ?? sc.files ?? ["src/domain/example.ts"];
    routes[`repos/{owner}/{repo}/pulls/${n}/files?per_page=100&page=1`] = files === "error"
      ? [{ $error: "HTTP 500: files unreadable" }]
      : [files.map((filename) => ({ filename, status: "modified" }))];
    routes[`repos/{owner}/{repo}/pulls/${n}/ccr/review_threads`] = [[]];
    const statuses = [];
    const gate = sc.gate === undefined ? ["success", DESCRIPTIONS.gateOk] : sc.gate;
    const auth = sc.auth === undefined ? ["success", DESCRIPTIONS.authOk] : sc.auth;
    if (gate) statuses.push(status(GATE, gate[0], gate[1], 1));
    if (auth) statuses.push(status(AUTH, auth[0], auth[1], 2));
    routes[`repos/{owner}/{repo}/commits/${sha}/statuses?per_page=100&page=1`] = sc.statuses === "error"
      ? [{ $error: "HTTP 404: statuses unreadable" }]
      : [statuses];
    // sc.ci changes the first required run: "failure" or "in_progress" (T4).
    const run = (name, i) => (i === 0 && sc.ci === "failure" ? { status: "completed", conclusion: "failure" }
      : i === 0 && sc.ci === "in_progress" ? { status: "in_progress", conclusion: null, completed_at: null }
        : { status: "completed", conclusion: "success" });
    routes[`repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100&page=1`] = [{
      check_runs: REQUIRED_NAMES.map((name, i) => ({
        name, app: { id: ACTIONS, slug: "github-actions" },
        check_suite: { id: 100 + i }, started_at: at(10 + i), completed_at: at(20 + i), ...run(name, i),
      })),
    }];
    if (real) {
      routes[`repos/${real}/compare/${sha}...main`] = [{ files: [] }];
      // T4: main...head (behind_by), and head...main for the files main changed since.
      const compare = sc.compare ?? { status: "ahead", behind_by: 0, ahead_by: 1 };
      routes[`repos/${real}/compare/${MAIN}...${sha}`] = [compare === "error" ? { $error: "HTTP 502: compare unreadable" } : compare];
    }
    const mainFiles = sc.mainFiles ?? ["src/other.ts"];
    routes[`repos/{owner}/{repo}/compare/${sha}...${MAIN}`] = [mainFiles === "error"
      ? { $error: "HTTP 502: compare unreadable" }
      : { files: mainFiles.map((filename) => ({ filename, status: "modified" })) }];
  }
  // O6: the list still shows the PR by number; only the read of that PR answers `null`.
  // An entry may set `listed` (T5 reads the list object, null included).
  const listed = (p) => ("listed" in p ? p.listed : p.raw === null ? rawPull("S1", { number: p.n }) : p.raw);
  routes["repos/{owner}/{repo}/pulls?state=open&per_page=100&page=1"] = [pulls.map(listed)];
  return routes;
}

/**
 * Runs a real orchestrator CLI under the routes fake; resolves {code, stdout, stderr}.
 * `contract` is written to a file passed as `--contract <file>` (T5).
 */
export function runTool(script, args, routes, { contract } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "origin-cases-"));
  const file = join(dir, "routes.json");
  writeFileSync(file, JSON.stringify(routes));
  const extra = [];
  if (contract) {
    writeFileSync(join(dir, "contract.json"), JSON.stringify(contract));
    extra.push("--contract", join(dir, "contract.json"));
  }
  return new Promise((resolve) => {
    execFile(process.execPath, ["--import", pathToFileURL(join(here, "fake-gh-routes-preload.mjs")).href, join(here, script), ...args, ...extra], {
      env: { ...process.env, FAKE_GH_ROUTES: file, DUCTUS_WORK_CONTRACT: "" }, encoding: "utf8", windowsHide: true, timeout: 60_000,
    }, (error, stdout, stderr) => {
      rmSync(dir, { recursive: true, force: true });
      resolve({ code: error ? (typeof error.code === "number" ? error.code : -1) : 0, stdout, stderr });
    });
  });
}

/** T1 output -> {exit, checks: [[level, id-less text]]} (pr-ready prints level and text). */
export const parsePrReady = ({ code, stdout }) => ({
  exit: code,
  lines: stdout.split(/\r?\n/).filter(Boolean),
});
/** T2 single output -> {exit, lines}. */
export const parseMergeReady = parsePrReady;

// ---------------------------------------------------------------------------
// In-process gh over the same routes, for the mirrors of the CLIs (B1 and B2).
export function failed(text) {
  const e = new Error(text);
  e.stderr = text;
  return e;
}
export function fakeExec(routes) {
  const calls = new Map();
  return async (cmd, args) => {
    const path = args[1] === "graphql" ? "graphql" : args[1];
    const list = routes[path];
    if (cmd !== "gh" || !Array.isArray(list) || list.length === 0) throw failed(`fake gh: unexpected path ${path}`);
    const i = calls.get(path) ?? 0;
    calls.set(path, i + 1);
    const a = list[Math.min(i, list.length - 1)];
    if (a && typeof a === "object" && "$error" in a) throw failed(String(a.$error));
    return JSON.stringify(a);
  };
}
export const io = (routes) => {
  const exec = fakeExec(routes);
  const json = (args) => ghJson(args, exec);
  const list = (path, _exec, opts) => ghList(path, exec, opts);
  const repo = async () => {
    const r = await json(["api", "repos/{owner}/{repo}"]);
    return { owner: r.owner.login, repo: r.name };
  };
  return { exec, json, list, repo };
};
export const why = (e) => String(e?.stderr || e?.message || e).trim().split("\n")[0];
export const tryRead = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    return { error: why(e) };
  }
};
export const quiet = async (fn) => {
  try {
    return await fn();
  } catch {
    return null;
  }
};
