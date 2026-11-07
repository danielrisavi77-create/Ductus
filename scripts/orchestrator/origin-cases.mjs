// Test helper for F-010 in the orchestrator tools (DAN-574, plan #1671): the
// head-origin classes of #1091 c.6702002871, the R axis (what repoId() answers),
// the scenarios of plan §4 for T1-T3, the gh routes that answer them, and a
// runner for the real CLIs under fake-gh-routes-preload.mjs. Repository names
// and logins are invented.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export const REPO = "owner1/repo1";
export const OWNER = "owner1";
export const HEAD = "c".repeat(40);
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

// Head and base shapes per class; `undefined` drops that part of the REST object.
const headWith = (repo) => ({ head: { sha: HEAD, ref: "feature/x", repo } });
export const OUTSIDE = {
  O1: headWith({ full_name: "outsider/repo1-fork", fork: true }),
  O2: headWith({ full_name: "outsider1/repo1" }),
  O3: headWith(null),
  O4: { head: { sha: HEAD, ref: "feature/x" } },
  O5: { head: undefined },
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
export function rawPull(cls, over = {}) {
  const base = {
    number: NUMBER, title: "fix: example", body: "Agent: claude:w1:platforma\nRisk: standard\nTask: DAN-1\n",
    state: "open", draft: false, merged_at: null, mergeable: true, mergeable_state: "clean",
    head: { sha: HEAD, ref: "feature/x", repo: { full_name: REPO } },
    base: { ref: "main", repo: { full_name: REPO } },
    user: AUTHORS[cls] ?? AUTHORS.S1, created_at: "2026-11-01T09:00:00Z", auto_merge: null,
  };
  return { ...base, ...(OUTSIDE[cls] ?? {}), ...over };
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

/** gh routes for one PR (`n`, raw pull) in scenario `sc`; `repo` is an R value. */
export function routesFor({ pulls, scenario = {}, repo = R.R1 }) {
  const sc = scenario;
  const routes = { "repos/{owner}/{repo}": [repo], graphql: [{ $error: "HTTP 403: graphql refused" }] };
  const real = repo.$error ? null : `${repo.owner.login}/${repo.name}`;
  if (real) {
    routes[`repos/${real}/branches/main`] = [{
      protection: { required_status_checks: { checks: [...REQUIRED_NAMES, GATE].map((context) => ({ context, app_id: ACTIONS })) } },
    }];
  }
  for (const entry of pulls) {
    const { n, raw } = entry;
    const answers = entry.answers ?? [raw];
    const sha = raw?.head?.sha ?? "undefined";
    routes[`repos/{owner}/{repo}/pulls/${n}`] = answers;
    const files = sc.files ?? ["src/domain/example.ts"];
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
    routes[`repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100&page=1`] = [{
      check_runs: REQUIRED_NAMES.map((name, i) => ({
        name, status: "completed", conclusion: "success", app: { id: ACTIONS, slug: "github-actions" },
        check_suite: { id: 100 + i }, started_at: at(10 + i), completed_at: at(20 + i),
      })),
    }];
    if (real) routes[`repos/${real}/compare/${sha}...main`] = [{ files: [] }];
  }
  routes["repos/{owner}/{repo}/pulls?state=open&per_page=100&page=1"] = [pulls.map((p) => p.listed ?? p.raw)];
  return routes;
}

/** Runs a real orchestrator CLI under the routes fake; resolves {code, stdout, stderr}. */
export function runTool(script, args, routes) {
  const dir = mkdtempSync(join(tmpdir(), "origin-cases-"));
  const file = join(dir, "routes.json");
  writeFileSync(file, JSON.stringify(routes));
  return new Promise((resolve) => {
    execFile(process.execPath, ["--import", pathToFileURL(join(here, "fake-gh-routes-preload.mjs")).href, join(here, script), ...args], {
      env: { ...process.env, FAKE_GH_ROUTES: file }, encoding: "utf8", windowsHide: true, timeout: 60_000,
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
